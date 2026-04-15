# Minimal Dockerfile for Glama MCP server validation.
#
# Glama (https://glama.ai/mcp/servers) runs this container and talks to
# the forge MCP server over stdio, checking that it starts and responds
# to `tools/list`. It does NOT need a real project workspace, git
# worktrees, or the Claude Code plugin machinery — the server starts
# cleanly with an empty .forge/ in a writable tmp directory.
#
# This is NOT how normal users install forge. End users install via
# `/plugin install forge` which triggers forge-mcp-server/start.sh on
# first spawn (see README for the real install path).

FROM node:22-slim

WORKDIR /app

# Copy package files first so Docker's layer cache can reuse the
# dep-install layer when only source files change.
COPY forge-mcp-server/package.json ./forge-mcp-server/
COPY forge-mcp-server/package-lock.json ./forge-mcp-server/

# Install runtime deps only. We use `npm install` (not `npm ci`) because
# the committed lockfile may lag the scoped @tt-wang/forge-mcp-server
# rename in package.json. npm install regenerates the lock from scratch
# at build time, which is fine for the Glama validation container.
RUN cd forge-mcp-server \
 && npm install --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# Copy the actual source + metadata last.
COPY forge-mcp-server/index.mjs ./forge-mcp-server/
COPY forge-mcp-server/start.sh ./forge-mcp-server/
COPY README.md LICENSE ./

# Sandbox-friendly defaults. Glama's build sandbox is ephemeral so we
# point forge at a writable /tmp workspace and pre-create the .forge/
# subdirectories the server expects at import time.
ENV FORGE_CWD=/tmp/forge-workspace \
    NODE_ENV=production

RUN mkdir -p /tmp/forge-workspace/.forge/plans \
             /tmp/forge-workspace/.forge/memory \
             /tmp/forge-workspace/.forge/iterations \
             /tmp/forge-workspace/.forge/logs \
             /tmp/forge-workspace/.forge/state

# Start the MCP server over stdio — this is the same entrypoint
# start.sh exec's in a real install.
CMD ["node", "forge-mcp-server/index.mjs"]
