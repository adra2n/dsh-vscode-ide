const vscode = acquireVsCodeApi()

const log = document.getElementById('log')
const modelSel = document.getElementById('model')
const ta = document.getElementById('ta')
const sendBtn = document.getElementById('send')
const editBtn = document.getElementById('edit')
const statusEl = document.getElementById('status')
const wsList = document.getElementById('ws-list')
const newSessionBtn = document.getElementById('new-session')
const stopBtn = document.getElementById('stop')
const effortSel = document.getElementById('effort')
const sessFilter = document.getElementById('sess-filter')
const showAllLink = document.getElementById('show-all')
const gwDot = document.getElementById('gw-dot')
const ctxChip = document.getElementById('ctx-chip')
const ctxText = document.getElementById('ctx-text')
const ctxBar = document.getElementById('ctx-bar')
const inCtx = document.getElementById('in-ctx')
const settingsBtn = document.getElementById('settings')
const settingsOverlay = document.getElementById('settings-overlay')
const settingsClose = document.getElementById('settings-close')
const settingsSave = document.getElementById('settings-save')
const cfgGateway = document.getElementById('cfg-gateway')
const cfgDshCmd = document.getElementById('cfg-dshcmd')
const cfgToolList = document.getElementById('cfg-tools-list')
const cfgToolsEmpty = document.getElementById('cfg-tools-empty')

let modelsData = null
// 根据当前选中模型同步“思考强度”下拉（无 reasoning 能力的模型隐藏）
function findModelMeta(provider, model) {
  const g = (modelsData?.groups || []).find(x => x.id === provider)
  return g && (g.models || []).find(x => x.id === model)
}
function syncEffortOptions(prefer) {
  if (!effortSel) return
  let sel = null
  try { sel = JSON.parse(modelSel.value) } catch { /* ignore */ }
  const meta = sel ? findModelMeta(sel.provider, sel.model) : null
  const efforts = meta?.reasoning?.efforts || []
  effortSel.innerHTML = ''
  if (efforts.length === 0) { effortSel.hidden = true; return }
  effortSel.hidden = false
  for (const e of efforts) {
    const o = document.createElement('option')
    o.value = e.id
    o.textContent = '思考: ' + (e.name || e.id)
    effortSel.appendChild(o)
  }
  const want = prefer || meta?.reasoning?.defaultEffort || efforts[0]?.id
  for (const o of effortSel.options) if (o.value === want) { o.selected = true; break }
}
function sendSelectModel() {
  let v = null
  try { v = JSON.parse(modelSel.value) } catch { /* ignore */ }
  if (!v) return
  const effort = effortSel && !effortSel.hidden && effortSel.value ? effortSel.value : undefined
  vscode.postMessage({ kind: 'selectModel', provider: v.provider, model: v.model, reasoningEffort: effort })
}

let statusTitle = 'AI 对话'
function setRunning(v) {
  running = v
  if (stopBtn) stopBtn.disabled = !v
  if (stopBtn) stopBtn.classList.toggle('stop-run', !!v)
}

// 空态 hero：会话无任何内容时展示引导卡片，出现首条内容后自动移除
function ensureHero() {
  if (sessionHasContent) return null
  let hero = log.querySelector('.hero')
  if (!hero) {
    hero = document.createElement('div')
    hero.className = 'hero'
    hero.innerHTML = '<div class="logo"><b>Codon</b> AI</div>'
      + '<div class="sub">把任务交给 AI，直接在编辑器里落地改动。<br>写文件等敏感操作会先向你申请授权。</div>'
      + '<div class="hero-chips">'
      + '<div class="chip-card" data-q="介绍一下这个项目的整体结构和核心模块"><div class="ic">📖</div><div class="tt">介绍这个项目</div><div class="ds">梳理目录结构与核心模块</div></div>'
      + '<div class="chip-card" data-q="帮我实现一个新功能："><div class="ic">✨</div><div class="tt">写一个新功能</div><div class="ds">从需求到代码一步到位</div></div>'
      + '<div class="chip-card" data-q="帮我排查下面这个报错："><div class="ic">🐛</div><div class="tt">修一个 bug</div><div class="ds">粘贴报错，我来定位</div></div>'
      + '</div>'
    hero.querySelectorAll('.chip-card').forEach(c => {
      c.onclick = () => { ta.value = c.dataset.q || ''; hideHero(); ta.focus() }
    })
    log.appendChild(hero)
  }
  return hero
}
function hideHero() {
  sessionHasContent = true
  const hero = log.querySelector('.hero')
  if (hero) hero.remove()
}

