import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GatewayManager } from '../gateway'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  execFileSync: vi.fn(),
}))

vi.mock('fs', () => ({ default: { existsSync: mocks.existsSync }, existsSync: mocks.existsSync }))
vi.mock('child_process', () => ({
  default: { execFileSync: mocks.execFileSync },
  execFileSync: mocks.execFileSync,
  spawn: vi.fn(),
}))
vi.mock('vscode', () => ({}))

function manager() {
  return new GatewayManager({
    extensionPath: '/app/extensions/dsh-agent',
    getConfig: () => undefined,
    post: () => undefined,
  })
}

beforeEach(() => {
  mocks.existsSync.mockReset()
  mocks.execFileSync.mockReset()
})

describe('GatewayManager.resolveCommand', () => {
  it('prefers the bundled runtime and launches via Zao binary in node mode with --expose-internals', () => {
    mocks.existsSync.mockReturnValue(true)
    const spec = manager().resolveCommand()!
    expect(spec.cmd).toBe(process.execPath)
    expect(spec.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
    // Electron 内嵌 node 必须显式暴露 internals（cordis-plugin-hmr 依赖）
    expect(spec.args[0]).toBe('--expose-internals')
    expect(spec.args[1]).toContain('dsh-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js')
    expect(spec.args[2]).toBe('web')
  })

  it('falls back to npx when no bundled runtime exists', () => {
    mocks.existsSync.mockReturnValue(false)
    mocks.execFileSync.mockReturnValue('/usr/local/bin/npx\n')
    const spec = manager().resolveCommand()!
    expect(spec).toEqual({ cmd: '/usr/local/bin/npx', args: ['@deepseek-ai/dsh', 'web'] })
  })

  it('returns undefined when nothing is available', () => {
    mocks.existsSync.mockReturnValue(false)
    mocks.execFileSync.mockImplementation(() => {
      throw new Error('no npx')
    })
    expect(manager().resolveCommand()).toBeUndefined()
  })
})
