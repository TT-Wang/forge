# Forge

A lightweight workflow framework built on Claude Code. Adds structured planning, parallel execution, automated validation, intelligent retry, and cross-session memory — all through Claude Code's native extension points.

## What It Does

Forge turns a vague objective into structured, validated, parallel work. Instead of you manually breaking down tasks, running tests, retrying failures, and remembering patterns — Forge automates that loop.

**Without Forge:** You tell Claude Code what to do, it does it sequentially, you check if it worked, you retry manually if it didn't.

**With Forge:** You say `/forge add JWT auth with refresh tokens` and it:
1. **Explores** the codebase to understand what exists
2. **Plans** — breaks the task into a dependency graph of modules (e.g., m1: token generation, m2: middleware, m3: refresh endpoint)
3. **Executes** workers in parallel in isolated git worktrees — so they can't break each other
4. **Validates** each module with automated checks (tests, file existence, lint)
5. **Retries** intelligently — detects stagnation, sends a debugger agent for root-cause analysis
6. **Reviews** complex modules for correctness and security
7. **Learns** — saves conventions and failure patterns to memory for next time

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

### When to Use Forge

- **Multi-file features** that touch several parts of the codebase simultaneously
- **Tasks that need validation** — you want proof it works, not just code that looks right
- **Ambitious changes** where manual decomposition and sequencing would be tedious
- **Repeated work across projects** — memory carries forward patterns like "this repo uses vitest not jest"

### When You Don't Need It

For quick single-file edits, simple questions, or exploratory work — just use Claude Code directly. Forge adds structure that's overkill for small tasks.

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