let pendingEl = null
let pendingTimer = null
function showPending() {
  hidePending()
  pendingEl = document.createElement('div')
  pendingEl.className = 'pending'
  const t0 = Date.now()
  pendingEl.textContent = '思考中… 0s'
  pendingTimer = setInterval(() => {
    if (pendingEl) pendingEl.textContent = '思考中… ' + Math.max(1, Math.round((Date.now() - t0) / 1000)) + 's'
  }, 1000)
  log.appendChild(pendingEl)
  log.scrollTop = log.scrollHeight
}
function hidePending() {
  if (pendingTimer) { clearInterval(pendingTimer); pendingTimer = null }
  if (pendingEl) { pendingEl.remove(); pendingEl = null }
}

let curAssistant = null
let curStep = null
let curReasoning = null
let turnMessages = new Map()
// 去重：流式 chunk 已渲染过的文本，后续 assistant/message / inbox 回放不再重复渲染
let chunkRenderedTexts = new Set()
function normText(t) { return String(t || '').trim() }
let streamingBlocks = {}
let activeSessionId = null
let userSentMessage = false

function renderSidebar(workspaces, sessions) {
  // 自身缓存入参：搜索/展开收起等重渲染都依赖这份缓存，不依赖后续消息到达时机
  cachedWorkspaces = workspaces || []
  cachedSessions = sessions || []
  wsList.innerHTML = ''
  const assignedIds = new Set()
  for (const ws of workspaces) for (const sid of (ws.sessionIds || [])) assignedIds.add(sid)
  // 扁平化 + 按更新时间倒序：当前会话置顶，其余按最近活跃排列
  const all = [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  all.sort((a, b) => (b.sessionId === activeSessionId ? 1 : 0) - (a.sessionId === activeSessionId ? 1 : 0))
  const q = (sessFilter?.value || '').trim().toLowerCase()
  const filtered = q ? all.filter(s => {
    const title = s.projections?.values?.title || ''
    return title.toLowerCase().includes(q) || s.sessionId.includes(q)
  }) : all
  const COLLAPSE_AT = 12
  const visible = (q || showAllExpanded || filtered.length <= COLLAPSE_AT) ? filtered : filtered.slice(0, COLLAPSE_AT)
  for (const s of visible) {
    wsList.appendChild(sessItem(s))
  }
  // 底部「显示全部 (N)」：无删除 API，靠搜索 + 收敛控制列表长度
  if (showAllLink) {
    if (!q && filtered.length > COLLAPSE_AT) {
      showAllLink.hidden = false
      showAllLink.textContent = showAllExpanded ? '收起' : '显示全部 (' + filtered.length + ')'
      showAllLink.onclick = () => { showAllExpanded = !showAllExpanded; renderSidebar(cachedWorkspaces, cachedSessions) }
    } else {
      showAllLink.hidden = true
      showAllLink.onclick = null
    }
  }
}

function sessItem(s) {
  const item = document.createElement('div')
  item.className = 'sess' + (s.sessionId === activeSessionId ? ' active' : '')
  const title = s.projections?.values?.title || s.sessionId.replace('session-', '').slice(0, 12)
  const time = s.updatedAt ? timeAgo(s.updatedAt) : ''
  const l1 = document.createElement('div')
  l1.className = 'l1'
  const dot = document.createElement('span')
  dot.className = 'dot' + (s.sessionId === activeSessionId && running ? ' run' : '')
  const t = document.createElement('span')
  t.className = 't'
  t.textContent = title
  t.title = title
  l1.appendChild(dot)
  l1.appendChild(t)
  const l2 = document.createElement('div')
  l2.className = 'l2'
  const parts = []
  if (time) parts.push('<span>' + time + '</span>')
  const stats = s.projections?.values?.sessionStats
  if (stats?.turns) parts.push('<span>' + stats.turns + ' 轮</span>')
  l2.innerHTML = parts.join('')
  item.appendChild(l1)
  item.appendChild(l2)
  item.onclick = () => loadHistory(s.sessionId)
  return item
}

let cachedWorkspaces = []
let cachedSessions = []
let running = false
let sessionHasContent = false
let showAllExpanded = false

function fmtTokens(n) {
  if (n == null) return '?'
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'K'
  return String(n)
}

// 上下文压力 chip：绿 <50%、黄 50-80%、红 >80%，超阈值提示开新会话
function updateCtxChip(usage, pressure) {
  const used = usage?.cacheReadTokens || usage?.totalTokens || 0
  const pct = typeof pressure === 'number' ? pressure : (usage?.contextLimit ? used / usage.contextLimit : null)
  if (!used || pct == null) { if (ctxChip) ctxChip.hidden = true; return }
  const limit = usage.contextLimit
  ctxChip.hidden = false
  ctxText.textContent = limit ? fmtTokens(used) + '/' + fmtTokens(limit) : fmtTokens(used) + ' tokens'
  ctxBar.style.width = Math.min(100, Math.round(pct * 100)) + '%'
  ctxChip.classList.toggle('warn', pct >= 0.5 && pct < 0.8)
  ctxChip.classList.toggle('hot', pct >= 0.8)
  ctxChip.title = '上下文占用 ' + Math.round(pct * 100) + '%' + (pct >= 0.8 ? '，建议开新会话' : '')
  if (inCtx) inCtx.textContent = limit ? '上下文 ' + fmtTokens(used) + ' / ' + fmtTokens(limit) : ''
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时'
  return Math.floor(diff / 86400000) + '天'
}

function escHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

function loadHistory(sessionId) {
  activeSessionId = sessionId
  sessionHasContent = false
  vscode.setState({ sessionId })
  log.innerHTML = ''
  vscode.postMessage({ kind: 'switchSession', sessionId })
  vscode.postMessage({ kind: 'loadHistory', sessionId })
}

// 统一的“思考过程”折叠组件：默认折叠，点击展开；流式/历史/消息回放共用
function newReasoningBlock(live) {
  hideHero()
  const wrapper = document.createElement('div')
  wrapper.className = 'reasoning collapsed'
  const toggle = document.createElement('div')
  toggle.className = 'reasoning-toggle'
  toggle.innerHTML = (live ? '<span class="spin"></span> 思考中…' : '<span class="arrow">▸</span> 思考过程 <span class="hint">（点击展开）</span>')
  toggle.onclick = () => wrapper.classList.toggle('collapsed')
  const body = document.createElement('div')
  body.className = 'reasoning-body'
  wrapper.appendChild(toggle)
  wrapper.appendChild(body)
  wrapper._setDone = () => {
    if (!wrapper.classList.contains('done')) {
      wrapper.classList.add('done')
      toggle.innerHTML = '<span class="arrow">▸</span> 思考过程 <span class="hint">（点击展开）</span>'
    }
  }
  log.appendChild(wrapper)
  return body
}
function reasoningBodyFor(idx, live) {
  let b = streamingBlocks[idx]
  if (!b || b.type !== 'reasoning') {
    const wrapperEl = newReasoningBlock(live)
    b = { type: 'reasoning', el: wrapperEl, wrapper: wrapperEl.parentElement }
    streamingBlocks[idx] = b
  }
  return b
}

function renderStep(inner) {
  hidePending()
  const d = inner.data || {}
  const toolName = inner.name || inner.toolName || inner.tool || d.name || d.toolName || ''
  const toolTitle = inner.title || d.title || ''
  const label = toolTitle || toolName
  if (!label) return
  const stepEl = document.createElement('div')
  stepEl.className = 'step'
  hideHero()
  const h = document.createElement('div')
  h.className = 'head'
  h.textContent = '▸ ' + label
  stepEl.appendChild(h)
  const args = inner.input || inner.arguments || inner.params || d.input
  if (args) {
    const argEl = document.createElement('div')
    argEl.className = 'tool'
    argEl.textContent = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
    stepEl.appendChild(argEl)
  }
  log.appendChild(stepEl)
}

function assistantBubble(text) {
  hideHero()
  const el = document.createElement('div')
  el.className = 'assistant'
  el.innerHTML = renderMd(text)
  log.appendChild(el)
  log.scrollTop = log.scrollHeight
  return el
}

function renderHistoryEvent(ev) {
  if (!ev) return
  const t = ev.type
  if (t === 'agent/inbox/spliced') {
    const inserted = ev.data?.inserted || []
    for (const msg of inserted) {
      if (msg.role === 'user') {
        const raw = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
        const text = userVisibleText(raw)
        if (text) bubble(text, 'user')
      }
    }
  } else if (t === 'assistant/chunk') {
    const chunk = ev.data?.chunk
    if (!chunk) return
    const idx = 'h_' + (ev.data?.turn || 0) + '_' + chunk.index
    if (chunk.type === 'block-start') {
      if (chunk.blockType === 'text') {
        const el = document.createElement('div')
        el.className = 'assistant'
        log.appendChild(el)
        streamingBlocks[idx] = { type: 'text', el, raw: '' }
      } else if (chunk.blockType === 'reasoning') {
        reasoningBodyFor(idx, false)
      }
    } else if (chunk.type === 'text-delta' && streamingBlocks[idx]) {
      streamingBlocks[idx].raw += (chunk.text || '')
    } else if (chunk.type === 'reasoning-delta' && streamingBlocks[idx]) {
      streamingBlocks[idx].el.textContent += (chunk.text || '')
    } else if (chunk.type === 'block-end' && streamingBlocks[idx]) {
      const b = streamingBlocks[idx]
      if (b.type === 'reasoning') {
        if (chunk.block?.text) b.el.textContent = chunk.block.text
        if (b.wrapper?._setDone) b.wrapper._setDone()
      } else if (chunk.block?.text) {
        b.el.innerHTML = renderMd(chunk.block.text)
        chunkRenderedTexts.add(normText(chunk.block.text))
      }
      delete streamingBlocks[idx]
    }
  } else if (t === 'assistant/message') {
    renderAssistantMessage(ev.data?.message)
  } else if (t === 'session/event') {
    const inner = ev.event
    if (!inner) return
    if (inner.type === 'step/start') renderStep(inner)
  }
  log.scrollTop = log.scrollHeight
}

function clearQuestions() {
  log.querySelectorAll('.approval').forEach(el => el.remove())
}

function bubble(text, cls) {
  hideHero()
  const d = document.createElement('div')
  d.className = 'bubble ' + (cls || '')
  d.textContent = text
  log.appendChild(d)
  log.scrollTop = log.scrollHeight
  return d
}

function appendLine(text, cls) {
  hideHero()
  const d = document.createElement('div')
  d.className = 'msg ' + (cls || '')
  d.textContent = text
  log.appendChild(d)
  log.scrollTop = log.scrollHeight
}

function extractText(val) {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (Array.isArray(val)) {
    return val.map((b) => {
      if (typeof b === 'string') return b
      if (b && typeof b.text === 'string') return b.text
      return ''
    }).join('')
  }
  if (typeof val === 'object') return val.text || val.message || ''
  return ''
}

// 组装后的用户消息包裹在 <user-message> 中；展示与去重只取内层文本，隐藏注入的上下文
function userVisibleText(text) {
  const m = /<user-message>\s*([\s\S]*?)\s*<\/user-message>/.exec(text || '')
  return m ? m[1] : (text || '')
}

function renderAssistantMessage(msg) {
  if (!msg?.content) return
  for (const c of msg.content) {
    if (c.type === 'text' && c.text) {
      // 流式已渲染过相同文本则跳过，避免 turn 结束后的完整消息重复出泡
      if (chunkRenderedTexts.has(normText(c.text))) continue
      assistantBubble(c.text)
    }
    else if ((c.type === 'reasoning' || c.type === 'thinking') && c.text) {
      newReasoningBlock(false).textContent = c.text
    }
  }
}

function handleInboxSpliced(ev) {
  const d = ev.data || {}
  const inserted = Array.isArray(d.inserted) ? d.inserted : []
  const start = typeof d.start === 'number' ? d.start : 0
  for (let i = 0; i < inserted.length; i++) {
    const item = inserted[i]
    const idx = start + i
    let text = extractText(item.content) || extractText(item.text) || extractText(item.message)
    const kind = (item.source && item.source.kind) || item.role || ''
    const isUser = kind === 'user'
    const isReasoning = kind === 'reasoning' || kind === 'thinking'
    if (isUser) text = userVisibleText(text)
    if (!text) continue
    if (isUser && optimisticUserEl && text === optimisticUserText) {
      optimisticUserEl = null
      optimisticUserText = ''
      continue
    }
    // 思考内容统一进折叠组件，不以普通气泡呈现
    if (isReasoning) {
      let wrap = turnMessages.get(idx)
      if (!wrap) {
        wrap = newReasoningBlock(false).parentElement
        turnMessages.set(idx, wrap)
      }
      wrap.querySelector('.reasoning-body').textContent = text
      continue
    }
    const cls = isUser ? 'user' : 'assistant'
    if (!isUser && chunkRenderedTexts.has(normText(text))) continue
    let el = turnMessages.get(idx)
    if (!el) {
      el = document.createElement('div')
      el.className = 'bubble ' + cls
      log.appendChild(el)
      turnMessages.set(idx, el)
    }
    el.className = 'bubble ' + cls
    el.textContent = text
  }
  log.scrollTop = log.scrollHeight
}

function handleTurnEnd(ev) {
  hidePending()
  const reason = ev.data && ev.data.reason
  if (reason && reason.kind === 'error') {
    const msg = (reason.error && reason.error.message) || reason.message || '请求出错'
    appendLine('⚠ ' + msg, 'tool')
  }
  turnMessages.clear()
  streamingBlocks = {}
  chunkRenderedTexts.clear()
}

function renderMd(text) {
  const lines = text.split('\n')
  const out = []
  let inList = false
  let inCode = false
  let codeLines = []
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (inCode) {
        out.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>')
        codeLines = []
        inCode = false
      } else {
        if (inList) { out.push('</ul>'); inList = false }
        inCode = true
      }
      continue
    }
    if (inCode) { codeLines.push(line); continue }
    const h3 = /^### (.+)/.exec(line)
    const h2 = /^## (.+)/.exec(line)
    const h1 = /^# (.+)/.exec(line)
    if (h1 || h2 || h3) {
      if (inList) { out.push('</ul>'); inList = false }
      const tag = h1 ? 'h3' : h2 ? 'h2' : 'h3'
      out.push(`<${tag}>${inline(h1?.[1] || h2?.[1] || h3?.[1])}</${tag}>`)
    } else if (/^- (.+)/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push('<li>' + inline(line.slice(2)) + '</li>')
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<br>')
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<p>' + inline(line) + '</p>')
    }
  }
  if (inCode) out.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>')
  if (inList) out.push('</ul>')
  return out.join('')
}
function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function handleAssistantChunk(inner) {
  const chunk = inner.chunk
  if (!chunk) return
  const idx = chunk.index
    if (chunk.type === 'block-start') {
    hidePending()
    if (chunk.blockType === 'reasoning') {
      reasoningBodyFor(idx, true)
    } else if (chunk.blockType === 'text') {
      const el = document.createElement('div')
      el.className = 'assistant'
      el.innerHTML = ''
      log.appendChild(el)
      streamingBlocks[idx] = { type: 'text', el }
    }
  } else if (chunk.type === 'reasoning-delta') {
    hidePending()
    const b = reasoningBodyFor(idx, true)
    b.el.textContent += (chunk.text || '')
  } else if (chunk.type === 'text-delta' && streamingBlocks[idx]) {
    const b = streamingBlocks[idx]
    if (b.type === 'text') {
      b._raw = (b._raw || '') + (chunk.text || '')
      b.el.innerHTML = renderMd(b._raw)
    }
  } else if (chunk.type === 'block-end') {
    const b = streamingBlocks[idx]
    if (b) {
      if (b.type === 'reasoning') {
        if (chunk.block?.text) b.el.textContent = chunk.block.text
        if (b.wrapper?._setDone) b.wrapper._setDone()
      } else if (chunk.block && chunk.block.text) {
        b.el.innerHTML = renderMd(chunk.block.text)
        chunkRenderedTexts.add(normText(chunk.block.text))
      }
    }
    delete streamingBlocks[idx]
  }
  log.scrollTop = log.scrollHeight
}

