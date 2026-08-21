// Minimal DSH gateway probe: create session, subscribe to mux WS, list models,
// send a prompt, and exercise selectModel. Validates the apiproxy wire contract
// our IDE will use (POST /api/<ns>.<method> + ws /api/events.mux).
const BASE = process.env.DSH_BASE || 'http://127.0.0.1:3080'
const WS = BASE.replace(/^http/, 'ws')

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

async function main() {
  const created = await rpc('session.create', { cwd: process.cwd() })
  const sessionId = created.sessionId
  console.log('✓ session.create ->', sessionId)

  const ws = new WebSocket(`${WS}/api/events.mux`)
  let open = false
  ws.addEventListener('open', () => { open = true; console.log('✓ ws open /api/events.mux') })
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
    const p = msg?.payload
    if (!p) return
    const tail = JSON.stringify(p).slice(0, 140)
    console.log(`  [mux] ${p.type}${p.sessionId ? ' @' + p.sessionId : ''} ${tail}`)
  })
  ws.addEventListener('error', (e) => console.error('ws error', e.message))
  while (!open) await new Promise(r => setTimeout(r, 50))

  const models = await rpc('session.models', { sessionId })
  console.log('✓ session.models -> current=', models.current, 'routable=', models.routable)
  console.log('  groups=', (models.groups || []).map(g => `${g.id}[${(g.models || []).map(m => m.id).join(',')}]`).join(' '))

  if (models.routable) {
    await rpc('session.prompt', {
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: 'Reply with the single word: pong' }],
    })
    console.log('✓ session.prompt sent; streaming events above (6s)…')
    await new Promise(r => setTimeout(r, 6000))
  } else {
    console.log('• no routable model (set a model + key in Settings→Models to run live); exercising selectModel on first catalog entry')
    const g = (models.groups || [])[0]
    if (g?.models?.[0]) {
      const sel = await rpc('session.selectModel', { sessionId, provider: g.id, model: g.models[0].id })
      console.log('✓ session.selectModel ->', sel.selected)
    }
  }

  ws.close()
  process.exit(0)
}

main().catch((e) => { console.error('SPIKE FAIL:', e.message); process.exit(1) })
