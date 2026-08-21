import * as vscode from 'vscode'
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
    if (name.startsWith('.') && (name === '.git' || name === 'node_modules' || name === '.dsh')) continue
    const child: any = { name, type: type === vscode.FileType.Directory ? 'dir' : 'file', path: `${uri.fsPath}/${name}` }
    if (type === vscode.FileType.Directory) child.children = await readTree(uri.with({ path: child.path }), depth - 1)
    out.push(child)
  }
  return out
}

class DshViewProvider implements vscode.WebviewViewProvider {
  private client?: DshClient
  constructor(private readonly ext: vscode.ExtensionContext) {}

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    const webview = view.webview
    webview.options = { enableScripts: true, localResourceRoots: [this.ext.extensionUri] }
    webview.html = this.html(webview, nonce())
    const base = vscode.workspace.getConfiguration('dshAgent').get<string>('gatewayBase') || 'http://127.0.0.1:3080'
    this.client = new DshClient(base)
    this.client.onFrame((rpcId, frame) => {
      this.post(webview, { kind: 'frame', rpcId, frame })
      if (frame.type === 'approval/requested') this.handleApproval(webview, rpcId, frame)
    })

    webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.kind) {
          case 'ready': {
            const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
            const sessionId = await this.client!.createSession(cwd)
            const models: ModelsView = await this.client!.listModels()
            const tree = vscode.workspace.workspaceFolders
              ? await readTree(vscode.workspace.workspaceFolders[0].uri, 3)
              : []
            let workspaces: any[] = []
            let sessions: any[] = []
            try { workspaces = (await this.client!.listWorkspaces()).items || [] } catch {}
            try { sessions = (await this.client!.listSessions()).items || [] } catch {}
            this.post(webview, { kind: 'init', sessionId, models, tree, workspaces, sessions })
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
          case 'prompt':
            await this.client!.sendPrompt(msg.text)
            break
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
          case 'answer':
            try {
              await this.client!.answerQuestion(msg.questionId, msg.response)
            } catch (e: any) {
              this.post(webview, { kind: 'error', message: '回答失败: ' + String(e?.message ?? e) })
            }
            break
        }
      } catch (e: any) {
        this.post(webview, { kind: 'error', message: String(e?.message ?? e) })
      }
    })
  }

  private approvals = new Map<string, { rpcId: string; sessionId: string }>()
  private readonlyUris = new Set<string>()

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
    this.approvals.set(approvalId, { rpcId, sessionId })
    this.post(webview, { kind: 'approval', approvalId, toolName, reason })
    const pick = await vscode.window.showInformationMessage(
      `DSH 请求执行工具：${toolName}${reason ? ' — ' + reason : ''}`,
      { modal: false },
      '允许一次',
      '拒绝',
    )
    if (pick === '允许一次') await this.answer(webview, approvalId, 'allowed-once')
    else if (pick === '拒绝') await this.answer(webview, approvalId, 'rejected')
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
<style>
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; font-size: 13px; color: var(--vscode-foreground); }
#app { display: flex; height: 100vh; }
#sidebar { width: 220px; min-width: 180px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; overflow: hidden; }
#sidebar-header { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 6px; }
#sidebar-header .title { font-weight: 600; font-size: 12px; flex: 1; }
#new-session { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 11px; }
#new-session:hover { background: var(--vscode-button-hoverBackground); }
#ws-list { flex: 1; overflow: auto; padding: 4px 0; }
.ws-group { margin-bottom: 2px; }
.ws-name { padding: 4px 10px; font-size: 12px; font-weight: 600; opacity: .8; cursor: pointer; display: flex; align-items: center; gap: 4px; }
.ws-name:hover { opacity: 1; }
.ws-name .arrow { font-size: 10px; transition: transform .15s; }
.ws-name.open .arrow { transform: rotate(90deg); }
.ws-sessions { display: none; }
.ws-sessions.open { display: block; }
.sess-item { padding: 4px 10px 4px 24px; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; justify-content: space-between; gap: 6px; }
.sess-item:hover { background: var(--vscode-list-hoverBackground); }
.sess-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.sess-title { overflow: hidden; text-overflow: ellipsis; }
.sess-time { opacity: .5; font-size: 11px; white-space: nowrap; }
#main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
#bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
#status { font-weight: 600; white-space: nowrap; }
.model { flex: 0 1 auto; max-width: 240px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 6px; padding: 3px 6px; font-size: 12px; }
.toolbtn { margin-left: auto; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.toolbtn:hover { background: var(--vscode-button-secondaryHoverBackground); }
#log { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.bubble { border-radius: 10px; padding: 8px 11px; white-space: pre-wrap; max-width: 92%; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
.assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); align-self: flex-start; padding: 10px 14px; }
.assistant h2, .assistant h3 { margin: 8px 0 4px; font-size: 13px; font-weight: 600; }
.assistant p { margin: 4px 0; }
.assistant ul { margin: 4px 0; padding-left: 20px; }
.assistant li { margin: 2px 0; }
.assistant code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.assistant strong { font-weight: 600; }
.reasoning { border-left: 2px solid var(--vscode-textLink-foreground); padding: 4px 0 4px 8px; margin: 2px 0; align-self: flex-start; max-width: 92%; font-size: 12px; }
.reasoning.collapsed .reasoning-body { display: none; }
.reasoning:not(.collapsed) .reasoning-toggle { margin-bottom: 4px; }
.reasoning-toggle { cursor: pointer; opacity: .6; font-size: 12px; user-select: none; }
.reasoning-toggle:hover { opacity: 1; }
.reasoning-body { opacity: .75; font-style: italic; white-space: pre-wrap; }
.step { align-self: stretch; border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 8px; padding: 6px 10px; margin: 2px 0; background: var(--vscode-editorWidget-background); }
.step > .head { font-weight: 600; font-size: 12px; opacity: .9; }
.msg { margin: 0; white-space: pre-wrap; opacity: .85; }
.tool { opacity: .6; font-size: 11px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 12px; padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; cursor: pointer; }
.chip:hover { opacity: .85; }
.approval { align-self: stretch; border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 10px 12px; margin: 4px 0; background: var(--vscode-editorWidget-background); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.approval .head { font-weight: 600; margin-bottom: 8px; }
.approval button { margin-right: 8px; border-radius: 6px; padding: 4px 12px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); font-size: 12px; }
.approval .allow { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.approval .deny { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
#input { display: flex; gap: 8px; padding: 10px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
#ta { flex: 1; resize: none; border-radius: 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px; font-family: inherit; font-size: 13px; }
#ta:focus { outline: 1px solid var(--vscode-focusBorder); }
#send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 8px; padding: 0 16px; cursor: pointer; font-size: 13px; }
#send:hover { background: var(--vscode-button-hoverBackground); }
#split { width: 0; border-left: 1px solid var(--vscode-panel-border); }
</style>
</head><body><div id="app"><div id="sidebar"><div id="sidebar-header"><span class="title">工作区</span><button id="new-session">+ 新会话</button></div><div id="ws-list"></div></div><div id="main"><div id="bar">
<span id="status">AI 对话</span>
<select id="model" class="model"></select>
<button id="edit" class="toolbtn">只读/编辑</button>
</div><div id="log"></div><div id="input"><textarea id="ta" rows="3" placeholder="要做什么？  (Enter 发送 / Shift+Enter 换行)"></textarea></div></div></div>
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

  // AI-first: disable Welcome; show native Explorer on the left and dock the AI
  // panel into the secondary (right) sidebar so the project tree lives in Code's own Explorer.
  vscode.workspace.getConfiguration('workbench').update('startupEditor', 'none', vscode.ConfigurationTarget.Global)
  vscode.commands.executeCommand('workbench.view.explorer').then(() => {
    vscode.commands.executeCommand('dshAgent.view.focus').then(() => {
      setTimeout(() => {
        vscode.commands.executeCommand('workbench.action.moveViewToSecondarySidebar').then(undefined, () => undefined)
      }, 300)
    }, undefined)
  }, undefined)
}

export function deactivate() {}