function handleSessionTitle(ev) {
  const title = ev.data && ev.data.title
  if (title && statusEl) { statusTitle = 'AI · ' + title; statusEl.textContent = statusTitle }
}

function dispatchFrame(f) {
  const t = f.type
  if (t === 'session/subscribed') return
  if (t === 'agent/inbox/spliced') return handleInboxSpliced(f)
  if (t === 'turn/start') { turnMessages.clear(); streamingBlocks = {}; chunkRenderedTexts.clear(); clearQuestions(); setRunning(true); return }
  if (t === 'turn/end') { setRunning(false); return handleTurnEnd(f) }
  if (t === 'session/title') return handleSessionTitle(f)
  if (t === 'session/projection') return renderProjection(f)
  if (t === 'question/requested') return handleQuestionRequested(f)
  if (t === 'assistant/message') return renderAssistantMessage(f.data?.message || f.message)
  if (t === 'request/header' || t === 'request/context' || t === 'session/title-llm-request' ||
      t === 'llm/retry' || t === 'llm/retry-started' || t === 'session/queue') return
  if (t === 'session/event') {
    const inner = f.event || f
    const it = inner && inner.type
    if (it === 'step/start') {
      renderStep(inner)
      log.scrollTop = log.scrollHeight
    } else if (it === 'assistant/chunk') {
      handleAssistantChunk(inner.data || inner)
    } else if (it === 'assistant/message') {
      renderAssistantMessage(inner.data?.message || inner.message)
    }
    return
  }
  appendLine('[未识别] ' + t + ' ' + JSON.stringify(f).slice(0, 200), 'tool')
}

