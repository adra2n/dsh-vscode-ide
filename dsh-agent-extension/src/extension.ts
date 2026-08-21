import * as vscode from 'vscode'
import { spawn, execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { DshClient, ModelsView } from './dshClient'

function nonce(): string {
  let t = ''
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length))
  return t
}

async function readTree(uri: vscode.Uri, depth: number): Promise<any[]> {
  if (depth <= 0) return []
  let entries: [string, vscode.FileType][]
  try {
    entries = await vscode.workspace.fs.readDirectory(uri)
  } catch {
    return []
  }
  const out: any[] = []
  for (const [name, type] of entries) {
    if (name === '.git' || name === 'node_modules' || name === '.dsh' || name === '.DS_Store') continue
    const child: any = { name, type: type === vscode.FileType.Directory ? 'dir' : 'file', path: `${uri.fsPath}/${name}` }
    if (type === vscode.FileType.Directory) child.children = await readTree(uri.with({ path: child.path }), depth - 1)
    out.push(child)
  }
  return out
}

class DshViewProvider implements vscode.WebviewViewProvider {
  private client?: DshClient
  private viewVisible = false
  constructor(private readonly ext: vscode.ExtensionContext) {}

  dispose() { this.client?.dispose() }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    const webview = view.webview
    this.viewVisible = view.visible
    this.ext.subscriptions.push(view.onDidChangeVisibility(() => { this.viewVisible = view.visible }))
    webview.options = { enableScripts: true, localResourceRoots: [this.ext.extensionUri] }
    webview.html = this.html(webview, nonce())
    const base = vscode.workspace.getConfiguration('dshAgent').get<string>('gatewayBase') || 'http://127.0.0.1:3080'
    this.base = base
    const savedAllow = vscode.workspace.getConfiguration('dshAgent').get<string[]>('autoAllowTools') || []
    this.autoAllow = new Set(savedAllow)
    this.client = new DshClient(base)
    this.bindClient(webview, base)

