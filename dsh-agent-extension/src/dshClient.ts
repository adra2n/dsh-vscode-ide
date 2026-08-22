export interface ModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}
export interface ModelGroup {
  id: string
  name: string
  models: { id: string; name: string }[]
}
export interface ModelsView {
  current: ModelSelection
  routable: boolean
  groups: ModelGroup[]
  failures: { id: string; name: string; message: string }[]
}

export type GatewayStatus = 'connecting' | 'open' | 'closed'

const RPC_TIMEOUT_MS = 15000
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10000

export class DshClient {
  private base: string
  private ws?: WebSocket
  private sessionId?: string
  private listeners: ((rpcId: string, payload: any) => void)[] = []
  private statusListeners: ((status: GatewayStatus) => void)[] = []
  private reconnectDelay = RECONNECT_BASE_MS
  private reconnectTimer?: ReturnType<typeof setTimeout>
  private disposed = false

  constructor(base: string) {
    this.base = base
  }

  get currentSessionId(): string | undefined {
    return this.sessionId
  }

  onFrame(cb: (rpcId: string, payload: any) => void) {
    this.listeners.push(cb)
  }

  onStatus(cb: (status: GatewayStatus) => void) {
    this.statusListeners.push(cb)
  }

  private emitStatus(status: GatewayStatus) {
    this.statusListeners.forEach((l) => l(status))
  }

  private async rpc<T = any>(method: string, payload: any): Promise<T> {
    const body = { type: 'client-request', rpcId: crypto.randomUUID(), method, payload }
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS)
    let json: any
    try {
      const res = await fetch(`${this.base}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      })
      json = await res.json()
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        throw new Error(`${method} 超时（${RPC_TIMEOUT_MS / 1000}s）：请确认 DSH 网关正在运行（${this.base}）`, {
          cause: e,
        })
      }
      throw new Error(`无法连接 DSH 网关（${this.base}）：${e?.message ?? e}`, { cause: e })
    } finally {
      clearTimeout(timer)
    }
    const r = json.result ?? json
    if (!r.ok) throw new Error(`${method} -> ${JSON.stringify(r.error ?? r)}`)
    return r.value as T
  }

  async createSession(cwd: string): Promise<string> {
    const v = await this.rpc<{ sessionId: string }>('session.create', { cwd })
    this.attachSession(v.sessionId)
    return v.sessionId
  }

  /** 复用已有会话（历史恢复 / 侧栏切换），不新建。 */
  attachSession(sessionId: string) {
    this.sessionId = sessionId
    this.connectEvents()
  }

  private connectEvents() {
    if (this.disposed) return
    if (this.ws) {
      this.ws.close()
      this.ws = undefined
    }
    const url = this.base.replace(/^http/, 'ws') + '/api/events.mux'
    const ws = new WebSocket(url)
    this.ws = ws
    this.emitStatus('connecting')
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return
      this.reconnectDelay = RECONNECT_BASE_MS
      this.emitStatus('open')
    })
    ws.addEventListener('message', (ev: any) => {
      if (this.ws !== ws) return
      let msg: any
      try {
        msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
      } catch {
        return
      }
      const rpcId = msg?.rpcId
      const p = msg?.payload
      if (!p) return
      // events.mux 为全局多路复用：只放行当前 session 的帧（无 sessionId 的全局帧照常透传）
      if (p.sessionId && this.sessionId && p.sessionId !== this.sessionId) return
      this.listeners.forEach((l) => l(rpcId, p))
    })
    ws.addEventListener('close', () => {
      if (this.disposed || this.ws !== ws) return
      this.emitStatus('closed')
      this.scheduleReconnect()
    })
    ws.addEventListener('error', () => undefined) // 后续由 close 触发重连
  }

  private scheduleReconnect() {
    if (this.disposed || this.reconnectTimer) return
    const delay = this.reconnectDelay
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connectEvents()
    }, delay)
  }

  async respond(rpcId: string, value: any) {
    const body = { type: 'client-response', rpcId, result: { ok: true, value } }
    const res = await fetch(`${this.base}/api/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  }

  async listModels(): Promise<ModelsView> {
    return this.rpc('session.models', { sessionId: this.sessionId! })
  }

  async selectModel(provider: string, model: string, reasoningEffort?: string) {
    return this.rpc('session.selectModel', { sessionId: this.sessionId!, provider, model, reasoningEffort })
  }

  async sendPrompt(text: string) {
    return this.rpc('session.prompt', {
      sessionId: this.sessionId!,
      mode: 'queue',
      content: [{ type: 'text', text }],
    })
  }

  /** 中断当前运行中的 turn（实测方法名为 session.cancel，返回 {accepted:true} 后网关发 step/end → turn/end）。 */
  async cancelTurn() {
    return this.rpc('session.cancel', { sessionId: this.sessionId! })
  }

  /** 重命名会话（session.rename，成功后广播 session/title 事件）。 */
  async renameSession(sessionId: string, title: string) {
    return this.rpc('session.rename', { sessionId, title })
  }

  async listWorkspaces() {
    return this.rpc<{ items: { workspaceId: string; path: string; title: string; sessionIds: string[] }[] }>(
      'workspace.list',
      {}
    )
  }

  async listSessions() {
    return this.rpc<{
      items: { sessionId: string; updatedAt: number; running: boolean; cwd: string; projections?: any }[]
    }>('session.list', {})
  }

  async getSessionHistory(sessionId: string) {
    return this.rpc<{ events: { event: any }[] }>('session.history', { sessionId })
  }

  async switchSession(sessionId: string) {
    this.attachSession(sessionId)
    return sessionId
  }

  dispose() {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    if (this.ws) {
      this.ws.close()
      this.ws = undefined
    }
    this.listeners = []
    this.statusListeners = []
  }
}
