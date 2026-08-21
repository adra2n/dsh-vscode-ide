// A/B 首 token 延迟测试：对比不同 provider/model 在同一网关上的 TTFT。
const BASE = process.env.DSH_BASE || 'http://127.0.0.1:3080'

function rpc(method, payload) {
  const body = { type: 'client-request', rpcId: crypto.randomUUID(), method, payload }
  return fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
    .then(r => r.json())
    .then(json => {
      const res = json.result ?? json
      if (!res.ok) throw new Error(`${method} -> ${JSON.stringify(res.error ?? res)}`)
      return res.value
    })
}

async function timeModel(provider, model, reasoningEffort) {
  const t0 = Date.now()
  const { sessionId } = await rpc('session.create', { cwd: '/tmp' })
  await rpc('session.selectModel', { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) })

  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/api/events.mux')
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let tCreate = Date.now() - t0
  let ttft = null, tDone = null, outLen = 0

  ws.onmessage = (ev) => {
    const p = JSON.parse(ev.data)?.payload
    if (!p || (p.sessionId && p.sessionId !== sessionId)) return
    // 实测帧形状：{type:'session/event', event:{type:'assistant/chunk', data:{chunk}}}
    const inner = p.event || p
    const chunk = inner.data?.chunk || inner.chunk
    if (chunk && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) {
      if (ttft == null) ttft = Date.now() - t0
      outLen += (chunk.text || '').length
    }
    if (inner.type === 'turn/end') { tDone = Date.now() - t0; ws.close() }
  }

  await new Promise(r => setTimeout(r, 200)) // 等订阅就绪
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: '用一句话回答：1+1等于几？' }] })

  const deadline = Date.now() + 60000
  while (tDone == null && Date.now() < deadline) await new Promise(r => setTimeout(r, 200))
  ws.close()
  const label = `${provider}/${model}${reasoningEffort ? ' (effort=' + reasoningEffort + ')' : ''}`
  console.log(`${label.padEnd(48)} setup=${tCreate}ms  TTFT=${ttft ?? '∞'}ms  total=${tDone ?? '超时'}ms  chars=${outLen}`)
}

const cases = process.argv.slice(2)
;(async () => {
  if (cases.length === 0) {
    await timeModel('xiaomi', 'mimo-v2.5')
    await timeModel('deepseek-official', 'deepseek-v4-flash', 'off')
    await timeModel('deepseek-official', 'deepseek-v4-flash', 'low')
  } else {
    for (const c of cases) {
      const [provider, model, effort] = c.split(':')
      await timeModel(provider, model, effort)
    }
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
