const vscode = acquireVsCodeApi()

const log = document.getElementById('log')
const modelSel = document.getElementById('model')
const ta = document.getElementById('ta')
const sendBtn = document.getElementById('send')
const editBtn = document.getElementById('edit')
const statusEl = document.getElementById('status')
const wsList = document.getElementById('ws-list')
const newSessionBtn = document.getElementById('new-session')

let curAssistant = null
let curStep = null
let curReasoning = null
let turnMessages = new Map()
let streamingBlocks = {}
let activeSessionId = null

function renderSidebar(workspaces, sessions) {
  wsList.innerHTML = ''
  const sessionMap = {}
  for (const s of sessions) sessionMap[s.sessionId] = s
  const assignedIds = new Set()
  for (const ws of workspaces) for (const sid of (ws.sessionIds || [])) assignedIds.add(sid)
  // Ungrouped sessions
  const ungrouped = sessions.filter(s => !assignedIds.has(s.sessionId))
  if (ungrouped.length > 0) {
    const group = document.createElement('div')
    group.className = 'ws-group'
    const name = document.createElement('div')
    name.className = 'ws-name open'
    name.innerHTML = '<span class="arrow">▸</span> 未分组 (' + ungrouped.length + ')'
    const sessContainer = document.createElement('div')
    sessContainer.className = 'ws-sessions open'
    name.onclick = () => { name.classList.toggle('open'); sessContainer.classList.toggle('open') }
    for (const s of ungrouped) {
      const item = document.createElement('div')
      item.className = 'sess-item' + (s.sessionId === activeSessionId ? ' active' : '')
      const title = s.projections?.values?.title || s.sessionId.slice(0, 12)
      const time = s.updatedAt ? timeAgo(s.updatedAt) : ''
      item.innerHTML = '<span class="sess-title">' + escHtml(title) + '</span><span class="sess-time">' + time + '</span>'
      item.onclick = () => loadHistory(s.sessionId)
      sessContainer.appendChild(item)
    }
    group.appendChild(name)
    group.appendChild(sessContainer)
    wsList.appendChild(group)
  }
  // Workspaces
  for (const ws of workspaces) {
    const group = document.createElement('div')
    group.className = 'ws-group'
    const name = document.createElement('div')
    name.className = 'ws-name open'
    name.innerHTML = '<span class="arrow">▸</span> ' + (ws.title || ws.path.split('/').pop())
    const sessContainer = document.createElement('div')
    sessContainer.className = 'ws-sessions open'
    name.onclick = () => { name.classList.toggle('open'); sessContainer.classList.toggle('open') }
    for (const sid of ws.sessionIds || []) {
      const s = sessionMap[sid]
      if (!s) continue
      const item = document.createElement('div')
      item.className = 'sess-item' + (sid === activeSessionId ? ' active' : '')
      const title = s.projections?.values?.title || sid.slice(0, 12)
      const time = s.updatedAt ? timeAgo(s.updatedAt) : ''
      item.innerHTML = '<span class="sess-title">' + escHtml(title) + '</span><span class="sess-time">' + time + '</span>'
      item.onclick = () => loadHistory(sid)
      sessContainer.appendChild(item)
    }
    group.appendChild(name)
    group.appendChild(sessContainer)
    wsList.appendChild(group)
  }
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
  log.innerHTML = ''
  vscode.postMessage({ kind: 'loadHistory', sessionId })
}