function handleQuestionRequested(f) {
  if (!userSentMessage) return
  const questions = f.questions || f.data?.questions || []
  for (const q of questions) {
    const card = document.createElement('div')
    card.className = 'approval'
    const head = document.createElement('div')
    head.className = 'tool'
    head.textContent = '💬 ' + (q.question || q.header || '提问')
    card.appendChild(head)
    const opts = q.options || []
    for (const opt of opts) {
      const btn = document.createElement('button')
      btn.className = 'allow'
      btn.textContent = opt.label || opt.text || opt
      btn.onclick = () => {
        vscode.postMessage({ kind: 'answer', rpcId: f._rpcId, questionId: q.id, response: opt.label || opt.text || String(opt) })
        card.innerHTML = '<div class="tool">已选择: ' + (opt.label || opt) + '</div>'
        setTimeout(() => card.remove(), 2000)
      }
      card.appendChild(btn)
    }
    log.appendChild(card)
  }
  log.scrollTop = log.scrollHeight
}

function renderProjection(p) {
  if (p.key === 'title' && typeof p.value === 'string') {
    statusTitle = 'AI · ' + p.value
    document.title = statusTitle
    if (statusEl) statusEl.textContent = statusTitle
  } else if (p.key === 'tokenUsage') {
    lastTokenUsage = p.value
    updateCtxChip(p.value, undefined)
  } else if (p.key === 'contextPressure') {
    updateCtxChip(lastTokenUsage, p.value)
  }
}
let lastTokenUsage = null

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function renderApproval(m) {
  hideHero()
  const card = document.createElement('div')
  card.className = 'approval'
  card.id = 'ap-' + m.approvalId
  const head = document.createElement('div')
  head.className = 'tool'
  head.innerHTML = '⚠ 请求执行：' + escapeHtml(m.toolName) + (m.reason ? ' — ' + escapeHtml(m.reason) : '')
  card.appendChild(head)
  const allow = document.createElement('button')
  allow.className = 'allow'
  allow.textContent = '允许一次'
  allow.onclick = () => answer(m.approvalId, 'allowed-once', card)
  const always = document.createElement('button')
  always.className = 'always'
  always.textContent = '始终允许'
  always.onclick = () => answer(m.approvalId, 'always', card)
  const deny = document.createElement('button')
  deny.className = 'deny'
  deny.textContent = '拒绝'
  deny.onclick = () => answer(m.approvalId, 'rejected', card)
  card.appendChild(allow)
  card.appendChild(always)
  card.appendChild(deny)
  log.appendChild(card)
  log.scrollTop = log.scrollHeight
}

