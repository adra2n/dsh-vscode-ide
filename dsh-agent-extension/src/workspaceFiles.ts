import * as vscode from 'vscode'
import type { TreeEntry } from './messages'

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', '.dsh', '.DS_Store'])

export async function readTree(uri: vscode.Uri, depth: number): Promise<TreeEntry[]> {
  if (depth <= 0) return []
  let entries: [string, vscode.FileType][]
  try {
    entries = await vscode.workspace.fs.readDirectory(uri)
  } catch {
    return []
  }
  const out: TreeEntry[] = []
  for (const [name, type] of entries) {
    if (EXCLUDED_DIRS.has(name)) continue
    const child: TreeEntry = {
      name,
      type: type === vscode.FileType.Directory ? 'dir' : 'file',
      path: `${uri.fsPath}/${name}`,
    }
    if (type === vscode.FileType.Directory) child.children = await readTree(uri.with({ path: child.path }), depth - 1)
    out.push(child)
  }
  return out
}

/** 右分屏只读打开 + 只读状态跟踪（供"只读/编辑"切换）。 */
export class EditorFiles {
  private readonlyUris = new Set<string>()

  async openReadOnly(path: string) {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
    await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: true })
    await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadOnlyInSession')
    this.readonlyUris.add(doc.uri.toString())
  }

  async toggleEdit() {
    const editor = vscode.window.activeTextEditor
    if (!editor) return
    const key = editor.document.uri.toString()
    if (this.readonlyUris.has(key)) {
      await vscode.commands.executeCommand('workbench.action.files.setActiveEditorWriteableInSession')
      this.readonlyUris.delete(key)
    } else {
      await vscode.commands.executeCommand('workbench.action.files.setActiveEditorReadOnlyInSession')
      this.readonlyUris.add(key)
    }
  }
}
