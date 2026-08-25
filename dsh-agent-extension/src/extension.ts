import * as vscode from 'vscode'
import * as path from 'path'
import { DshClient } from './dshClient'
import { ApprovalManager } from './approvals'
import { ChangeTracker, GitHeadContentProvider } from './changes'
import { GatewayManager } from './gateway'
import { ModelsManager } from './models'
import { PermissionManager } from './permissions'
import type { PostToWebview, WebviewToExt } from './messages'
import { renderPage } from './webviewPage'
import { EditorFiles, readTree } from './workspaceFiles'

const DEFAULT_BASE = 'http://127.0.0.1:3080'
const ONBOARDING_KEY = 'zao.onboardingDone'

function cfg<T>(section: string): T | undefined {
  return vscode.workspace.getConfiguration('dshAgent').get<T>(section)
}

class DshViewProvider implements vscode.WebviewViewProvider {
  private client?: DshClient
  private gateway?: GatewayManager
  private approval?: ApprovalManager
  private modelsMgr?: ModelsManager
  private permMgr?: PermissionManager
  private tracker: ChangeTracker
  private files = new EditorFiles()
  private viewVisible = false

  constructor(private readonly ext: vscode.ExtensionContext) {
    this.tracker = new ChangeTracker({
      post: () => undefined, // webview 就绪前不推送；resolve 时替换
      getRoot: () => vscode.workspace.workspaceFolders?.[0],
    })
  }

  dispose() {
    this.client?.dispose()
    this.tracker.dispose()
  }

  async openFileReadOnly(path: string) {
    await this.files.openReadOnly(path)
  }

  async toggleEdit() {
    await this.files.toggleEdit()
  }

  async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
    const webview = view.webview
    this.viewVisible = view.visible
    this.ext.subscriptions.push(
      view.onDidChangeVisibility(() => {
        this.viewVisible = view.visible
      })
    )
    webview.options = { enableScripts: true, localResourceRoots: [this.ext.extensionUri] }
    webview.html = renderPage(webview, this.ext.extensionUri)
    this.tracker.setPost((msg) => this.post(webview, msg))

    this.gateway = new GatewayManager({
      extensionPath: this.ext.extensionPath,
      getConfig: cfg,
      post: (msg) => this.post(webview, msg),
    })
    const base = cfg<string>('gatewayBase') || DEFAULT_BASE
    this.approval = new ApprovalManager({
      getClient: () => this.client!,
      post: (msg) => this.post(webview, msg),
      persistAutoAllow: async (tools) =>
        void (await vscode.workspace
          .getConfiguration('dshAgent')
          .update('autoAllowTools', tools, vscode.ConfigurationTarget.Global)),
      isViewVisible: () => this.viewVisible,
    })
    this.approval.setAutoAllow(cfg<string[]>('autoAllowTools') || [])
    this.modelsMgr = new ModelsManager(() => this.client!)
    this.permMgr = new PermissionManager(() => this.client!)
    this.client = new DshClient(base)
    this.bindClient(webview)

