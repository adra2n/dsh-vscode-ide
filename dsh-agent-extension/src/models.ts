import type { DshClient } from './dshClient'

const LLM_NS = 'llm-pi-ai'
/** v1 固定 OpenAI Chat Completions 协议（最通用的自托管端点形态）；后续按需放开。 */
export const WIRE_API = 'openai-completions'

export interface CustomProviderInfo {
  id: string
  baseURL: string
  apiKeyEnv: string
  models: { id: string; name: string }[]
  credentialConfigured?: boolean
}

/** 首启向导用的 provider 条目（内置目录 + 自定义，含 Key 配置状态）。 */
export interface OnboardingProvider {
  id: string
  name: string
  /** credentials ref（环境变量名）；无 Key 语义的 provider 为空 */
  ref?: string
  configured: boolean
  kind: 'builtin' | 'custom'
}

/**
 * 从 settings.describe 的命名空间里提取可配置模型来源（纯函数，便于单测）。
 * - llm-deepseek：官方 DeepSeek，apiKeyEnv 在 ns 顶层
 * - llm-pi-ai：多 provider hub，apiKeyEnv 在 providers.<id> 下；带 baseURL 视为 custom
 */
export function extractOnboardingProviders(
  namespaces: { ns: string; value?: any }[],
): OnboardingProvider[] {
  const out: OnboardingProvider[] = []
  for (const ns of namespaces) {
    if (ns.ns === 'llm-deepseek') {
      const ref = ns.value?.apiKeyEnv
      if (typeof ref === 'string' && ref) {
        out.push({ id: 'deepseek-official', name: 'DeepSeek 官方', ref, configured: false, kind: 'builtin' })
      }
    } else if (ns.ns === 'llm-pi-ai') {
      for (const [id, p] of Object.entries((ns.value?.providers ?? {}) as Record<string, any>)) {
        if (!p || typeof p.apiKeyEnv !== 'string' || !p.apiKeyEnv) continue
        out.push({
          id,
          name: id,
          ref: p.apiKeyEnv,
          configured: false,
          kind: typeof p.baseURL === 'string' ? 'custom' : 'builtin',
        })
      }
    }
  }
  return out
}

export interface ProviderDraft {
  id: string
  baseURL: string
  apiKey: string
  modelId: string
  modelName?: string
  contextWindow?: number
  maxTokens?: number
}

/** draft → llm-pi-ai provider 配置段（纯函数，便于单测）。 */
export function buildProviderPatch(draft: ProviderDraft): Record<string, unknown> {
  return {
    baseURL: draft.baseURL.trim(),
    apiKeyEnv: credentialRef(draft.id),
    api: WIRE_API,
    defaultContextWindow: draft.contextWindow && draft.contextWindow > 0 ? Math.floor(draft.contextWindow) : 131072,
    defaultMaxTokens: draft.maxTokens && draft.maxTokens > 0 ? Math.floor(draft.maxTokens) : 8192,
    defaultInput: ['text'],
    models: [{ id: draft.modelId.trim(), name: draft.modelName?.trim() || draft.modelId.trim() }],
  }
}

/** 凭据 ref 必须匹配 /^[A-Za-z_][A-Za-z0-9_]*$/，由 provider id 派生稳定名称。 */
export function credentialRef(providerId: string): string {
  const suffix =
    providerId
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_')
      .replace(/^([0-9])/, 'P$1') || 'PROVIDER'
  return `ZAO_${suffix}_API_KEY`
}

/**
 * 自定义模型 provider 管理：llm-pi-ai 命名空间 + credentials 层。
 * 写入协议已于真机验证（见 tasks P3.1 备注）。
 */
export class ModelsManager {
  constructor(private readonly getClient: () => DshClient) {}

  async list(): Promise<CustomProviderInfo[]> {
    const client = this.getClient()
    const described = await client.describeSettings()
    const ns = described.namespaces.find((n) => n.ns === LLM_NS)
    const providers = (ns?.value?.providers ?? {}) as Record<string, any>
    // 只展示"我们写入形态"的自定义条目：带 baseURL 的（内置 opencode/xiaomi 等无 baseURL）
    const custom = Object.entries(providers).filter(([, p]) => p && typeof p.baseURL === 'string')
    if (custom.length === 0) return []
    const creds = await client.describeCredentials(custom.map(([, p]) => String(p.apiKeyEnv)))
    return custom.map(([id, p]) => ({
      id,
      baseURL: String(p.baseURL),
      apiKeyEnv: String(p.apiKeyEnv ?? ''),
      models: (p.models ?? []).map((m: any) => ({ id: m.id, name: m.name ?? m.id })),
      credentialConfigured: creds.credentials[String(p.apiKeyEnv)]?.configured ?? false,
    }))
  }

  async add(draft: ProviderDraft) {
    const client = this.getClient()
    const ref = credentialRef(draft.id)
    await client.setCredential(ref, draft.apiKey)
    try {
      await client.mutateSettings(LLM_NS, [
        { op: 'set', path: ['providers', draft.id.trim()], value: buildProviderPatch(draft) },
      ])
    } catch (e) {
      // provider 写入失败时回滚凭据，避免留下孤儿密钥
      await client.unsetCredential(ref).catch(() => undefined)
      throw e
    }
  }

  async remove(id: string) {
    const client = this.getClient()
    const ref = credentialRef(id)
    await client.mutateSettings(LLM_NS, [{ op: 'unset', path: ['providers', id] }])
    await client.unsetCredential(ref)
  }

  /** 首启向导：枚举可配置模型来源并标注 Key 状态。 */
  async onboardingProviders(): Promise<OnboardingProvider[]> {
    const client = this.getClient()
    const described = await client.describeSettings()
    const providers = extractOnboardingProviders(described.namespaces)
    const refs = providers.map((p) => p.ref!).filter(Boolean)
    if (refs.length === 0) return providers
    const creds = await client.describeCredentials(refs)
    for (const p of providers) {
      p.configured = creds.credentials[p.ref!]?.configured ?? false
    }
    return providers
  }

  /** 首启向导：为指定 provider 保存 API Key（写入 credentials 层）。 */
  async saveKey(providerId: string, key: string): Promise<void> {
    const client = this.getClient()
    const described = await client.describeSettings()
    const all = extractOnboardingProviders(described.namespaces)
    const target = all.find((p) => p.id === providerId)
    if (!target?.ref) throw new Error(`未找到模型来源 ${providerId} 的凭据配置`)
    await client.setCredential(target.ref, key)
  }
}
