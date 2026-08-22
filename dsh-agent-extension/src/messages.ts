import type { GatewayStatus, ModelsView } from './dshClient'

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

/** 改动文件条目（path 相对 workspace 根）。 */
export interface ChangedFile {
  path: string
  status: 'created' | 'modified' | 'deleted'
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
  | { kind: 'history'; sessionId: string; events: unknown[] }
  | { kind: 'sessionSwitched'; sessionId: string }
  | { kind: 'error'; message: string }
  | { kind: 'settings'; gatewayBase: string; dshCommand: string; autoAllowTools: string[]; knownTools: string[] }
  | { kind: 'settingsSaved' }
  | { kind: 'gateway'; status: GatewayUiStatus }
  | { kind: 'frame'; rpcId: string; frame: DshFrame }
  | { kind: 'approval'; approvalId: string; toolName: string; reason?: string }
  | { kind: 'approvalResolved'; approvalId: string; outcome: string }
  | { kind: 'autoApproved'; toolName: string }

export type PostToWebview = (msg: ExtToWebview) => void
