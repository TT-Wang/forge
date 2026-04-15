#!/usr/bin/env bash
# One-shot script to publish forge-mcp-server to npm + the MCP Registry.
# Run from the forge repo root. Requires:
#   - node + npm on PATH
#   - an npm account (the script will prompt for login if not logged in)
#   - a GitHub account (mcp-publisher login uses device flow)
#
# Once published, forge will be discoverable via:
#   - https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.TT-Wang/forge
#   - Glama's MCP directory (mirrors the official registry)
#   - Any other MCP Registry aggregator

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."  # forge-mcp-server/

echo "[publish] Working in $(pwd)"

# ─── 1. Ensure deps + package is buildable ─────────────────────────
if [ ! -d node_modules ]; then
  echo "[publish] Installing deps..."
  npm install --no-audit --no-fund
fi

# No build step — index.mjs is the entry. Sanity-check it parses.
node --check index.mjs
echo "[publish] Source OK."

# ─── 2. Publish to npm ─────────────────────────────────────────────
if ! npm whoami >/dev/null 2>&1; then
  echo "[publish] Not logged in to npm. Running 'npm adduser'..."
  npm adduser
fi

echo "[publish] Publishing @tt-wang/forge-mcp-server to npm..."
npm publish --access public

echo "[publish] Verify at: https://www.npmjs.com/package/@tt-wang/forge-mcp-server"

# ─── 3. Install mcp-publisher if missing ───────────────────────────
if ! command -v mcp-publisher >/dev/null 2>&1; then
  echo "[publish] Installing mcp-publisher..."
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
  ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  URL="https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_${OS}_${ARCH}.tar.gz"
  curl -fsSL "$URL" | tar xz mcp-publisher
  sudo mv mcp-publisher /usr/local/bin/ 2>/dev/null || mv mcp-publisher "$HOME/.local/bin/" 2>/dev/null || {
    echo "[publish] Could not install mcp-publisher to a bin directory." >&2
    echo "[publish] The binary is in the current directory. Add to PATH manually." >&2
    exit 1
  }
fi

# ─── 4. Authenticate with GitHub (device flow) ─────────────────────
echo "[publish] Authenticating with GitHub (device flow)..."
echo "[publish] You will be asked to open https://github.com/login/device and paste a code."
mcp-publisher login github

# ─── 5. Publish server metadata to MCP Registry ────────────────────
echo "[publish] Publishing server.json to the MCP Registry..."
mcp-publisher publish

# ─── 6. Verify ─────────────────────────────────────────────────────
echo "[publish] Verifying registration..."
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.TT-Wang/forge" | \
  node -e "
    let data = '';
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => {
      try {
        const json = JSON.parse(data);
        const hit = (json.servers || []).find(s => s.name === 'io.github.TT-Wang/forge');
        if (hit) {
          console.log('[publish] ✓ Registered:', hit.name, '@', hit.version);
        } else {
          console.log('[publish] ⚠ Not found in registry response yet — may take a minute to index.');
        }
      } catch (e) {
        console.log('[publish] ⚠ Could not parse registry response:', e.message);
      }
    });
  "

echo "[publish] Done."
echo "[publish] Glama typically picks up newly-registered servers within hours."
echo "[publish] Check status at: https://glama.ai/mcp/servers?query=forge"
