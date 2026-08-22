import * as vscode from 'vscode'

export function nonce(): string {
  let t = ''
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 32; i++) t += c.charAt(Math.floor(Math.random() * c.length))
  return t
}

/** 渲染面板页（HTML+CSS+script 引用），内容与原 extension.ts 内联版本一致。 */
export function renderPage(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonceVal = nonce()
  const src = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'webview', 'main.js'))
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonceVal}'; img-src data:;">
<style>
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; font-size: 13px; color: var(--vscode-foreground); }
#app { display: flex; height: 100vh; }
#sidebar { width: 232px; min-width: 200px; border-right: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; overflow: hidden; }
#sidebar-header { padding: 10px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; gap: 8px; }
.sb-title-row { display: flex; align-items: center; }
#sidebar-header .title { font-weight: 600; font-size: 12px; flex: 1; opacity: .85; letter-spacing: .3px; }
#new-session { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 5px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
#new-session:hover { background: var(--vscode-button-hoverBackground); }
.sb-search { display: flex; align-items: center; gap: 6px; background: var(--vscode-input-background); border: 1px solid transparent; border-radius: 5px; padding: 4px 8px; }
.sb-search:focus-within { border-color: var(--vscode-focusBorder); }
.sb-search .ic { opacity: .55; font-size: 11px; flex: none; }
.sb-search input { flex: 1; min-width: 0; background: none; border: none; outline: none; color: var(--vscode-input-foreground); font-size: 12px; }
.sb-search input::placeholder { color: var(--vscode-input-placeholderForeground); }
#ws-list { flex: 1; overflow: auto; padding: 6px 0; }
.sess { position: relative; padding: 7px 10px 7px 12px; cursor: pointer; border-left: 2px solid transparent; }
.sess:hover { background: var(--vscode-list-hoverBackground); }
.sess.active { background: var(--vscode-list-activeSelectionBackground); border-left-color: var(--vscode-focusBorder); }
.sess .l1 { display: flex; align-items: center; gap: 6px; }
.sess .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.sess.active .t { color: var(--vscode-list-activeSelectionForeground); }
.sess .l2 { display: flex; gap: 8px; margin-top: 2px; font-size: 11px; opacity: .55; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.sess-rename { opacity: 0; cursor: pointer; font-size: 11px; flex: none; padding: 0 2px; }
.sess:hover .sess-rename { opacity: .55; }
.sess-rename:hover { opacity: 1 !important; }
.sess-rename-input { flex: 1; min-width: 0; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-focusBorder); border-radius: 4px; font-size: 12px; padding: 1px 5px; outline: none; }
.dot.run { background: var(--vscode-testing-iconPassed, #4ec994); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(78,201,148,.45); } 50% { box-shadow: 0 0 0 4px rgba(78,201,148,0); } }
#sb-foot { border-top: 1px solid var(--vscode-panel-border); padding: 6px 10px; }
#sb-foot a { opacity: .6; font-size: 11.5px; cursor: pointer; }
#sb-foot a:hover { opacity: 1; }
#main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
#bar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); }
#status { font-weight: 600; white-space: nowrap; }
.model { flex: 0 1 auto; max-width: 240px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); border-radius: 6px; padding: 3px 6px; font-size: 12px; }
.toolbtn { margin-left: 8px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
.toolbtn:hover { background: var(--vscode-button-secondaryHoverBackground); }
.toolbtn:disabled { opacity: .4; cursor: default; }
#stop { margin-left: auto; }
#stop.stop-run { background: var(--vscode-inputValidation-errorBackground); color: #ffb3b3; border-color: var(--vscode-inputValidation-errorBorder, transparent); opacity: 1; }
#status.warn { color: var(--vscode-errorForeground); }
.gw { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-testing-iconPassed, #4ec994); flex: none; }
.gw.wait { background: var(--vscode-editorWarning, #cca700); }
.gw.off { background: var(--vscode-errorForeground); }
.ctx-chip { display: inline-flex; align-items: center; gap: 5px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 2px 9px; font-size: 11.5px; cursor: default; white-space: nowrap; }
.ctx-chip .bar { width: 34px; height: 4px; border-radius: 2px; background: rgba(128,128,128,.4); overflow: hidden; }
.ctx-chip .bar i { display: block; height: 100%; background: var(--vscode-testing-iconPassed, #4ec994); }
.ctx-chip.warn .bar i { background: var(--vscode-editorWarning, #cca700); }
.ctx-chip.hot .bar i { background: var(--vscode-errorForeground); }
#log { flex: 1; overflow: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
#changes { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px 10px; border-bottom: 1px solid var(--vscode-panel-border); background: var(--vscode-editorWidget-background); }
#changes[hidden] { display: none; }
#changes .lbl { font-size: 11px; opacity: .6; flex: none; }
.chg { display: inline-flex; align-items: center; gap: 5px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 9px; padding: 2px 8px; font-size: 11.5px; cursor: pointer; max-width: 220px; }
.chg:hover { opacity: .85; }
.chg .st { font-size: 10px; opacity: .75; flex: none; }
.chg .p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chg-del { opacity: .55; cursor: default; }
#chg-clear { margin-left: auto; padding: 2px 8px; }
.bubble { border-radius: 10px; padding: 8px 11px; white-space: pre-wrap; max-width: 92%; line-height: 1.45; box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); align-self: flex-end; }
.assistant { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border)); align-self: flex-start; padding: 10px 14px; }
.assistant h2, .assistant h3 { margin: 8px 0 4px; font-size: 13px; font-weight: 600; }
.assistant p { margin: 4px 0; }
.assistant ul { margin: 4px 0; padding-left: 20px; }
.assistant li { margin: 2px 0; }
.assistant code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.assistant pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; overflow-x: auto; margin: 6px 0; }
.assistant pre code { background: none; padding: 0; font-size: 12px; white-space: pre; }
.assistant strong { font-weight: 600; }
.reasoning { border-left: 2px solid var(--vscode-textLink-foreground); padding: 4px 0 4px 8px; margin: 2px 0; align-self: flex-start; max-width: 92%; font-size: 12px; }
.reasoning.collapsed .reasoning-body { display: none; }
.reasoning:not(.collapsed) .reasoning-toggle { margin-bottom: 4px; }
.reasoning-toggle { cursor: pointer; opacity: .6; font-size: 12px; user-select: none; display: flex; align-items: center; gap: 6px; }
.reasoning-toggle:hover { opacity: 1; }
.reasoning-toggle .arrow { display: inline-block; transition: transform .15s; font-size: 10px; }
.reasoning:not(.collapsed) .reasoning-toggle .arrow { transform: rotate(90deg); }
.reasoning-toggle .hint { opacity: .55; font-size: 11px; font-style: normal; }
.reasoning-body { opacity: .75; font-style: italic; white-space: pre-wrap; }
.spin { width: 11px; height: 11px; border: 2px solid var(--vscode-panel-border); border-top-color: var(--vscode-textLink-foreground); border-radius: 50%; display: inline-block; animation: rot .8s linear infinite; flex: none; }
@keyframes rot { to { transform: rotate(360deg); } }
#effort[hidden] { display: none; }
.step { align-self: stretch; border: 1px solid var(--vscode-panel-border); border-left: 3px solid var(--vscode-textLink-foreground); border-radius: 8px; padding: 6px 10px; margin: 2px 0; background: var(--vscode-editorWidget-background); }
.step > .head { font-weight: 600; font-size: 12px; opacity: .9; }
.toolcard .head { cursor: pointer; user-select: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.toolcard .head:hover { opacity: 1; color: var(--vscode-textLink-foreground); }
.toolcard.collapsed .tc-args, .toolcard.collapsed .tc-result { display: none; }
.tc-args, .tc-result { background: var(--vscode-textCodeBlock-background); border-radius: 6px; padding: 6px 8px; margin-top: 5px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11.5px; white-space: pre-wrap; word-break: break-all; max-height: 260px; overflow-y: auto; }
.tc-result { border-left: 2px solid var(--vscode-panel-border); }
.tc-err { border-left-color: var(--vscode-errorForeground); color: var(--vscode-errorForeground); }
.msg { margin: 0; white-space: pre-wrap; opacity: .85; }
.pending { align-self: flex-start; opacity: .7; font-size: 12px; font-style: italic; }
.tool { opacity: .6; font-size: 11px; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 12px; padding: 2px 10px; font-size: 12px; margin: 2px 4px 2px 0; cursor: pointer; }
.chip:hover { opacity: .85; }
.approval { align-self: stretch; border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 10px 12px; margin: 4px 0; background: var(--vscode-editorWidget-background); box-shadow: 0 1px 2px rgba(0,0,0,.18); }
.approval .head { font-weight: 600; margin-bottom: 8px; }
.approval button { margin-right: 8px; border-radius: 6px; padding: 4px 12px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); font-size: 12px; }
.approval .allow { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.approval .always { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border-color: var(--vscode-focusBorder); }
.approval .deny { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
#input { border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-editor-background); padding: 10px 12px 8px; }
.in-row { display: flex; gap: 8px; align-items: flex-end; }
#ta { flex: 1; resize: none; border-radius: 8px; border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground); padding: 8px 10px; font-family: inherit; font-size: 13px; min-height: 38px; max-height: 132px; outline: none; }
#ta:focus { border-color: var(--vscode-focusBorder); }
#send { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 8px; padding: 9px 18px; cursor: pointer; font-size: 13px; height: 38px; }
#send:hover { background: var(--vscode-button-hoverBackground); }
.in-status { display: flex; justify-content: space-between; margin-top: 5px; font-size: 11px; opacity: .55; }
.hero { margin: auto; text-align: center; max-width: 460px; }
.hero .logo { font-size: 30px; font-weight: 700; letter-spacing: 1px; }
.hero .logo b { color: var(--vscode-textLink-foreground); }
.hero .sub { opacity: .7; font-size: 13px; margin: 8px 0 22px; line-height: 1.6; }
.hero-chips { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
.chip-card { width: 138px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-panel-border); border-radius: 9px; padding: 12px 10px; cursor: pointer; text-align: left; transition: border-color .12s, transform .12s; }
.chip-card:hover { border-color: var(--vscode-focusBorder); transform: translateY(-2px); }
.chip-card .ic { font-size: 16px; }
.chip-card .tt { font-size: 12.5px; margin-top: 6px; }
.chip-card .ds { font-size: 11px; opacity: .55; margin-top: 3px; line-height: 1.4; }
.downloading-msg { margin: 40px auto; text-align: center; animation: fadeIn .3s ease-in; }
.downloading-icon { font-size: 48px; margin-bottom: 16px; animation: pulse 2s ease-in-out infinite; }
.downloading-text { font-size: 16px; font-weight: 600; color: var(--vscode-foreground); margin-bottom: 8px; }
.downloading-hint { font-size: 13px; opacity: .7; line-height: 1.5; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }
#split { width: 0; border-left: 1px solid var(--vscode-panel-border); }
#settings-overlay { position: absolute; inset: 0; z-index: 100; background: rgba(0,0,0,.35); display: flex; justify-content: flex-end; }
#settings-overlay[hidden] { display: none; }
#settings-panel { width: 320px; height: 100%; background: var(--vscode-sideBar-background); border-left: 1px solid var(--vscode-panel-border); display: flex; flex-direction: column; overflow: hidden; }
.settings-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; font-size: 13px; }
.settings-body { flex: 1; overflow: auto; padding: 12px; }
.settings-section { margin-bottom: 16px; }
.settings-section h3 { font-size: 12px; font-weight: 600; margin: 0 0 8px; opacity: .85; }
.settings-section label { display: block; font-size: 11.5px; margin-bottom: 4px; opacity: .7; }
.settings-section input[type="text"] { width: 100%; padding: 5px 8px; font-size: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; outline: none; }
.settings-section input[type="text"]:focus { border-color: var(--vscode-focusBorder); }
.settings-hint { font-size: 11px; opacity: .6; margin: 0 0 8px; }
.tool-toggle { display: flex; align-items: center; gap: 8px; padding: 5px 0; font-size: 12px; cursor: pointer; }
.tool-toggle input[type="checkbox"] { margin: 0; }
.settings-footer { padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; justify-content: flex-end; gap: 8px; }
#provider-form { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
#provider-form label { font-size: 11px; opacity: .65; margin-top: 6px; }
#provider-form input[type="text"], #provider-form input[type="password"] { width: 100%; padding: 5px 8px; font-size: 12px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 4px; outline: none; box-sizing: border-box; }
#provider-form input:focus { border-color: var(--vscode-focusBorder); }
#np-add { margin-top: 10px; align-self: flex-start; }
.prov { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin-bottom: 6px; font-size: 11.5px; }
.prov .pid { font-weight: 600; }
.prov .purl { opacity: .55; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.prov .pkey-ok { color: var(--vscode-testing-iconPassed, #4ec994); }
.prov .pkey-miss { color: var(--vscode-editorWarning, #cca700); }
.prov .prm { cursor: pointer; opacity: .5; flex: none; }
.prov .prm:hover { opacity: 1; color: var(--vscode-errorForeground); }
</style>
</head><body><div id="app"><div id="sidebar"><div id="sidebar-header"><div class="sb-title-row"><span class="title">会话</span><button id="new-session">＋ 新建</button></div><div class="sb-search"><span class="ic">🔍</span><input id="sess-filter" placeholder="搜索会话…"></div></div><div id="ws-list"></div><div id="sb-foot"><a id="show-all" hidden></a></div></div><div id="main"><div id="bar">
<span id="gw-dot" class="gw wait" title="正在连接 DSH 网关"></span>
<span id="status">AI 对话</span>
<span id="ctx-chip" class="ctx-chip" hidden><span id="ctx-text"></span><span class="bar"><i id="ctx-bar"></i></span></span>
<select id="model" class="model"></select>
<select id="effort" class="model" hidden></select>
<button id="stop" class="toolbtn" disabled>停止</button>
<button id="edit" class="toolbtn">只读/编辑</button>
<button id="settings" class="toolbtn" title="设置">&#x2699;</button>
</div><div id="settings-overlay" hidden><div id="settings-panel"><div class="settings-header"><span>设置</span><button id="settings-close" class="toolbtn">&times;</button></div><div class="settings-body"><section class="settings-section"><h3>连接</h3><label>网关地址</label><input id="cfg-gateway" type="text" /><label>网关启动命令（可选，留空自动探测）</label><input id="cfg-dshcmd" type="text" placeholder="如 /usr/local/bin/dsh" /></section><section class="settings-section"><h3>权限预设</h3><p class="settings-hint">以下工具将被自动放行，无需逐次确认</p><div id="cfg-tools-list"></div><p id="cfg-tools-empty" class="settings-hint">尚无工具记录。当 AI 请求执行工具时，可点击「始终允许」将其添加。</p></section><section class="settings-section"><h3>模型（自托管 / OpenAI 兼容）</h3><div id="cfg-providers-list"></div><p id="cfg-providers-empty" class="settings-hint">尚无自定义 provider。添加后可在对话顶部选择。</p><form id="provider-form"><label>名称（唯一 ID）</label><input id="np-id" type="text" placeholder="my-vllm" required /><label>Base URL（OpenAI 兼容）</label><input id="np-url" type="text" placeholder="http://127.0.0.1:8000/v1" required /><label>API Key</label><input id="np-key" type="password" placeholder="sk-…" required /><label>模型 ID</label><input id="np-model" type="text" placeholder="Qwen2.5-72B-Instruct" required /><button id="np-add" class="toolbtn" type="submit">＋ 添加 provider</button></form></section></div><div class="settings-footer"><button id="settings-save" class="toolbtn">保存</button></div></div></div><div id="changes" hidden></div><div id="log"></div><div id="input"><div class="in-row"><textarea id="ta" rows="1" placeholder="要做什么？"></textarea><button id="send">发送</button></div><div class="in-status"><span id="in-ctx"></span><span>Enter 发送 · Shift+Enter 换行</span></div></div></div></div>
<script nonce="${nonceVal}" src="${src}"></script></body></html>`
}
