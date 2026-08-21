// 打印 events.mux 原始帧结构，确认流式事件的真实形状（修正 ttft.mjs 的匹配路径）
const BASE = 'http://127.0.0.1:3080'

async function rpc(method, payload) {
  const body = { type: 'client-request', rpcId: crypto.randomUUID(), method, payload }
  const j = await (await fetch(`${BASE}/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json()
  const r = j.result ?? j
  if (r.ok === false) throw new Error(`${method} -> ${JSON.stringify(r.error ?? r)}`)
  return r.value
}

const t0 = Date.now()
let ttft = null

;(async () => {
  const { sessionId } = await rpc('session.create', { cwd: '/tmp' })
  console.log('session:', sessionId)
  await rpc('session.selectModel', { sessionId, provider: 'xiaomi', model: 'mimo-v2.5' })

  const ws = new WebSocket('ws://127.0.0.1:3080/api/events.mux')
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data)
    const p = m?.payload
    if (!p) return
    if (p.sessionId && p.sessionId !== sessionId) return
    const dt = Date.now() - t0
    const s = JSON.stringify(p)
    if (/reasoning|delta|turn\/end|inbox/.test(s)) {
      console.log(`${dt}ms`, p.type, s.slice(0, 320))
      if (/delta/.test(s) && ttft == null) { ttft = dt; console.log('>>> TTFT =', dt, 'ms') }
    } else {
      console.log(`${dt}ms`, p.type)
    }
    if (p.type === 'turn/end') { ws.close(); process.exit(0) }
  })
  await new Promise((r) => setTimeout(r, 300))
  console.log('--- prompt sent ---')
  await rpc('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text: '简要说明：为什么天是蓝色的？三句话以内。' }] })
  setTimeout(() => { console.log('>>> 40s 超时, TTFT =', ttft); process.exit(0) }, 40000)
})().catch((e) => { console.error('FAIL', e.message); process.exit(1) })
