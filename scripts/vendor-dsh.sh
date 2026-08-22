#!/bin/bash
# 把固定版本的 DSH 运行时装入 Codon.app，实现零依赖分发（用户无需 node/npm/dsh）。
# 用法: scripts/vendor-dsh.sh /path/to/Codon.app/Contents/Resources/app
#   可选: DSH_VERSION=x.y.z 覆盖版本（默认为已验证的固定版本）

set -euo pipefail

APP_DIR="${1:?用法: vendor-dsh.sh <Codon.app>/Contents/Resources/app}"
DSH_VERSION="${DSH_VERSION:-0.1.1-rc.2}"

RUNTIME_DIR="$APP_DIR/dsh-runtime"

echo "Vendoring @deepseek-ai/dsh@$DSH_VERSION -> $RUNTIME_DIR"
mkdir -p "$RUNTIME_DIR"
npm install --prefix "$RUNTIME_DIR" --no-audit --no-fund --loglevel=error \
  "@deepseek-ai/dsh@$DSH_VERSION"

BIN="$RUNTIME_DIR/node_modules/@deepseek-ai/dsh/lib/bin.js"
[ -f "$BIN" ] || { echo "ERROR: $BIN 不存在，安装异常"; exit 1; }

# --- 分发安全（tasks 3.5 / design 风险项）---
# dsh-password-gate（login-plugin）会使所有 /api 调用返回 unauthenticated，
# 导致面板完全不可用。它只应作为用户侧可选插件存在，绝不能随包启用。
GATE="$RUNTIME_DIR/node_modules/@deepseek-ai/dsh-password-gate"
if [ -e "$GATE" ]; then
  echo "Removing bundled dsh-password-gate (must not ship enabled)"
  rm -rf "$GATE"
fi

echo "✓ Vendored:"
echo "  $BIN"
du -sh "$RUNTIME_DIR" | awk '{print "  size: " $1}'