function answer(approvalId, outcome, card) {
  if (outcome === 'always') vscode.postMessage({ kind: 'respondAlways', approvalId })
  else vscode.postMessage({ kind: 'respond', approvalId, outcome })
  const label = outcome === 'always' ? '始终允许' : outcome === 'allowed-once' ? '允许' : '拒绝'
  if (card) card.innerHTML = '<div class="tool">已' + label + '</div>'
}

window.addEventListener('message', (e) => {
  const m = e.data
  if (m.kind === 'init') {
    modelsData = m.models
    modelSel.innerHTML = ''
    for (const g of m.models.groups || []) {
      const og = document.createElement('optgroup')
      og.label = g.name
      for (const md of g.models || []) {
        const o = document.createElement('option')
        o.value = JSON.stringify({ provider: g.id, model: md.id })
        o.textContent = md.name
        og.appendChild(o)
      }
      modelSel.appendChild(og)
    }
    const cur = m.models.current
    if (cur) {
      const want = JSON.stringify({ provider: cur.provider, model: cur.model })
      for (const o of modelSel.options) if (o.value === want) { o.selected = true; break }
    }
    syncEffortOptions(cur?.reasoningEffort)
    activeSessionId = m.sessionId
    vscode.setState({ sessionId: m.sessionId })
    setRunning(false)
    if (m.workspaces && m.sessions) renderSidebar(m.workspaces, m.sessions)
    // 新建会话用空态 hero 引导；恢复的历史会话由后续 history 回放填充
    if (m.fresh) ensureHero()
    else vscode.postMessage({ kind: 'loadHistory', sessionId: m.sessionId })
  } else if (m.kind === 'workspaces') {
    if (m.workspaces && m.sessions) renderSidebar(m.workspaces, m.sessions)
    // 当前会话的投影里带 tokenUsage/contextPressure 时同步 chip
    const cur = cachedSessions.find(s => s.sessionId === activeSessionId)
    if (cur) updateCtxChip(cur.projections?.values?.tokenUsage, cur.projections?.values?.contextPressure)
  } else if (m.kind === 'sessionSwitched') {
    activeSessionId = m.sessionId
    sessionHasContent = false
    vscode.setState({ sessionId: m.sessionId })
    log.innerHTML = ''
    streamingBlocks = {}
    turnMessages.clear()
    chunkRenderedTexts.clear()
    setRunning(false)
    ensureHero()
    vscode.postMessage({ kind: 'loadWorkspaces' })
  } else if (m.kind === 'gateway') {
    if (gwDot) {
      gwDot.classList.toggle('wait', m.status === 'connecting')
      gwDot.classList.toggle('off', m.status === 'closed')
      gwDot.title = m.status === 'closed' ? 'DSH 网关未连接（自动重连中）' : m.status === 'connecting' ? '正在连接 DSH 网关' : 'DSH 网关已连接'
    }
    if (m.status === 'closed') {
      statusEl.textContent = '⚠ DSH 网关未连接（自动重连中）'
      statusEl.classList.add('warn')
    } else if (m.status === 'open') {
      statusEl.textContent = statusTitle
      statusEl.classList.remove('warn')
    }
  } else if (m.kind === 'autoApproved') {
    appendLine('✓ 已按「始终允许」放行：' + m.toolName, 'tool')
  } else if (m.kind === 'history') {
    log.innerHTML = ''
    streamingBlocks = {}
    chunkRenderedTexts.clear()
    const evs = m.events || []
    sessionHasContent = evs.length > 0
    for (const ev of evs) renderHistoryEvent(ev)
    if (!sessionHasContent) ensureHero()
  } else if (m.kind === 'frame') {
    m.frame._rpcId = m.rpcId
    dispatchFrame(m.frame)
  } else if (m.kind === 'approval') {
    renderApproval(m)
  } else if (m.kind === 'approvalResolved') {
    const card = document.getElementById('ap-' + m.approvalId)
    if (card) card.innerHTML = '<div class="tool">已' + (m.outcome === 'allowed-once' ? '允许' : '拒绝') + '</div>'
  } else if (m.kind === 'error') {
    hidePending()
    appendLine('⚠ ' + m.message, 'tool')
  } else if (m.kind === 'settings') {
    if (cfgGateway) cfgGateway.value = m.gatewayBase || ''
    if (cfgDshCmd) cfgDshCmd.value = m.dshCommand || ''
    if (cfgToolList) {
      cfgToolList.innerHTML = ''
      const allTools = new Set([...(m.knownTools || []), ...(m.autoAllowTools || [])])
      const allowed = new Set(m.autoAllowTools || [])
      for (const tool of allTools) {
        const label = document.createElement('label')
        label.className = 'tool-toggle'
        const cb = document.createElement('input')
        cb.type = 'checkbox'
        cb.checked = allowed.has(tool)
        cb.dataset.tool = tool
        label.appendChild(cb)
        label.appendChild(document.createTextNode(tool))
        cfgToolList.appendChild(label)
      }
      if (cfgToolsEmpty) cfgToolsEmpty.style.display = allTools.size === 0 ? '' : 'none'
    }
  } else if (m.kind === 'settingsSaved') {
    closeSettings()
  }
})