    this.ext.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('dshAgent.gatewayBase')) {
          const newBase = cfg<string>('gatewayBase') || DEFAULT_BASE
          void this.reconnectClient(webview, newBase)
        }
      })
    )

    webview.onDidReceiveMessage(async (raw) => {
      const msg = raw as WebviewToExt
      try {
        switch (msg.kind) {
          case 'ready':
            await this.handleReady(webview, msg.sessionId)
            break
          case 'openDiff':
            await this.openDiff(msg.path)
            break
          case 'clearChangedFiles': {
            const sid = msg.sessionId ?? this.client?.currentSessionId
            this.tracker.clear(sid)
            this.post(webview, { kind: 'changedFiles', sessionId: sid, files: [] })
            break
          }
          case 'loadWorkspaces': {
            const { workspaces, sessions } = await this.listWorkspacesAndSessions()
            this.post(webview, { kind: 'workspaces', workspaces, sessions })
            break
          }
          case 'loadHistory': {
            const hist = await this.client!.getSessionHistory(msg.sessionId)
            this.post(webview, {
              kind: 'history',
              sessionId: msg.sessionId,
              events: (hist.events || []).map((e: any) => e.event),
            })
            break
          }
          case 'switchSession':
            this.client!.switchSession(msg.sessionId)
            this.post(webview, { kind: 'changedFiles', sessionId: msg.sessionId, files: this.tracker.get(msg.sessionId) })
            break
          case 'renameSession': {
            const title = msg.title.trim()
            if (title) {
              await this.client!.renameSession(msg.sessionId, title)
              // 重命名后刷新侧栏缓存（title 在 projections 里）
              const fresh = await this.listWorkspacesAndSessions()
              this.post(webview, { kind: 'workspaces', ...fresh })
            }
            break
          }
          case 'prompt':
            await this.client!.sendPrompt(msg.text)
            break
          case 'stop':
            await this.client!.cancelTurn()
            break
          case 'newSession': {
            const cwd = this.cwd()
            const sid = await this.client!.createSession(cwd)
            this.post(webview, { kind: 'sessionSwitched', sessionId: sid })
            break
          }
          case 'selectModel':
            await this.client!.selectModel(msg.provider, msg.model, msg.reasoningEffort)
            break
          case 'openFile':
            await this.openFileReadOnly(msg.path)
            break
          case 'toggleEdit':
            await this.toggleEdit()
            break
          case 'respond':
            await this.approval!.resolve(msg.approvalId, msg.outcome)
            break
          case 'respondAlways':
            await this.approval!.resolveAlways(msg.approvalId)
            break
          case 'answer':
            try {
              await this.client!.respond(msg.rpcId, { selected: msg.response })
            } catch (e: any) {
              this.post(webview, { kind: 'error', message: '回答失败: ' + String(e?.message ?? e) })
            }
            break
          case 'listModelProviders': {
            try {
              const providers = await this.modelsMgr!.list()
              this.post(webview, { kind: 'modelProviders', providers })
            } catch (e: any) {
              this.post(webview, { kind: 'error', message: '读取模型配置失败: ' + String(e?.message ?? e) })
            }
            break
          }
          case 'addModelProvider':
            await this.modelsMgr!.add({
              id: msg.id,
              baseURL: msg.baseURL,
              apiKey: msg.apiKey,
              modelId: msg.modelId,
              modelName: msg.modelName,
              contextWindow: msg.contextWindow,
              maxTokens: msg.maxTokens,
            })
            this.post(webview, { kind: 'modelProviderAdded' })
            {
              const providers = await this.modelsMgr!.list()
              this.post(webview, { kind: 'modelProviders', providers })
            }
            break
          case 'removeModelProvider':
            await this.modelsMgr!.remove(msg.id)
            {
              const providers = await this.modelsMgr!.list()
              this.post(webview, { kind: 'modelProviders', providers })
            }
            break
          case 'setPermissionPreset':
            await this.permMgr!.setDefault(msg.preset)
            break
          case 'getOnboarding': {
            const needs = this.ext.globalState.get<boolean>(ONBOARDING_KEY) !== true
            let providers: import('./models').OnboardingProvider[] = []
            if (needs) {
              try {
                providers = await this.modelsMgr!.onboardingProviders()
              } catch {
                /* 网关未就绪时向导仅展示跳过 */
              }
            }
            this.post(webview, { kind: 'onboarding', needs, providers })
            break
          }
          case 'saveProviderKey':
            await this.modelsMgr!.saveKey(msg.providerId, msg.key)
            {
              const providers = await this.modelsMgr!.onboardingProviders()
              this.post(webview, { kind: 'onboarding', needs: true, providers })
            }
            break
          case 'completeOnboarding': {
            await this.ext.globalState.update(ONBOARDING_KEY, true)
            try {
              const models = await this.client!.listModels()
              this.post(webview, { kind: 'modelsView', models })
            } catch {
              /* 模型目录刷新失败不阻塞向导关闭 */
            }
            break
          }
          case 'getSettings': {
            let perm: { current?: string; options: string[] } = { options: [] }
            try {
              perm = await this.permMgr!.describe()
            } catch {
              /* 网关不可达时下拉为空 */
            }
            this.post(webview, {
              kind: 'settings',
              gatewayBase: cfg<string>('gatewayBase') || DEFAULT_BASE,
              dshCommand: cfg<string>('gatewayCommand') || '',
              autoAllowTools: this.approval!.getAutoAllow(),
              knownTools: Array.from(this.approval!.knownTools),
              permissionPreset: perm.current,
              permissionOptions: perm.options,
            })
            break
          }
          case 'saveSettings': {
            const c = vscode.workspace.getConfiguration('dshAgent')
            const newBase = (msg.gatewayBase || DEFAULT_BASE).trim()
            const newTools: string[] = msg.autoAllowTools || []
            await c.update('gatewayBase', newBase, vscode.ConfigurationTarget.Global)
            await c.update('gatewayCommand', (msg.dshCommand || '').trim(), vscode.ConfigurationTarget.Global)
            await c.update('autoAllowTools', newTools, vscode.ConfigurationTarget.Global)
            this.approval!.setAutoAllow(newTools)
            await this.reconnectClient(webview, newBase)
            this.post(webview, { kind: 'settingsSaved' })
            break
          }
        }
      } catch (e: any) {
        this.post(webview, { kind: 'error', message: this.humanizeError(String(e?.message ?? e)) })
      }
    })
  }

  private cwd(): string {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
  }

  /** 优先恢复已有会话，避免 webview 每次重建都新建 session。 */
  private async handleReady(webview: vscode.Webview, savedSessionId?: string) {
    await this.gateway!.ensure(cfg<string>('gatewayBase') || DEFAULT_BASE)
    let sessionId: string | undefined = typeof savedSessionId === 'string' ? savedSessionId : undefined
    let resumable = false
    if (sessionId) {
      try {
        const sessions = (await this.client!.listSessions()).items || []
        resumable = sessions.some((s) => s.sessionId === sessionId)
      } catch {
        /* 网关不可达时回退新建 */
      }
    }
    if (sessionId && resumable) this.client!.attachSession(sessionId)
    else sessionId = await this.client!.createSession(this.cwd())
    const models = await this.client!.listModels()
    const tree = vscode.workspace.workspaceFolders ? await readTree(vscode.workspace.workspaceFolders[0].uri, 3) : []
    const { workspaces, sessions } = await this.listWorkspacesAndSessions()
    this.post(webview, {
      kind: 'init',
      sessionId,
      fresh: !resumable,
      models,
      tree,
      workspaces,
      sessions,
      changed: this.tracker.get(sessionId),
    })
  }

  /** 打开工作区文件与 git HEAD 的原生 diff（右分屏、preview）。 */
  private async openDiff(relPath: string) {
    const root = vscode.workspace.workspaceFolders?.[0]
    if (!root) return
    const abs = path.join(root.uri.fsPath, relPath)
    const head = vscode.Uri.from({
      scheme: GitHeadContentProvider.scheme,
      path: `/${relPath.split(path.sep).map(encodeURIComponent).join('/')}`,
      query: encodeURIComponent(root.uri.fsPath),
    })
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(abs))
    } catch {
      // 文件已被删除：只展示 HEAD 版本内容
      await vscode.commands.executeCommand('vscode.open', head, { viewColumn: vscode.ViewColumn.Beside, preview: true })
      return
    }
    const fileUri = vscode.Uri.file(abs)
    await vscode.commands.executeCommand(
      'vscode.diff',
      head,
      fileUri,
      `${path.basename(relPath)} (Working Tree ↔ HEAD)`,
      { viewColumn: vscode.ViewColumn.Beside, preview: true },
    )
  }

  private async listWorkspacesAndSessions() {
    let workspaces: any[] = []
    let sessions: any[] = []
    try {
      workspaces = (await this.client!.listWorkspaces()).items || []
    } catch {}
    try {
      sessions = (await this.client!.listSessions()).items || []
    } catch {}
    return { workspaces, sessions }
  }

  private bindClient(webview: vscode.Webview) {
    this.client!.onStatus((status) => this.post(webview, { kind: 'gateway', status }))
    this.client!.onFrame((rpcId, frame) => {
      this.tracker.handleFrame(rpcId, frame)
      this.post(webview, { kind: 'frame', rpcId, frame })
      if (frame.type === 'approval/requested') void this.approval!.handle(rpcId, frame)
    })
  }

  private async reconnectClient(webview: vscode.Webview, newBase: string) {
    const sid = this.client?.currentSessionId
    this.client?.dispose()
    this.client = new DshClient(newBase)
    this.bindClient(webview)
    if (sid) this.client.attachSession(sid)
    try {
      const models = await this.client.listModels()
      this.post(webview, { kind: 'init', sessionId: sid, fresh: !sid, models, tree: [], workspaces: [], sessions: [] })
    } catch {
      /* 网关不可达时由 onStatus 处理 */
    }
  }

  private post(webview: vscode.Webview, msg: Parameters<PostToWebview>[0]) {
    void webview.postMessage(msg)
  }

  /** 已知故障的可用性翻译：password-gate 鉴权插件是分发版头号杀手（tasks 3.5）。 */
  private humanizeError(message: string): string {
    if (/unauthenticated/i.test(message)) {
      return (
        'DSH 网关要求登录（检测到 dsh-password-gate 鉴权插件）。' +
        '请从 ~/.dsh/profiles/web/cordis.patch.yml 移除 dsh-password-gate 条目，' +
        '并删除 ~/.dsh/login-plugin 目录后重启网关。'
      )
    }
    return message
  }
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(GitHeadContentProvider.scheme, new GitHeadContentProvider()),
  )
  const provider = new DshViewProvider(context)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('dshAgent.view', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  )
  context.subscriptions.push(
    vscode.commands.registerCommand('dshAgent.openFile', (path: string) => provider.openFileReadOnly(path))
  )
  context.subscriptions.push(vscode.commands.registerCommand('dshAgent.toggleEdit', () => provider.toggleEdit()))
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
