#!/usr/bin/env bash
# Self-locating launcher for the forge MCP server.
#
# On first run we `npm install --omit=dev` into the plugin's own
# node_modules so the server can import @modelcontextprotocol/sdk
# without requiring the user to run anything. Subsequent runs skip
# the install.
#
# Exits with a clear diagnostic if node or npm are missing from PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# FORGE_CWD: preserve caller's cwd (the user's project root), not the
# plugin directory. Workers in worktrees override this via args.cwd.
export FORGE_CWD="${FORGE_CWD:-$(pwd)}"

# Require node.
if ! command -v node >/dev/null 2>&1; then
  echo "[forge] ERROR: 'node' is not on PATH. forge requires Node.js >= 20." >&2
  echo "[forge] Install from https://nodejs.org or via your package manager, then retry." >&2
  exit 127
fi

# First-run bootstrap: ensure dependencies are installed.
if [ ! -d "$SCRIPT_DIR/node_modules/@modelcontextprotocol" ]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "[forge] ERROR: 'npm' is not on PATH and forge dependencies are not installed." >&2
    echo "[forge] Install Node.js (bundles npm) from https://nodejs.org, then retry." >&2
    exit 127
  fi
  echo "[forge] First-run bootstrap — installing dependencies..." >&2
  (
    cd "$SCRIPT_DIR"
    npm install --omit=dev --no-audit --no-fund --silent
  ) || {
    echo "[forge] ERROR: npm install failed. See output above." >&2
    exit 1
  }
  echo "[forge] Bootstrap complete." >&2
fi

exec node "$SCRIPT_DIR/index.mjs"
