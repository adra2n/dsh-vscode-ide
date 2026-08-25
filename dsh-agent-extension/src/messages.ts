import type { GatewayStatus, ModelsView } from './dshClient'
import type { CustomProviderInfo, OnboardingProvider } from './models'

export type { CustomProviderInfo, OnboardingProvider }

export interface TreeEntry {
  name: string
  type: 'dir' | 'file'
  path: string
  children?: TreeEntry[]
}

export interface SessionSummary {
  sessionId: string
  updatedAt: number
  running: boolean
  cwd: string
  projections?: unknown
  /** 会话累计改动行数（扩展侧注入，非网关字段） */
  changes?: { add: number; del: number }
}

export interface WorkspaceSummary {
  workspaceId: string
  path: string
  title: string
  sessionIds: string[]
}

/** DSH events.mux 帧负载（schema 随 dev preview 演进，保持宽松）。 */
export interface DshFrame {
  type: string
  sessionId?: string
  approvalId?: string
  toolName?: string
  reason?: string
  [key: string]: unknown
}

/** webview → extension */
export type WebviewToExt =
  | { kind: 'ready'; sessionId?: string }
  | { kind: 'loadWorkspaces' }
  | { kind: 'loadHistory'; sessionId: string }
  | { kind: 'switchSession'; sessionId: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'stop' }
  | { kind: 'newSession' }
  | { kind: 'selectModel'; provider: string; model: string; reasoningEffort?: string }
  | { kind: 'openFile'; path: string }
  | { kind: 'toggleEdit' }
  | { kind: 'respond'; approvalId: string; outcome: string }
  | { kind: 'respondAlways'; approvalId: string }
  | { kind: 'answer'; rpcId: string; response: string; questionId?: string }
  | { kind: 'getSettings' }
  | { kind: 'saveSettings'; gatewayBase: string; dshCommand: string; autoAllowTools: string[] }
  | { kind: 'openDiff'; path: string }
  | { kind: 'clearChangedFiles'; sessionId?: string }
  | { kind: 'renameSession'; sessionId: string; title: string }
  | { kind: 'setPermissionPreset'; preset: string }
  | { kind: 'listModelProviders' }
  | { kind: 'getOnboarding' }
  | { kind: 'saveProviderKey'; providerId: string; key: string }
  | { kind: 'completeOnboarding' }
  | {
      kind: 'addModelProvider'
      id: string
      baseURL: string
      apiKey: string
      modelId: string
      modelName?: string
      contextWindow?: number
      maxTokens?: number
    }
  | { kind: 'removeModelProvider'; id: string }

/** 改动文件条目（path 相对 workspace 根；add/del 为相对 git HEAD 的行数统计，未知省略）。 */
export interface ChangedFile {
  path: string
  status: 'created' | 'modified' | 'deleted'
  add?: number
  del?: number
}

export type GatewayUiStatus = GatewayStatus | 'downloading'

/** extension → webview */
export type ExtToWebview =
  | {
      kind: 'init'
      sessionId?: string
      fresh: boolean
      models: ModelsView
      tree: TreeEntry[]
      workspaces: WorkspaceSummary[]
      sessions: SessionSummary[]
      changed?: ChangedFile[]
    }
  | { kind: 'workspaces'; workspaces: WorkspaceSummary[]; sessions: SessionSummary[] }
  | { kind: 'changedFiles'; sessionId?: string; files: ChangedFile[] }
  | { kind: 'turnChanges'; sessionId?: string; files: ChangedFile[] }
  | { kind: 'history'; sessionId: string; events: unknown[] }
  | { kind: 'sessionSwitched'; sessionId: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'settings'
      gatewayBase: string
      dshCommand: string
      autoAllowTools: string[]
      knownTools: string[]
      permissionPreset?: string
      permissionOptions?: string[]
    }
  | { kind: 'settingsSaved' }
  | { kind: 'gateway'; status: GatewayUiStatus }
  | { kind: 'frame'; rpcId: string; frame: DshFrame }
  | { kind: 'approval'; approvalId: string; toolName: string; reason?: string }
  | { kind: 'approvalResolved'; approvalId: string; outcome: string }
  | { kind: 'autoApproved'; toolName: string }
  | { kind: 'modelProviders'; providers: CustomProviderInfo[] }
  | { kind: 'modelProviderAdded' }
  | { kind: 'onboarding'; needs: boolean; providers: OnboardingProvider[] }
  | { kind: 'modelsView'; models: ModelsView }

export type PostToWebview = (msg: ExtToWebview) => void