modelSel.onchange = () => {
  syncEffortOptions()
  sendSelectModel()
}
if (effortSel) effortSel.onchange = () => sendSelectModel()

let optimisticUserEl = null
let optimisticUserText = ''

function send() {
  const text = ta.value.trim()
  if (!text) return
  userSentMessage = true
  vscode.postMessage({ kind: 'prompt', text })
  ta.value = ''
  optimisticUserText = text
  optimisticUserEl = bubble(text, 'user')
  showPending()
}

if (sendBtn) sendBtn.onclick = send
if (stopBtn) stopBtn.onclick = () => vscode.postMessage({ kind: 'stop' })

editBtn.onclick = () => vscode.postMessage({ kind: 'toggleEdit' })

if (newSessionBtn) newSessionBtn.onclick = () => {
  activeSessionId = null
  userSentMessage = false
  log.innerHTML = ''
  if (ctxChip) ctxChip.hidden = true
  if (inCtx) inCtx.textContent = ''
  vscode.postMessage({ kind: 'newSession' })
}

if (sessFilter) sessFilter.addEventListener('input', () => renderSidebar(cachedWorkspaces, cachedSessions))

// textarea 自动增高（上限由 CSS max-height 控制）
ta.addEventListener('input', () => {
  ta.style.height = 'auto'
  ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'
})