function renderHistoryEvent(ev) {
  if (!ev) return
  const t = ev.type
  if (t === 'agent/inbox/spliced') {
    const inserted = ev.data?.inserted || []
    for (const msg of inserted) {
      if (msg.role === 'user') {
        const text = (msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('')
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
        el.innerHTML = ''
        log.appendChild(el)
        streamingBlocks[idx] = { type: 'text', el, raw: '' }
      } else if (chunk.blockType === 'reasoning') {
        const wrapper = document.createElement('div')
        wrapper.className = 'reasoning collapsed'
        const toggle = document.createElement('div')
        toggle.className = 'reasoning-toggle'
        toggle.textContent = '▸ 思考过程'
        toggle.onclick = () => wrapper.classList.toggle('collapsed')
        const body = document.createElement('div')
        body.className = 'reasoning-body'
        wrapper.appendChild(toggle)
        wrapper.appendChild(body)
        log.appendChild(wrapper)
        streamingBlocks[idx] = { type: 'reasoning', el: body }
      }
    } else if (chunk.type === 'text-delta' && streamingBlocks[idx]) {
      streamingBlocks[idx].raw += (chunk.text || '')
    } else if (chunk.type === 'reasoning-delta' && streamingBlocks[idx]) {
      streamingBlocks[idx].el.textContent += (chunk.text || '')
    } else if (chunk.type === 'block-end' && streamingBlocks[idx]) {
      const b = streamingBlocks[idx]
      if (chunk.block?.text) {
        b.el.innerHTML = renderMd(chunk.block.text)
      }
      delete streamingBlocks[idx]
    }
  } else if (t === 'assistant/message') {
    const msg = ev.data?.message
    if (!msg?.content) return
    for (const c of msg.content) {
      if (c.type === 'text' && c.text) bubble(c.text, 'assistant')
      else if (c.type === 'reasoning' && c.text) {
        const wrapper = document.createElement('div')
        wrapper.className = 'reasoning collapsed'
        const toggle = document.createElement('div')
        toggle.className = 'reasoning-toggle'
        toggle.textContent = '▸ 思考过程'
        toggle.onclick = () => wrapper.classList.toggle('collapsed')
        const body = document.createElement('div')
        body.className = 'reasoning-body'
        body.textContent = c.text
        wrapper.appendChild(toggle)
        wrapper.appendChild(body)
        log.appendChild(wrapper)
      }
    }
  } else if (t === 'session/event') {
    const inner = ev.event
    if (!inner) return
    const it = inner.type
    if (it === 'step/start') {
      const toolName = inner.data?.name || inner.data?.toolName || ''
      const toolTitle = inner.data?.title || ''
      const label = toolTitle || toolName
      if (!label) return
      const stepEl = document.createElement('div')
      stepEl.className = 'step'
      const h = document.createElement('div')
      h.className = 'head'
      h.textContent = '▸ ' + label
      stepEl.appendChild(h)
      log.appendChild(stepEl)
    }
  }
  log.scrollTop = log.scrollHeight
}

function clearQuestions() {
  log.querySelectorAll('.approval').forEach(el => el.remove())
}

function bubble(text, cls) {
  const d = document.createElement('div')
  d.className = 'bubble ' + (cls || '')
  d.textContent = text
  log.appendChild(d)
  log.scrollTop = log.scrollHeight
  return d
}

function appendLine(text, cls) {
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

function handleInboxSpliced(ev) {
  const d = ev.data || {}
  const inserted = Array.isArray(d.inserted) ? d.inserted : []
  const start = typeof d.start === 'number' ? d.start : 0
  console.log('[inbox]', JSON.stringify(ev).slice(0, 500))
  for (let i = 0; i < inserted.length; i++) {
    const item = inserted[i]
    const idx = start + i
    const text = extractText(item.content) || extractText(item.text) || extractText(item.message)
    const kind = (item.source && item.source.kind) || item.role || ''
    const isUser = kind === 'user'
    const isReasoning = kind === 'reasoning' || kind === 'thinking'
    if (!text) continue
    const cls = isUser ? 'user' : isReasoning ? 'reasoning' : 'assistant'
    if (isUser && optimisticUserEl && text === optimisticUserText) {
      optimisticUserEl = null
      optimisticUserText = ''
      continue
    }
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
  const reason = ev.data && ev.data.reason
  if (reason && reason.kind === 'error') {
    const msg = (reason.error && reason.error.message) || reason.message || '请求出错'
    appendLine('⚠ ' + msg, 'tool')
  }
  turnMessages.clear()
  streamingBlocks = {}
}

function renderMd(text) {
  const lines = text.split('\n')
  const out = []
  let inList = false
  for (const line of lines) {
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
  if (inList) out.push('</ul>')
  return out.join('')
}
function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function handleAssistantChunk(inner) {
  const chunk = inner.chunk
  if (!chunk) return
  const idx = chunk.index
    if (chunk.type === 'block-start') {
    if (chunk.blockType === 'reasoning') {
      const wrapper = document.createElement('div')
      wrapper.className = 'reasoning collapsed'
      const toggle = document.createElement('div')
      toggle.className = 'reasoning-toggle'
      toggle.textContent = '▸ 思考过程'
      toggle.onclick = () => wrapper.classList.toggle('collapsed')
      const body = document.createElement('div')
      body.className = 'reasoning-body'
      wrapper.appendChild(toggle)
      wrapper.appendChild(body)
      log.appendChild(wrapper)
      streamingBlocks[idx] = { type: 'reasoning', el: body }
    } else if (chunk.blockType === 'text') {
      const el = document.createElement('div')
      el.className = 'assistant'
      el.innerHTML = ''
      log.appendChild(el)
      streamingBlocks[idx] = { type: 'text', el }
    }
  } else if (chunk.type === 'reasoning-delta' && streamingBlocks[idx]) {
    const b = streamingBlocks[idx]
    if (b.type === 'reasoning') b.el.textContent += (chunk.text || '')
  } else if (chunk.type === 'text-delta' && streamingBlocks[idx]) {
    const b = streamingBlocks[idx]
    if (b.type === 'text') {
      b._raw = (b._raw || '') + (chunk.text || '')
      b.el.innerHTML = renderMd(b._raw)
    }
  } else if (chunk.type === 'block-end') {
    if (chunk.block && chunk.block.text && streamingBlocks[idx]) {
      const b = streamingBlocks[idx]
      b.el.innerHTML = renderMd(chunk.block.text)
    }
    delete streamingBlocks[idx]
  }
  log.scrollTop = log.scrollHeight
}

function handleSessionTitle(ev) {
  const title = ev.data && ev.data.title
  if (title && statusEl) statusEl.textContent = 'AI · ' + title
}

function dispatchFrame(f) {
  const t = f.type
  if (t === 'session/subscribed') return
  if (t === 'agent/inbox/spliced') return handleInboxSpliced(f)
  if (t === 'turn/start') { turnMessages.clear(); clearQuestions(); return }
  if (t === 'turn/end') return handleTurnEnd(f)
  if (t === 'session/title') return handleSessionTitle(f)
  if (t === 'session/projection') return renderProjection(f)
  if (t === 'question/requested') return handleQuestionRequested(f)
  if (t === 'request/header' || t === 'request/context' || t === 'session/title-llm-request' ||
      t === 'llm/retry' || t === 'llm/retry-started' || t === 'session/queue') return
  if (t === 'session/event') {
    const inner = f.event || f
    const it = inner && inner.type
    if (it === 'step/start') {
      const toolName = inner.name || inner.toolName || inner.tool || ''
      const toolTitle = inner.title || ''
      const label = toolTitle || toolName
      if (!label) return
      const stepEl = document.createElement('div')
      stepEl.className = 'step'
      const h = document.createElement('div')
      h.className = 'head'
      h.textContent = '▸ ' + label
      stepEl.appendChild(h)
      if (inner.input || inner.arguments || inner.params) {
        const argEl = document.createElement('div')
        argEl.className = 'tool'
        const args = inner.input || inner.arguments || inner.params
        argEl.textContent = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
        stepEl.appendChild(argEl)
      }
      log.appendChild(stepEl)
      log.scrollTop = log.scrollHeight
    } else if (it === 'assistant/chunk') {
      handleAssistantChunk(inner.data || inner)
    }
    return
  }
  appendLine('[未识别] ' + t + ' ' + JSON.stringify(f).slice(0, 200), 'tool')
}

function handleQuestionRequested(f) {
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
      }
      card.appendChild(btn)
    }
    log.appendChild(card)
  }
  log.scrollTop = log.scrollHeight
}

function renderProjection(p) {
  if (p.key === 'title' && typeof p.value === 'string') {
    document.title = 'AI · ' + p.value
    if (statusEl) statusEl.textContent = 'AI · ' + p.value
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function renderApproval(m) {
  const card = document.createElement('div')
  card.className = 'approval'
  card.id = 'ap-' + m.approvalId
  const head = document.createElement('div')
  head.className = 'tool'
  head.innerHTML = '⚠ 请求执行：' + escapeHtml(m.toolName) + (m.reason ? ' — ' + escapeHtml(m.reason) : '')
  card.appendChild(head)
  const allow = document.createElement('button')
  allow.textContent = '允许一次'
  allow.onclick = () => answer(m.approvalId, 'allowed-once', card)
  const deny = document.createElement('button')
  deny.textContent = '拒绝'
  deny.onclick = () => answer(m.approvalId, 'rejected', card)
  card.appendChild(allow)
  card.appendChild(deny)
  log.appendChild(card)
  log.scrollTop = log.scrollHeight
}

function answer(approvalId, outcome, card) {
  vscode.postMessage({ kind: 'respond', approvalId, outcome })
  if (card) card.innerHTML = '<div class="tool">已' + (outcome === 'allowed-once' ? '允许' : '拒绝') + '</div>'
}

window.addEventListener('message', (e) => {
  const m = e.data
  if (m.kind === 'init') {
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
    activeSessionId = m.sessionId
    if (m.workspaces && m.sessions) renderSidebar(m.workspaces, m.sessions)
    appendLine('AI 对话已就绪 · 模型: ' + (cur ? cur.provider + '/' + cur.model : '?'), 'tool')
    bubble('我是 Codon AI 助手。描述一个任务，我会调用工具并在右侧编辑器中落地改动；遇到写文件等敏感操作会先向你申请授权。', 'assistant')
  } else if (m.kind === 'workspaces') {
    if (m.workspaces && m.sessions) renderSidebar(m.workspaces, m.sessions)
  } else if (m.kind === 'history') {
    log.innerHTML = ''
    streamingBlocks = {}
    for (const ev of (m.events || [])) renderHistoryEvent(ev)
  } else if (m.kind === 'frame') {
    m.frame._rpcId = m.rpcId
    dispatchFrame(m.frame)
  } else if (m.kind === 'approval') {
    renderApproval(m)
  } else if (m.kind === 'approvalResolved') {
    const card = document.getElementById('ap-' + m.approvalId)
    if (card) card.innerHTML = '<div class="tool">已' + (m.outcome === 'allowed-once' ? '允许' : '拒绝') + '</div>'
  } else if (m.kind === 'error') {
    appendLine('⚠ ' + m.message, 'tool')
  }
})

modelSel.onchange = () => {
  const v = JSON.parse(modelSel.value)
  vscode.postMessage({ kind: 'selectModel', provider: v.provider, model: v.model })
}

let optimisticUserEl = null
let optimisticUserText = ''

function send() {
  const text = ta.value.trim()
  if (!text) return
  vscode.postMessage({ kind: 'prompt', text })
  ta.value = ''
  // optimistic: show user message immediately
  optimisticUserText = text
  optimisticUserEl = bubble(text, 'user')
}

if (sendBtn) sendBtn.onclick = send

editBtn.onclick = () => vscode.postMessage({ kind: 'toggleEdit' })

if (newSessionBtn) newSessionBtn.onclick = () => {
  activeSessionId = null
  log.innerHTML = ''
  vscode.postMessage({ kind: 'ready' })
}

ta.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  else if (e.key === 'Enter' && e.shiftKey) { /* newline */ }
})

vscode.postMessage({ kind: 'ready' })
