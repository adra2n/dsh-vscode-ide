import { spawn, execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { PostToWebview } from './messages'

export interface GatewaySpawnSpec {
  cmd: string
  args: string[]
  env?: Record<string, string>
}

const PROBE_TIMEOUT_MS = 1500
const STARTUP_WAIT_ROUNDS = 120

/**
 * DSH 网关生命周期：探测 → 解析启动命令（设置 > 内置运行时 > npx）→ 拉起并等待就绪。
 * 与 VS Code API 解耦（仅依赖注入的配置读取），便于单测。
 */
export class GatewayManager {
  constructor(
    private readonly opts: {
      extensionPath: string
      getConfig: <T>(section: string) => T | undefined
      post: PostToWebview
    }
  ) {}

  /** 网关是否可达（1.5s 探测超时）。 */
  async alive(base: string): Promise<boolean> {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
      const res = await fetch(`${base}/api/session.list`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'probe', method: 'session.list', payload: {} }),
        signal: ctrl.signal,
      })
      clearTimeout(t)
      return res.ok
    } catch {
      return false
    }
  }

  /** 启动命令解析：gatewayCommand 设置 > 内置 dsh-runtime（Codon 二进制 Node 模式）> npx。 */
  resolveCommand(): GatewaySpawnSpec | undefined {
    const cfg = this.opts.getConfig<string>('gatewayCommand')
    if (cfg && cfg.trim()) {
      const parts = cfg.trim().split(/\s+/)
      return { cmd: parts[0], args: [...parts.slice(1), 'web'] }
    }
    // 内置运行时：app/dsh-runtime 与 extensions/ 平级，用 Codon 自身二进制的 Node 模式拉起。
    // Electron 内嵌 node 需显式 --expose-internals（cordis-plugin-hmr 启动必需，系统 node 默认开启）。
    const bundledBin = path.join(
      this.opts.extensionPath,
      '..',
      'dsh-runtime',
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'lib',
      'bin.js',
    )
    if (fs.existsSync(bundledBin)) {
      return { cmd: process.execPath, args: ['--expose-internals', bundledBin, 'web'], env: { ELECTRON_RUN_AS_NODE: '1' } }
    }
    // npx 方式（首次需联网下载，后续走缓存）
    try {
      const npx = execFileSync('which', ['npx'], { encoding: 'utf8', timeout: 3000 }).trim()
      if (npx) return { cmd: npx, args: ['@deepseek-ai/dsh', 'web'] }
    } catch {
      /* 无 npx */
    }
    return undefined
  }

  /** 是否已有 dsh 网关进程在运行（避免重复启动 npx）。 */
  isProcessRunning(): boolean {
    try {
      const result = execFileSync('pgrep', ['-f', 'dsh.*web'], { encoding: 'utf8', timeout: 3000 }).trim()
      return result.length > 0
    } catch {
      return false
    }
  }

  /** 网关未运行且指向本机时，自动拉起 dsh web 并等待就绪；失败抛错。 */
  async ensure(base: string): Promise<void> {
    if (await this.alive(base)) return
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(base)) return

    if (this.isProcessRunning()) {
      this.opts.post({ kind: 'gateway', status: 'downloading' })
      for (let i = 0; i < STARTUP_WAIT_ROUNDS; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await this.alive(base)) return
      }
      throw new Error('DSH 网关启动超时（120s），可能正在下载依赖')
    }

    const found = this.resolveCommand()
    if (!found) {
      this.opts.post({
        kind: 'error',
        message: '网关未运行且未找到 dsh 命令：请先安装（npm i -g @deepseek-ai/dsh）或在设置中指定 gatewayCommand',
      })
      return
    }

    const logPath = path.join(os.tmpdir(), 'dsh-web-codon.log')
    let out: number | 'ignore' = 'ignore'
    try {
      out = fs.openSync(logPath, 'a')
    } catch {
      /* 日志不可写则忽略 */
    }
    const child = spawn(found.cmd, found.args, {
      detached: true,
      stdio: ['ignore', out, out],
      env: { ...process.env, ...found.env },
    })
    child.unref()
    this.opts.post({ kind: 'gateway', status: 'downloading' })
    for (let i = 0; i < STARTUP_WAIT_ROUNDS; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await this.alive(base)) return
    }
    throw new Error(`DSH 网关自动启动超时（120s），日志：${logPath}`)
  }
}
