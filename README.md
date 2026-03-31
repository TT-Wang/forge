# Forge

A lightweight workflow framework built on Claude Code. Adds structured planning, parallel execution, automated validation, intelligent retry, and cross-session memory — all through Claude Code's native extension points.

## What It Is

~565 lines across 9 files. No runtime dependencies beyond Claude Code and one small MCP server.

- **4 agent definitions** (markdown) — planner, worker, reviewer, debugger
- **3 skill definitions** (markdown) — /forge, /forge-validate, /forge-status
- **1 MCP server** (~300 lines Node.js) — validation, memory, iteration tracking
- **1 rules file** (markdown) — workflow constraints

## Installation

```bash
# 1. Install MCP server dependencies
cd forge-mcp-server && npm install && cd ..

# 2. Copy .claude/ directory to your project
cp -r .claude/ /path/to/your/project/.claude/

# 3. Copy forge-mcp-server/ to your project
cp -r forge-mcp-server/ /path/to/your/project/forge-mcp-server/

# 4. The .forge/ directory is created automatically on first run
```

Or symlink for shared use across projects:
```bash
ln -s /root/forge/.claude/agents/planner.md ~/.claude/agents/planner.md
ln -s /root/forge/.claude/agents/worker.md ~/.claude/agents/worker.md
ln -s /root/forge/.claude/agents/reviewer.md ~/.claude/agents/reviewer.md
ln -s /root/forge/.claude/agents/debugger.md ~/.claude/agents/debugger.md
```

## Usage

```
# Full workflow
/forge add JWT authentication with refresh tokens

# Check status
/forge-status

# Re-validate a module
/forge-validate m2
```

## Workflow

```
/forge "objective"
  │
  ├─ Phase 1: UNDERSTAND — explore codebase, load memory
  ├─ Phase 2: PLAN — decompose into modules with DAG
  ├─ Phase 3: EXECUTE — parallel workers in git worktrees
  ├─ Phase 4: VALIDATE — automated checks + stagnation detection
  ├─ Phase 5: RETRY — debugger agent with root-cause analysis (max 3)
  ├─ Phase 6: REVIEW — reviewer agent for complex modules
  └─ Phase 7: LEARN — save patterns to memory for next time
```

## Architecture

Forge uses only Claude Code's native extension points:

| Extension Point | What Forge Uses It For |
|---|---|
| Custom Agents (.md) | planner, worker, reviewer, debugger agents |
| Skills (.md) | /forge, /forge-validate, /forge-status commands |
| MCP Server | validate, memory, iteration_state tools |
| Hooks (agent frontmatter) | PostToolUse syntax checks on Edit/Write |
| `isolation: worktree` | Git isolation per worker agent |
| CLAUDE.md rules | Workflow constraints loaded contextually |

## Design Principles

1. **Compose, don't rebuild** — Uses Claude Code's tools, permissions, UI, and agent system
2. **Markdown over code** — Agents and skills are markdown files, not TypeScript
3. **Validation is mandatory** — Every module must have verify commands
4. **Retry with intelligence** — Stagnation detection prevents infinite loops
5. **Memory across sessions** — Patterns learned in one project help the next

## License

MIT
