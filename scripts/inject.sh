#!/bin/bash
# Inject dsh-agent-extension into Zao.app
# Usage: ./inject.sh [ZAO_APP_PATH]

set -e

ZAO_APP="${1:-/Users/adrain/Desktop/project/vscodium-fork/VSCode-darwin-x64/Zao.app}"
EXT_DIR="$ZAO_APP/Contents/Resources/app/extensions/dsh-agent"
SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/dsh-agent-extension"

echo "Injecting dsh-agent-extension into $ZAO_APP"

# Create extension directory
mkdir -p "$EXT_DIR"

# Copy package.json
cp "$SRC_DIR/package.json" "$EXT_DIR/"

# Copy compiled output
mkdir -p "$EXT_DIR/out"
cp "$SRC_DIR/out"/*.js "$EXT_DIR/out/"

# Copy webview files
mkdir -p "$EXT_DIR/webview"
cp "$SRC_DIR/webview"/*.js "$EXT_DIR/webview/"

echo "✓ Injected successfully"
echo "  - out/*.js"
echo "  - webview/*.js"
echo "  - package.json"
