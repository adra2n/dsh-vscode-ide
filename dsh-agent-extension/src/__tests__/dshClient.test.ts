import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshClient, GatewayStatus } from '../dshClient'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }
  url: string
  private listeners = new Map<string, ((ev?: any) => void)[]>()
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  addEventListener(type: string, cb: (ev?: any) => void) {
    const arr = this.listeners.get(type) ?? []
    arr.push(cb)
    this.listeners.set(type, arr)
  }
  emit(type: string, ev?: any) {
    for (const cb of [...(this.listeners.get(type) ?? [])]) cb(ev)
  }
  emitMessage(payload: unknown) {
    this.emit('message', { data: JSON.stringify({ rpcId: 'srv-rpc', payload }) })
  }
  close() {
    this.emit('close')
  }
}

function okFetch(value: unknown) {
  return vi.fn(async () => ({ json: async () => ({ result: { ok: true, value } }) }))
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('DshClient rpc', () => {
  it('sends the client-request envelope to /api/<method> and unwraps result.value', async () => {
    const fetchMock = okFetch({ items: [{ sessionId: 's1' }] })
    vi.stubGlobal('fetch', fetchMock)
    const client = new DshClient('http://127.0.0.1:3080')

    const res = await client.listSessions()

    expect(res.items).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:3080/api/session.list')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.type).toBe('client-request')
    expect(body.method).toBe('session.list')
    expect(body.rpcId).toBeTruthy()
    expect(body.payload).toEqual({})
  })

  it('rejects with method + error when gateway answers ok:false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ result: { ok: false, error: { message: 'boom' } } }) }))
    )
    const client = new DshClient('http://127.0.0.1:3080')
    await expect(client.listSessions()).rejects.toThrow(/session\.list.*boom/s)
  })

  it('rejects with a timeout message after RPC_TIMEOUT_MS', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: any) =>
          new Promise((_res, rej) => {
            init.signal.addEventListener('abort', () =>
              rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            )
          })
      )
    )
    const client = new DshClient('http://127.0.0.1:3080')
    const p = client.listSessions().catch((e) => e)
    await vi.advanceTimersByTimeAsync(15_000)
    const err = await p
    expect(err.message).toContain('超时')
    expect(err.message).toContain('session.list')
  })

  it('rejects with a connection error when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new TypeError('ECONNREFUSED')))
    )
    const client = new DshClient('http://127.0.0.1:3080')
    await expect(client.listSessions()).rejects.toThrow(/无法连接 DSH 网关/)
  })
})

