import type { DshClient } from './dshClient'

const NS = 'permission'

/**
 * 权限预设：与 DSH 官方 web UI 同一写入路径（settings.mutate 写 permission.defaultPreset，
 * 见 dsh-client-ui-permission-presets client.js），作用于之后新建的会话；
 * 运行中会话的生效值来自其事件折叠，经 apiproxy 无独立写入口。
 */
export class PermissionManager {
  constructor(private readonly getClient: () => DshClient) {}

  async describe(): Promise<{ current?: string; options: string[] }> {
    const client = this.getClient()
    let current: string | undefined
    try {
      const described = await client.describeSettings()
      const ns = described.namespaces.find((n) => n.ns === NS)
      current = ns?.value?.defaultPreset
    } catch {
      /* 设置不可读时仍可从会话投影取选项 */
    }
    const options = await this.optionsFromProjection(client)
    return { current, options }
  }

  async setDefault(preset: string) {
    await this.getClient().mutateSettings(NS, [{ op: 'set', path: ['defaultPreset'], value: preset }])
  }

  /** 从最近会话的 permissions 投影读可选项；无会话时回退到内置表。 */
  private async optionsFromProjection(client: DshClient): Promise<string[]> {
    const FALLBACK = ['read-only', 'workspace-write', 'danger-full-access']
    try {
      const sessions = (await client.listSessions()).items || []
      for (const s of sessions) {
        const opts = (s.projections?.values?.permissions as any)?.options
        if (Array.isArray(opts) && opts.length > 0) {
          const names = opts.map((o: any) => (typeof o === 'string' ? o : o.value)).filter(Boolean)
          if (names.length > 0) return names
        }
      }
    } catch {
      /* 网关不可达走 fallback */
    }
    void client
    return FALLBACK
  }
}
