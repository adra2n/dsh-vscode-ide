import * as vscode from 'vscode'
import type { DshClient } from './dshClient'
import type { DshFrame, PostToWebview } from './messages'

interface ApprovalRecord {
  rpcId: string
  sessionId: string
  toolName: string
}

/**
 * 工具审批：内联卡片为主入口，面板不可见时通知兜底。
 * "始终允许"目前为适配层语义（DSH 侧权限预设待接，见 tasks P3.2）。
 */
export class ApprovalManager {
  private approvals = new Map<string, ApprovalRecord>()
  private autoAllow = new Set<string>()
  readonly knownTools = new Set<string>()

  constructor(
    private readonly deps: {
      getClient: () => DshClient
      post: PostToWebview
      persistAutoAllow: (tools: string[]) => Promise<void>
      isViewVisible: () => boolean
    }
  ) {}

  setAutoAllow(tools: string[]) {
    this.autoAllow = new Set(tools)
  }

  getAutoAllow(): string[] {
    return Array.from(this.autoAllow)
  }

  async handle(rpcId: string, frame: DshFrame) {
    const { sessionId, approvalId, toolName, reason } = frame
    if (!approvalId || !toolName) return
    const post = this.deps.post
    this.knownTools.add(toolName)
    if (this.autoAllow.has(toolName)) {
      try {
        await this.deps.getClient().respond(rpcId, { sessionId, approvalId, outcome: 'allowed-once' })
        post({ kind: 'autoApproved', toolName })
      } catch (e: any) {
        post({ kind: 'error', message: '自动放行失败: ' + String(e?.message ?? e) })
      }
      return
    }
    this.approvals.set(approvalId, { rpcId, sessionId: String(sessionId), toolName })
    post({ kind: 'approval', approvalId, toolName, reason })
    // 面板内联卡片为主入口；仅在面板不可见时用通知兜底，避免双重审批
    if (!this.deps.isViewVisible()) {
      const pick = await vscode.window.showInformationMessage(
        `DSH 请求执行工具：${toolName}${reason ? ' — ' + reason : ''}`,
        { modal: false },
        '允许一次',
        '拒绝'
      )
      if (pick === '允许一次') await this.resolve(approvalId, 'allowed-once')
      else if (pick === '拒绝') await this.resolve(approvalId, 'rejected')
    }
  }

  async resolveAlways(approvalId: string) {
    const a = this.approvals.get(approvalId)
    if (!a) return
    // DSH 侧尚无"始终允许"语义，这里在适配层记住该工具，后续自动放行
    this.autoAllow.add(a.toolName)
    await this.deps.persistAutoAllow(this.getAutoAllow())
    await this.resolve(approvalId, 'allowed-once')
  }

  async resolve(approvalId: string, outcome: string) {
    const a = this.approvals.get(approvalId)
    if (!a) return
    this.approvals.delete(approvalId)
    await this.deps.getClient().respond(a.rpcId, { sessionId: a.sessionId, approvalId, outcome })
    this.deps.post({ kind: 'approvalResolved', approvalId, outcome })
  }
}