describe('DshClient respond envelope', () => {
  it('posts client-response to /api/respond', async () => {
    const fetchMock = okFetch({})
    vi.stubGlobal('fetch', fetchMock)
    const client = new DshClient('http://127.0.0.1:3080')
    await client.respond('rpc-42', { outcome: 'allowed-once' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:3080/api/respond')
    const body = JSON.parse(init.body)
    expect(body).toEqual({
      type: 'client-response',
      rpcId: 'rpc-42',
      result: { ok: true, value: { outcome: 'allowed-once' } },
    })
  })
})

describe('DshClient event stream', () => {
  function framesOf(client: DshClient): { rpcId: string; payload: any }[] {
    const got: { rpcId: string; payload: any }[] = []
    client.onFrame((rpcId, payload) => got.push({ rpcId, payload }))
    return got
  }

  it('connects via ws://…/api/events.mux on attachSession', () => {
    vi.stubGlobal('fetch', okFetch({}))
    const client = new DshClient('http://127.0.0.1:3080')
    client.attachSession('s1')
    expect(FakeWebSocket.last().url).toBe('ws://127.0.0.1:3080/api/events.mux')
  })

  it('filters frames by session but passes global frames through', () => {
    vi.stubGlobal('fetch', okFetch({}))
    const client = new DshClient('http://127.0.0.1:3080')
    client.attachSession('s1')
    const got = framesOf(client)
    const ws = FakeWebSocket.last()

    ws.emitMessage({ type: 'session/event', sessionId: 's2' })
    ws.emitMessage({ type: 'session/event', sessionId: 's1', x: 1 })
    ws.emitMessage({ type: 'agent/status' })

    expect(got).toHaveLength(2)
    expect(got[0].payload.sessionId).toBe('s1')
    expect(got[1].payload.type).toBe('agent/status')
  })

  it('emits status transitions connecting → open → closed and reconnects with backoff', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', okFetch({}))
    const client = new DshClient('http://127.0.0.1:3080')
    const statuses: GatewayStatus[] = []
    client.onStatus((s) => statuses.push(s))

    client.attachSession('s1')
    const ws = FakeWebSocket.last()
    expect(statuses).toEqual(['connecting'])
    ws.emit('open')
    expect(statuses).toEqual(['connecting', 'open'])

    ws.close()
    expect(statuses.at(-1)).toBe('closed')

    // backoff: 500ms 后第一次重连
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.last().emit('open')

    // 第二次断线后 backoff 翻倍为 1000ms
    FakeWebSocket.last().close()
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(500)
    expect(FakeWebSocket.instances).toHaveLength(3)

    client.dispose()
  })

  it('caps reconnect delay at 10s', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', okFetch({}))
    const client = new DshClient('http://127.0.0.1:3080')
    client.attachSession('s1')

    // 断开一次后，测量每次重连实际等待的间隔；新 socket 生成后立即再断开以调度下一次退避
    async function nextGapMs(): Promise<number> {
      const before = FakeWebSocket.instances.length
      let t = 0
      while (FakeWebSocket.instances.length === before) {
        await vi.advanceTimersByTimeAsync(100)
        t += 100
        if (t > 30_000) throw new Error('reconnect did not fire')
      }
      FakeWebSocket.last().close()
      return t
    }

    FakeWebSocket.last().close()
    expect(await nextGapMs()).toBe(500) // base
    expect(await nextGapMs()).toBe(1000)
    expect(await nextGapMs()).toBe(2000)
    expect(await nextGapMs()).toBe(4000)
    expect(await nextGapMs()).toBe(8000)
    expect(await nextGapMs()).toBe(10_000) // capped（16000 → 10000）
    expect(await nextGapMs()).toBe(10_000)
    client.dispose()
  })

  it('ignores late events from a stale socket after reconnect', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', okFetch({}))
    const client = new DshClient('http://127.0.0.1:3080')
    const statuses: GatewayStatus[] = []
    client.onStatus((s) => statuses.push(s))

    client.attachSession('s1')
    const stale = FakeWebSocket.last()
    stale.close()
    await vi.advanceTimersByTimeAsync(500)

    statuses.length = 0
    stale.emit('open') // 迟到的旧 socket open 不应影响状态
    stale.emitMessage({ type: 'session/event', sessionId: 's1' })
    expect(statuses).toEqual([])
    client.dispose()
  })

  it('stops reconnecting after dispose', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', okFetch({}))
    const client = new DshClient('http://127.0.0.1:3080')
    client.attachSession('s1')
    FakeWebSocket.last().close()
    client.dispose()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

describe('DshClient session methods', () => {
  it('createSession returns id and opens the event stream', async () => {
    vi.stubGlobal('fetch', okFetch({ sessionId: 'new-1' }))
    const client = new DshClient('http://127.0.0.1:3080')
    const sid = await client.createSession('/tmp/proj')
    expect(sid).toBe('new-1')
    expect(client.currentSessionId).toBe('new-1')
    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it('sendPrompt uses queue mode with text content', async () => {
    const fetchMock = okFetch({})
    vi.stubGlobal('fetch', fetchMock)
    const client = new DshClient('http://127.0.0.1:3080')
    client.attachSession('s1')
    await client.sendPrompt('hello')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.method).toBe('session.prompt')
    expect(body.payload).toEqual({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hello' }] })
  })

  it('stopTurn calls session.stop', async () => {
    const fetchMock = okFetch({})
    vi.stubGlobal('fetch', fetchMock)
    const client = new DshClient('http://127.0.0.1:3080')
    client.attachSession('s1')
    await client.stopTurn()
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.method).toBe('session.stop')
    expect(body.payload).toEqual({ sessionId: 's1' })
  })
})
