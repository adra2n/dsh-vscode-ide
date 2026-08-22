import { describe, expect, it, vi } from 'vitest'
import { buildProviderPatch, credentialRef } from '../models'

vi.mock('vscode', () => ({}))

describe('credentialRef', () => {
  it('derives a stable env-style ref matching DSH regex ^[A-Za-z_][A-Za-z0-9_]*$', () => {
    expect(credentialRef('my-vllm')).toBe('CODON_MY_VLLM_API_KEY')
    expect(credentialRef('My.VLLM')).toBe('CODON_MY_VLLM_API_KEY')
  })

  it('prefixes digit-leading ids to keep the ref valid', () => {
    expect(credentialRef('9local')).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
  })
})

describe('buildProviderPatch', () => {
  const base = {
    id: 'my-vllm',
    baseURL: 'http://127.0.0.1:8000/v1/',
    apiKey: 'sk-secret',
    modelId: 'Qwen2.5-72B',
  }

  it('builds an openai-completions route with apiKeyEnv indirection', () => {
    const patch = buildProviderPatch(base) as any
    // 密钥绝不进 settings，走 credentials 层
    expect(patch.apiKey).toBeUndefined()
    expect(patch.baseURL).toBe('http://127.0.0.1:8000/v1/')
    expect(patch.api).toBe('openai-completions')
    expect(patch.apiKeyEnv).toBe('CODON_MY_VLLM_API_KEY')
    expect(patch.models).toEqual([{ id: 'Qwen2.5-72B', name: 'Qwen2.5-72B' }])
  })

  it('applies sane context/max token defaults and keeps positive overrides', () => {
    expect(buildProviderPatch(base).defaultContextWindow).toBe(131072)
    expect(buildProviderPatch(base).defaultMaxTokens).toBe(8192)
    const custom = buildProviderPatch({ ...base, contextWindow: 4096, maxTokens: 2048 })
    expect(custom.defaultContextWindow).toBe(4096)
    expect(custom.defaultMaxTokens).toBe(2048)
  })

  it('ignores non-positive overrides instead of tripping gateway validation', () => {
    const p = buildProviderPatch({ ...base, contextWindow: -5, maxTokens: 0 })
    expect(p.defaultContextWindow).toBe(131072)
    expect(p.defaultMaxTokens).toBe(8192)
  })
})
