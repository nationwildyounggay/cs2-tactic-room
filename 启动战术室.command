#!/bin/zsh
# Double-click this file in Finder to run TACTIC on this Mac.
SCRIPT_DIR="${0:A:h}"
NODE_BIN="$(command -v node 2>/dev/null)"
if [[ -z "$NODE_BIN" ]]; then
  NODE_BIN="$HOME/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node"
fi
if [[ ! -x "$NODE_BIN" ]]; then
  print "未找到 Node.js。请先安装 Node.js 20 或更新版本：https://nodejs.org/"
  read "?按回车退出…"
  exit 1
fi
NODE_MAJOR="$($NODE_BIN -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  print "需要 Node.js 20 或更新版本。当前版本：$($NODE_BIN --version)"
  read "?按回车退出…"
  exit 1
fi
print ""
print "  TACTIC — CS2 战术指挥室"
print "  保持这个终端窗口打开；按 Ctrl+C 停止服务。"
print "  队友请使用下方局域网地址，不要分享 localhost。"
print ""
exec "$NODE_BIN" "$SCRIPT_DIR/server.mjs"
