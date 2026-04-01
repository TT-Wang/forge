#!/bin/bash
# Self-locating launcher for forge MCP server
# Resolves paths correctly regardless of spawn cwd
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$(dirname "$SCRIPT_DIR")"

# FORGE_CWD: use caller's cwd (the user's project root), not the plugin dir
export FORGE_CWD="${FORGE_CWD:-$(pwd)}"

exec node "$SCRIPT_DIR/index.mjs"
