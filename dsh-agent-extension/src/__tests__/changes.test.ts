import { describe, expect, it, vi } from 'vitest'
import { extractPathHint, parseGitStatus } from '../changes'

// 仅测纯函数；vscode 模块在测试环境不可用
vi.mock('vscode', () => ({}))

describe('parseGitStatus', () => {
  it('parses porcelain lines into a relative path set', () => {
    const out = [
      ' M src/extension.ts',
      '?? new-file.ts',
      'A  added.txt',
      'R  old-name.ts -> new-name.ts',
      ' D deleted.js',
      '?? "quoted path.txt"',
      '',
    ].join('\n')
    expect(parseGitStatus(out)).toEqual(
      new Set(['src/extension.ts', 'new-file.ts', 'added.txt', 'new-name.ts', 'deleted.js', 'quoted path.txt']),
    )
  })

  it('returns empty set for clean tree', () => {
    expect(parseGitStatus('')).toEqual(new Set())
  })
})

describe('extractPathHint', () => {
  it('reads common path fields from args object', () => {
    expect(extractPathHint('edit', { path: 'a/b.ts' })).toBe('a/b.ts')
    expect(extractPathHint('write', { file_path: '/tmp/x' })).toBe('/tmp/x')
    expect(extractPathHint('save', { filename: 'y.md' })).toBe('y.md')
  })

  it('parses JSON-string arguments (DSH tool/call shape)', () => {
    expect(extractPathHint('edit_file', '{"file":"src/a.ts","old":"x"}')).toBe('src/a.ts')
  })

  it('returns undefined when no path-like field exists', () => {
    expect(extractPathHint('bash', { command: 'ls -la' })).toBeUndefined()
    expect(extractPathHint('glob', 'not json')).toBeUndefined()
  })
})