ta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  else if (e.key === 'Enter' && e.shiftKey) { /* newline */ }
})

function openSettings() {
  vscode.postMessage({ kind: 'getSettings' })
  if (settingsOverlay) settingsOverlay.hidden = false
}
function closeSettings() {
  if (settingsOverlay) settingsOverlay.hidden = true
}
if (settingsBtn) settingsBtn.onclick = openSettings
if (settingsClose) settingsClose.onclick = closeSettings
if (settingsOverlay) settingsOverlay.onclick = (e) => { if (e.target === settingsOverlay) closeSettings() }
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && settingsOverlay && !settingsOverlay.hidden) closeSettings()
})
if (settingsSave) settingsSave.onclick = () => {
  const tools = []
  if (cfgToolList) {
    cfgToolList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.checked) tools.push(cb.dataset.tool)
    })
  }
  vscode.postMessage({
    kind: 'saveSettings',
    gatewayBase: cfgGateway ? cfgGateway.value.trim() : undefined,
    dshCommand: cfgDshCmd ? cfgDshCmd.value.trim() : undefined,
    autoAllowTools: tools,
  })
}

// 优先携带上次的 sessionId，由扩展侧验证后复用，避免每次重建 webview 都新建会话
const savedState = vscode.getState() || {}
vscode.postMessage({ kind: 'ready', sessionId: savedState.sessionId })