import { execFile } from 'child_process'
import * as vscode from 'vscode'
import type { ChangedFile, DshFrame, PostToWebview } from './messages'
import * as path from 'path'

const WATCHER_NOISE = /^(\.git|node_modules)\//

function exec(cmd: string, args: string[], cwd: string, timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout.toString())
    })
  })
}

/** 解析 `git status --porcelain` 输出为相对路径集合。 */
export function parseGitStatus(out: string): Set<string> {
  const paths = new Set<string>()
  for (const line of out.split('\n')) {
    if (!line.trim()) continue
    // 格式：XY <path> 或 RY <old> -> <new>
    const raw = line.slice(3)
    const p = raw.includes(' -> ') ? raw.split(' -> ')[1] : raw
    const clean = p.trim().replace(/^"|"$/g, '')
    if (clean) paths.add(clean)
  }
  return paths
}

/**
 * 从工具调用 arguments JSON 中提取文件路径线索（用于 chip 归因提示）。
 * DSH 改文件类工具名未稳定，这里做宽松字段匹配，仅作展示用途。
 */
export function extractPathHint(name: string, argsJson: unknown): string | undefined {
  if (!argsJson || typeof argsJson === 'string') {
    try {
      argsJson = JSON.parse(String(argsJson ?? '{}'))
    } catch {
      return undefined
    }
  }
  const a = argsJson as Record<string, unknown>
  for (const key of ['path', 'file', 'file_path', 'filePath', 'filename', 'file_name']) {
    const v = a[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  void name
  return undefined
}

export class GitHeadContentProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'codon-base'

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const root = decodeURIComponent(uri.query)
      const rel = decodeURIComponent(uri.path).replace(/^\//, '')
      return await exec('git', ['-C', root, 'show', `HEAD:${rel}`], root)
    } catch {
      return '' // 未跟踪 / 无 git：以空文件为基线，diff 显示为全新内容
    }
  }
}

/**
 * 改动文件追踪：turn 期间用 FS watcher 捕获落盘改动（不依赖具体工具名），
 * 以 turn 开始时的 git 脏文件集为基线剔除既有改动；turn 结束时汇总推送 webview。
 */
export class ChangeTracker implements vscode.Disposable {
  private watcher?: vscode.FileSystemWatcher
  private running = false
  private currentSession?: string
  private baseline = new Set<string>()
  private pending = new Map<string, ChangedFile['status']>() // 绝对路径 -> 状态
  private bySession = new Map<string, ChangedFile[]>()
  private disposed = false

  constructor(
    private readonly deps: {
      post: PostToWebview
      getRoot: () => vscode.WorkspaceFolder | undefined
    },
  ) {}

  /** webview 重建时替换推送目标（tracker 生命周期长于单个 webview）。 */
  setPost(post: PostToWebview) {
    this.deps.post = post
  }

  /** 当前会话已记录的改动（供 init 恢复）。 */
  get(sessionId?: string): ChangedFile[] {
    return sessionId ? (this.bySession.get(sessionId) ?? []) : []
  }

  clear(sessionId?: string) {
    if (sessionId) this.bySession.delete(sessionId)
    else this.bySession.clear()
  }

  handleFrame(rpcId: string, frame: DshFrame) {
    void rpcId
    const t = frame.type
    if (t === 'turn/start') this.arm(frame.sessionId)
    else if (t === 'turn/end') void this.finalize(frame.sessionId)
  }

  /** turn 开始：记录基线、启动监听。 */
  private arm(sessionId?: string) {
    this.currentSession = sessionId ?? this.currentSession
    this.running = true
    this.pending.clear()
    this.baseline = new Set()
    const root = this.deps.getRoot()
    if (!root) return
    exec('git', ['-C', root.uri.fsPath, 'status', '--porcelain'], root.uri.fsPath)
      .then((out) => {
        this.baseline = parseGitStatus(out)
      })
      .catch(() => undefined) // 非 git 目录：基线为空
    this.watch(root)
  }

  private watch(root: vscode.WorkspaceFolder) {
    this.watcher?.dispose()
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**'))
    this.watcher = w
    w.onDidCreate((uri) => this.mark(uri, 'created'))
    w.onDidChange((uri) => this.mark(uri, 'modified'))
    w.onDidDelete((uri) => this.mark(uri, 'deleted'))
  }

  private mark(uri: vscode.Uri, status: ChangedFile['status']) {
    if (!this.running || this.disposed) return
    const root = this.deps.getRoot()
    if (!root) return
    const rel = path.relative(root.uri.fsPath, uri.fsPath)
    if (!rel || rel.startsWith('..') || WATCHER_NOISE.test(rel)) return
    this.pending.set(uri.fsPath, status)
  }

  /** turn 结束：停监听、合并会话改动集并推送。 */
  private async finalize(sessionId?: string) {
    this.running = false
    this.watcher?.dispose()
    this.watcher = undefined
    const sid = sessionId ?? this.currentSession
    if (!sid) return
    const root = this.deps.getRoot()

    // 过滤掉 turn 开始前就已脏的文件；目录事件通过可读性检查剔除
    const fresh: ChangedFile[] = []
    for (const [abs, status] of this.pending) {
      const rel = root ? path.relative(root.uri.fsPath, abs) : abs
      if (this.baseline.has(rel)) continue
      if (status !== 'deleted' && root) {
        try {
          const st = await vscode.workspace.fs.stat(vscode.Uri.file(abs))
          if (st.type & vscode.FileType.Directory) continue
        } catch {
          /* 已被再次删除则保留原状态 */
        }
      }
      fresh.push({ path: rel, status })
    }

    if (fresh.length === 0 && !this.bySession.has(sid)) return
    const merged = [...(this.bySession.get(sid) ?? []), ...fresh]
    this.bySession.set(sid, merged)
    this.deps.post({ kind: 'changedFiles', sessionId: sid, files: merged })
    this.pending.clear()
  }

  dispose() {
    this.disposed = true
    this.running = false
    this.watcher?.dispose()
    this.watcher = undefined
  }
}