    this.ext.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('dshAgent.gatewayBase')) {
        const newBase = vscode.workspace.getConfiguration('dshAgent').get<string>('gatewayBase') || 'http://127.0.0.1:3080'
        this.reconnectClient(webview, newBase)
      }
    }))

    webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.kind) {
          case 'ready': {
            await this.ensureGateway(webview)
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
            // 优先恢复已有会话，避免 webview 每次重建都新建 session
            let sessionId: string | undefined = typeof msg.sessionId === 'string' ? msg.sessionId : undefined
            let resumable = false
            if (sessionId) {
              try {
                const sessions = (await this.client!.listSessions()).items || []
                resumable = sessions.some((s) => s.sessionId === sessionId)
              } catch { /* 网关不可达时回退新建 */ }
            }
            if (sessionId && resumable) this.client!.attachSession(sessionId)
            else sessionId = await this.client!.createSession(cwd)
            const models: ModelsView = await this.client!.listModels()
            const tree = vscode.workspace.workspaceFolders
              ? await readTree(vscode.workspace.workspaceFolders[0].uri, 3)
              : []
            let workspaces: any[] = []
            let sessions: any[] = []
            try { workspaces = (await this.client!.listWorkspaces()).items || [] } catch {}
            try { sessions = (await this.client!.listSessions()).items || [] } catch {}
            this.post(webview, { kind: 'init', sessionId, fresh: !resumable, models, tree, workspaces, sessions })
            break
          }
          case 'loadWorkspaces': {
            let workspaces: any[] = []
            let sessions: any[] = []
            try { workspaces = (await this.client!.listWorkspaces()).items || [] } catch {}
            try { sessions = (await this.client!.listSessions()).items || [] } catch {}
            this.post(webview, { kind: 'workspaces', workspaces, sessions })
            break
          }
          case 'loadHistory': {
            const hist = await this.client!.getSessionHistory(msg.sessionId)
            this.post(webview, { kind: 'history', sessionId: msg.sessionId, events: (hist.events || []).map((e: any) => e.event) })
            break
          }
          case 'switchSession': {
            this.client!.switchSession(msg.sessionId)
            break
          }
          case 'prompt': {
            await this.client!.sendPrompt(msg.text)
            break
          }
          case 'stop':
            await this.client!.stopTurn()
            break
          case 'newSession': {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
            const sid = await this.client!.createSession(cwd)
            this.post(webview, { kind: 'sessionSwitched', sessionId: sid })
            break
          }
          case 'selectModel':
            await this.client!.selectModel(msg.provider, msg.model, msg.reasoningEffort)
            break
          case 'openFile': {
            await this.openFileReadOnly(msg.path)
            break
          }
          case 'toggleEdit':
            await this.toggleEdit()
            break
          case 'respond':
            await this.answer(webview, msg.approvalId, msg.outcome)
            break
          case 'respondAlways':
            await this.answerAlways(webview, msg.approvalId)
            break
          case 'answer':
            try {
              await this.client!.respond(msg.rpcId, { selected: msg.response })
            } catch (e: any) {
              this.post(webview, { kind: 'error', message: '回答失败: ' + String(e?.message ?? e) })
            }
            break
          case 'getSettings': {
            const cfg = vscode.workspace.getConfiguration('dshAgent')
            this.post(webview, {
              kind: 'settings',
              gatewayBase: cfg.get<string>('gatewayBase') || 'http://127.0.0.1:3080',
              dshCommand: cfg.get<string>('gatewayCommand') || '',
              autoAllowTools: Array.from(this.autoAllow),
              knownTools: Array.from(this.knownTools),
            })
            break
          }
          case 'saveSettings': {
            const cfg = vscode.workspace.getConfiguration('dshAgent')
            const newBase = (msg.gatewayBase || 'http://127.0.0.1:3080').trim()
            const newTools: string[] = msg.autoAllowTools || []
            await cfg.update('gatewayBase', newBase, vscode.ConfigurationTarget.Global)
            await cfg.update('gatewayCommand', (msg.dshCommand || '').trim(), vscode.ConfigurationTarget.Global)
            await cfg.update('autoAllowTools', newTools, vscode.ConfigurationTarget.Global)
            this.autoAllow = new Set(newTools)
            const curBase = this.client ? newBase : newBase
            if (curBase !== (cfg.get<string>('gatewayBase') || 'http://127.0.0.1:3080') || true) {
              await this.reconnectClient(webview, newBase)
            }
            this.post(webview, { kind: 'settingsSaved' })
            break
          }
        }
      } catch (e: any) {
        this.post(webview, { kind: 'error', message: String(e?.message ?? e) })
      }
    })
  }

  private bindClient(webview: vscode.Webview, _base: string) {
    this.client!.onStatus((status) => this.post(webview, { kind: 'gateway', status }))
    this.client!.onFrame((rpcId, frame) => {
      this.post(webview, { kind: 'frame', rpcId, frame })
      if (frame.type === 'approval/requested') this.handleApproval(webview, rpcId, frame)
    })
  }

  private async reconnectClient(webview: vscode.Webview, newBase: string) {
    this.base = newBase
    const sid = this.client?.currentSessionId
    this.client?.dispose()
    this.client = new DshClient(newBase)
    this.bindClient(webview, newBase)
    if (sid) {
      this.client.attachSession(sid)
    }
    try {
      const models = await this.client.listModels()
      this.post(webview, { kind: 'init', sessionId: sid, fresh: !sid, models, tree: [], workspaces: [], sessions: [] })
    } catch { /* 网关不可达时由 onStatus 处理 */ }
  }

  private base = 'http://127.0.0.1:3080'

  private async gatewayAlive(base: string): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 1500)
      const res = await fetch(`${base}/api/session.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} }),
        signal: ctrl.signal,
      })
      clearTimeout(t)
      return res.ok
    } catch {
      return false
    }
  }

  private resolveDshCommand(): { cmd: string; args: string[]; env?: Record<string, string> } | undefined {
    const cfg = vscode.workspace.getConfiguration('dshAgent').get<string>('gatewayCommand')
    if (cfg && cfg.trim()) {
      const parts = cfg.trim().split(/\s+/)
      return { cmd: parts[0], args: [...parts.slice(1), 'web'] }
    }
    // 内置运行时：app/dsh-runtime 与 extensions/ 平级，用 Codon 自身二进制的 Node 模式拉起
    const bundledBin = path.join(this.ext.extensionPath, '..', 'dsh-runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (fs.existsSync(bundledBin)) {
      return { cmd: process.execPath, args: [bundledBin, 'web'], env: { ELECTRON_RUN_AS_NODE: '1' } }
    }
    // npx 方式（首次需联网下载，后续走缓存）
    try {
      const npm = execFileSync('which', ['npm'], { encoding: 'utf8', timeout: 3000 }).trim()
      if (npm) return { cmd: npm, args: ['exec', '@deepseek-ai/dsh', 'web'] }
    } catch { /* 无 npm */ }
    return undefined
  }

  /** 网关未运行且指向本机时，自动拉起 dsh web 并等待就绪。 */
  private async ensureGateway(webview: vscode.Webview): Promise<void> {
    if (await this.gatewayAlive(this.base)) return
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(this.base)) return
    const found = this.resolveDshCommand()
    if (!found) {
      this.post(webview, { kind: 'error', message: '网关未运行且未找到 dsh 命令：请先安装（npm i -g @deepseek-ai/dsh）或在设置中指定 gatewayCommand' })
      return
    }
    const logPath = path.join(os.tmpdir(), 'dsh-web-codon.log')
    let out: number | 'ignore' = 'ignore'
    try { out = fs.openSync(logPath, 'a') } catch { /* 日志不可写则忽略 */ }
    const child = spawn(found.cmd, found.args, { detached: true, stdio: ['ignore', out, out], env: { ...process.env, ...found.env } })
    child.unref()
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await this.gatewayAlive(this.base)) return
    }
    throw new Error(`DSH 网关自动启动超时（30s），日志：${logPath}`)
  }

  private async persistAutoAllow() {
    await vscode.workspace.getConfiguration('dshAgent').update(
      'autoAllowTools',
      Array.from(this.autoAllow),
      vscode.ConfigurationTarget.Global,
    )
  }

  private approvals = new Map<string, { rpcId: string; sessionId: string; toolName: string }>()
  private readonlyUris = new Set<string>()
  private autoAllow = new Set<string>()
  private knownTools = new Set<string>()

  async openFileReadOnly(path: string) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true })
    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadOnlyInSession')
    this.readonlyUris.add(doc.uri.toString())
  }

  async toggleEdit() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const key = editor.document.uri.toString()
    if (this.readonlyUris.has(key)) {
      await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession')
      this.readonlyUris.delete(key)
    } else {
      await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadOnlyInSession')
      this.readonlyUris.add(key)
    }
  }

  private async handleApproval(webview: vscode.Webview, rpcId: string, frame: any) {
    const { sessionId, approvalId, toolName, reason } = frame
    this.knownTools.add(toolName)
    if (this.autoAllow.has(toolName)) {
      try {
        await this.client!.respond(rpcId, { sessionId, approvalId, outcome: 'allowed-once' })
        this.post(webview, { kind: 'autoApproved', toolName })
      } catch (e: any) {
        this.post(webview, { kind: 'error', message: '自动放行失败: ' + String(e?.message ?? e) })
      }
      return
    }
    this.approvals.set(approvalId, { rpcId, sessionId, toolName })
    this.post(webview, { kind: 'approval', approvalId, toolName, reason })
    // 面板内联卡片为主入口；仅在面板不可见时用通知兜底，避免双重审批
    if (!this.viewVisible) {
      const pick = await vscode.window.showInformationMessage(
        `DSH 请求执行工具：${toolName}${reason ? ' — ' + reason : ''}`,
        { modal: false },
        '允许一次',
        '拒绝',
      )
      if (pick === '允许一次') await this.answer(webview, approvalId, 'allowed-once')
      else if (pick === '拒绝') await this.answer(webview, approvalId, 'rejected')
    }
  }

  private async answerAlways(webview: vscode.Webview, approvalId: string) {
    const a = this.approvals.get(approvalId)
    if (!a) return
    // DSH 侧尚无"始终允许"语义，这里在适配层记住该工具，后续自动放行
    this.autoAllow.add(a.toolName)
    await this.persistAutoAllow()
    await this.answer(webview, approvalId, 'allowed-once')
  }

  private async answer(webview: vscode.Webview, approvalId: string, outcome: string) {
    const a = this.approvals.get(approvalId)
    if (!a) return
    this.approvals.delete(approvalId)
    await this.client!.respond(a.rpcId, { sessionId: a.sessionId, approvalId, outcome })
    this.post(webview, { kind: 'approvalResolved', approvalId, outcome })
  }

  private post(webview: vscode.Webview, msg: any) {
    webview.postMessage(msg)
  }

  private html(webview: vscode.Webview, n: string): string {
    const src = webview.asWebviewUri(vscode.Uri.joinPath(this.ext.extensionUri, 'webview', 'main.js'))
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${n}'; img-src data:;">
<style>
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; font-size: 13px; color: var(--vscode-foreground); }
#app { display: flex; height: 100vh; }
#sidebar { width: 232px; min-width: 200px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; overflow: hidden; }
#sidebar-header { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 8px; }
.sb-title-row { display: flex; align-items: center; }
#sidebar-header .title { font-weight: 600; font-size: 12px; flex: 1; opacity: .85; letter-spacing: .3px; }
#new-session { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 5px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
#new-session:hover { background: var(--vscode-button-hoverBackground); }
.sb-search { display: flex; align-items: center; gap: 6px; background: var(--vscode-input-background); border: 1px solid transparent; border-radius: 5px; padding: 4px 8px; }
.sb-search:focus-within { border-color: var(--vscode-focusBorder); }
.sb-search .ic { opacity: .55; font-size: 11px; flex: none; }
.sb-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: var(--vscode-input-foreground); font-size: 12px; }
.sb-search input::placeholder { color: var(--vscode-input-placeholderForeground); }
#ws-list { flex: 1; overflow: auto; padding: 6px 0; }
.sess { position: relative; padding: 7px 10px 7px 12px; cursor: pointer; border-left: 2px solid transparent; }
.sess:hover { background: var(--vscode-list-hoverBackground); }
.sess.active { background: var(--vscode-list-activeSelectionBackground); border-left-color: var(--vscode-focusBorder); }
.sess .l1 { display: flex; align-items: center; gap: 6px; }
.sess .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.sess.active .t { color: var(--vscode-list-activeSelectionForeground); }
.sess .l2 { display: flex; gap: 8px; margin-top: 2px; font-size: 11px; opacity: .55; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.run { background: var(--vscode-testing-iconPassed, #4ec994); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(78,201,148,.45); } 50% { box-shadow: 0 0 0 4px rgba(78,201,148,0); } }
#sb-foot { border-top: 1px solid var(--vscode-panel-border); padding: 6px 10px; }
#sb-foot a { opacity: .6; font-size: 11.5px; cursor: pointer; }
#sb-foot a:hover { opacity: 1; }
#main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
#bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
#status { font-weight: 600; white-space: nowrap; }
.model { flex: 0 1 auto; max-width: 240px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 6px; padding: 3px 6px; font-size: 12px; }
.toolbtn { margin-left: 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.toolbtn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.toolbtn:disabled { opacity: .4; cursor: default; }
#stop { margin-left: auto; }
#stop.stop-run { background: var(--vscode-inputValidation-errorBackground); color: #ffb3b3; border-color: var(--vscode-inputValidation-errorBorder, transparent); opacity: 1; }
#status.warn { color: var(--vscode-errorForeground); }
.gw { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-testing-iconPassed, #4ec994); flex: none; }
.gw.wait { background: var(--vscode-editorWarning, #cca700); }
.gw.off { background: var(--vscode-errorForeground); }
.ctx-chip { display: inline-flex; align-items: center; gap: 5px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 2px 9px; font-size: 11.5px; cursor: default; white-space: nowrap; }
.ctx-chip .bar { width: 34px; height: 4px; border-radius: 2px; background: rgba(128,128,128,.4); overflow: hidden; }
.ctx-chip .bar i { display: block; height: 100%; background: var(--vscode-testing-iconPassed, #4ec994); }
.ctx-chip.warn .bar i { background: var(--vscode-editorWarning, #cca700); }
.ctx-chip.hot .bar i { background: var(--vscode-errorForeground); }
#log { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.bubble { border-radius: 10px; padding: 8px 11px; white-space: pre-wrap; max-width: 92%; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
.assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); align-self: flex-start; padding: 10px 14px; }
.assistant h2, .assistant h3 { margin: 8px 0 4px; font-size: 13px; font-weight: 600; }
.assistant p { margin: 4px 0; }
.assistant ul { margin: 4px 0; padding-left: 20px; }
.assistant li { margin: 2px 0; }
.assistant code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.assistant pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
.assistant pre code { background: none; padding: 0; font-size: 12px; white-space: pre; }
.assistant strong { font-weight: 600; }
.reasoning { border-left: 2px solid var(--vscode-textLink-foreground); padding: 4px 0 4px 8px; margin: 2px 0; align-self: flex-start; max-width: 92%; font-size: 12px; }
.reasoning.collapsed .reasoning-body { display: none; }
.reasoning:not(.collapsed) .reasoning-toggle { margin-bottom: 4px; }
.reasoning-toggle { cursor: pointer; opacity: .6; font-size: 12px; user-select: none; display: flex; align-items: center; gap: 6px; }
.reasoning-toggle:hover { opacity: 1; }
.reasoning-toggle .arrow { display: inline-block; transition: transform .15s; font-size: 10px; }
.reasoning:not(.collapsed) .reasoning-toggle .arrow { transform: rotate(90deg); }
.reasoning-toggle .hint { opacity: .55; font-size: 11px; font-style: normal; }
.reasoning-body { opacity: .75; font-style: italic; white-space: pre-wrap; }
.spin { width: 11px; height: 11px; border: 2px solid var(--vscode-panel-border); border-top-color: var(--vscode-textLink-foreground); border-radius: 50%; display: inline-block; animation: rot .8s linear infinite; flex: none; }
@keyframes rot { to { transform: rotate(360deg); } }
#effort[hidden] { display: none; }
.step { align-self: stretch; border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 8px; padding: 6px 10px; margin: 2px 0; background: var(--vscode-editorWidget-background); }
.step > .head { font-weight: 600; font-size: 12px; opacity: .9; }
.msg { margin: 0; white-space: pre-wrap; opacity: .85; }
.pending { align-self: flex-start; opacity: .7; font-size: 12px; font-style: italic; }
.tool { opacity: .6; font-size: 11px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 12px; padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; cursor: pointer; }
.chip:hover { opacity: .85; }
.approval { align-self: stretch; border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 10px 12px; margin: 4px 0; background: var(--vscode-editorWidget-background); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.approval .head { font-weight: 600; margin-bottom: 8px; }
.approval button { margin-right: 8px; border-radius: 6px; padding: 4px 12px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); font-size: 12px; }
.approval .allow { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.approval .always { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-color: var(--vscode-focusBorder); }
.approval .deny { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
#input { border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); padding: 10px 12px 8px; }
.in-row { display: flex; gap: 8px; align-items: flex-end; }
#ta { flex: 1; resize: none; border-radius: 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px 10px; font-family: inherit; font-size: 13px; min-height: 38px; max-height: 132px; outline: none; }
#ta:focus { border-color: var(--vscode-focusBorder); }
#send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; font-size: 13px; height: 38px; }
#send:hover { background: var(--vscode-button-hoverBackground); }
.in-status { display: flex; justify-content: space-between; margin-top: 5px; font-size: 11px; opacity: .55; }
.hero { margin: auto; text-align: center; max-width: 460px; }
.hero .logo { font-size: 30px; font-weight: 700; letter-spacing: 1px; }
.hero .logo b { color: var(--vscode-textLink-foreground); }
.hero .sub { opacity: .7; font-size: 13px; margin: 8px 0 22px; line-height: 1.6; }
.hero-chips { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.chip-card { width: 138px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 9px; padding: 12px 10px; cursor: pointer; text-align: left; transition: border-color .12s, transform .12s; }
.chip-card:hover { border-color: var(--vscode-focusBorder); transform: translateY(-2px); }
.chip-card .ic { font-size: 16px; }
.chip-card .tt { font-size: 12.5px; margin-top: 6px; }
.chip-card .ds { font-size: 11px; opacity: .55; margin-top: 3px; line-height: 1.4; }
#split { width: 0; border-left: 1px solid var(--vscode-panel-border); }
#settings-overlay { position: absolute; inset: 0; z-index: 100; background: rgba(0,0,0,.35); display: flex; justify-content: flex-end; }
#settings-overlay[hidden] { display: none; }
#settings-panel { width: 320px; height: 100%; background: var(--vscode-sideBar-background); border-left: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; overflow: hidden; }
.settings-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; font-size: 13px; }
.settings-body { flex: 1; overflow: auto; padding: 12px; }
.settings-section { margin-bottom: 16px; }
.settings-section h3 { font-size: 12px; font-weight: 600; margin: 0 0 8px; opacity: .85; }
.settings-section label { display: block; font-size: 11.5px; margin-bottom: 4px; opacity: .7; }
.settings-section input[type="text"] { width: 100%; padding: 5px 8px; font-size: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; outline: none; }
.settings-section input[type="text"]:focus { border-color: var(--vscode-focusBorder); }
.settings-hint { font-size: 11px; opacity: .6; margin: 0 0 8px; }
.tool-toggle { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; cursor: pointer; }
.tool-toggle input[type="checkbox"] { margin: 0; }
.settings-footer { padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; justify-content: flex-end; gap: 8px; }
</style>
</head><body><div id="app"><div id="sidebar"><div id="sidebar-header"><div class="sb-title-row"><span class="title">会话</span><button id="new-session">＋ 新建</button></div><div class="sb-search"><span class="ic">🔍</span><input id="sess-filter" placeholder="搜索会话…"></div></div><div id="ws-list"></div><div id="sb-foot"><a id="show-all" hidden></a></div></div><div id="main"><div id="bar">
<span id="gw-dot" class="gw wait" title="正在连接 DSH 网关"></span>
<span id="status">AI 对话</span>
<span id="ctx-chip" class="ctx-chip" hidden><span id="ctx-text"></span><span class="bar"><i id="ctx-bar"></i></span></span>
<select id="model" class="model"></select>
<select id="effort" class="model" hidden></select>
<button id="stop" class="toolbtn" disabled>停止</button>
<button id="edit" class="toolbtn">只读/编辑</button>
<button id="settings" class="toolbtn" title="设置">&#x2699;</button>
</div><div id="settings-overlay" hidden><div id="settings-panel"><div class="settings-header"><span>设置</span><button id="settings-close" class="toolbtn">&times;</button></div><div class="settings-body"><section class="settings-section"><h3>连接</h3><label>网关地址</label><input id="cfg-gateway" type="text" /><label>网关启动命令（可选，留空自动探测）</label><input id="cfg-dshcmd" type="text" placeholder="如 /usr/local/bin/dsh" /></section><section class="settings-section"><h3>权限预设</h3><p class="settings-hint">以下工具将被自动放行，无需逐次确认</p><div id="cfg-tools-list"></div><p id="cfg-tools-empty" class="settings-hint">尚无工具记录。当 AI 请求执行工具时，可点击「始终允许」将其添加。</p></section></div><div class="settings-footer"><button id="settings-save" class="toolbtn">保存</button></div></div></div><div id="log"></div><div id="input"><div class="in-row"><textarea id="ta" rows="1" placeholder="要做什么？"></textarea><button id="send">发送</button></div><div class="in-status"><span id="in-ctx"></span><span>Enter 发送 · Shift+Enter 换行</span></div></div></div></div>
<script nonce="${n}" src="${src}"></script></body></html>`
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new DshViewProvider(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dshAgent.view', provider, { webviewOptions: { retainContextWhenHidden: true } }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('dshAgent.openFile', (path: string) => {
      provider.openFileReadOnly(path)
    }),
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('dshAgent.toggleEdit', () => provider.toggleEdit()),
  )
  context.subscriptions.push({ dispose: () => provider.dispose() })

  // AI-first: disable Welcome; show native Explorer on the left and dock the AI
  // panel into the secondary (right) sidebar so the project tree lives in Code's own Explorer.
  // 仅在用户未自行配置时写入，避免覆盖用户偏好（长期方案是 fork 侧启动布局补丁）。
  const wb = vscode.workspace.getConfiguration('workbench')
  if (wb.inspect('startupEditor')?.globalValue === undefined) {
    wb.update('startupEditor', 'none', vscode.ConfigurationTarget.Global)
  }
  vscode.commands.executeCommand('workbench.view.explorer').then(() => {
    vscode.commands.executeCommand('dshAgent.view.focus').then(() => {
      setTimeout(() => {
        vscode.commands.executeCommand('workbench.action.moveViewToSecondarySidebar').then(undefined, () => undefined)
      }, 300)
    }, undefined)
  }, undefined)
}

export function deactivate() {}
