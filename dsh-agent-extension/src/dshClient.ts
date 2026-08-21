import * as vscode from 'vscode'

export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface ModelGroup { id: string; name: string; models: { id: string; name: string }[] }
export interface ModelsView {
  current: ModelSelection
  routable: boolean
  groups: ModelGroup[]
  failures: { id: string; name: string; message: string }[]
}

export class DshClient {
  private base: string
  private ws?: WebSocket
  private sessionId?: string
  private listeners: ((rpcId: string, payload: any) => void)[] = []

  constructor(base: string) { this.base = base }

  onFrame(cb: (rpcId: string, payload: any) => void) { this.listeners.push(cb) }

  private async rpc<T = any>(method: string, payload: any): Promise<T> {
    const body = { type: 'client-request', rpcId: crypto.randomUUID(), method, payload }
    const res = await fetch(`${this.base}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    const r = json.result ?? json
    if (!r.ok) throw new Error(`${method} -> ${JSON.stringify(r.error ?? r)}`)
    return r.value as T
  }

  async createSession(cwd: string): Promise<string> {
    const v = await this.rpc<{ sessionId: string }>('session.create', { cwd })
    this.sessionId = v.sessionId
    this.connectEvents()
    return v.sessionId
  }

  private connectEvents() {
    const url = this.base.replace(/^http/, 'ws') + '/api/events.mux'
    this.ws = new WebSocket(url)
    this.ws.addEventListener('message', (ev: any) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString())
      const rpcId = msg?.rpcId
      const p = msg?.payload
      if (p) {
        console.log('[dsh-ws]', p.type, JSON.stringify(p).slice(0, 300))
        this.listeners.forEach((l) => l(rpcId, p))
      }
    })
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

  async answerQuestion(questionId: string, response: string) {
    return this.rpc('question.respond', { questionId, response })
  }

  async listWorkspaces() {
    return this.rpc<{ items: { workspaceId: string; path: string; title: string; sessionIds: string[] }[] }>('workspace.list', {})
  }

  async listSessions() {
    return this.rpc<{ items: { sessionId: string; updatedAt: number; running: boolean; cwd: string; projections?: any }[] }>('session.list', {})
  }

  async getSessionHistory(sessionId: string) {
    return this.rpc<{ events: { event: any }[] }>('session.history', { sessionId })
  }

  async switchSession(sessionId: string) {
    this.sessionId = sessionId
    this.connectEvents()
    return sessionId
  }
}
