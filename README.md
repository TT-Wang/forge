# Forge

A [Claude Code](https://claude.com/claude-code) plugin that adds structured planning, parallel execution, deep validation, intelligent retry, session resumability, and cross-session memory to your workflow.

```bash
claude plugin add github:TT-Wang/forge
```

## What It Does

Forge turns a vague objective into structured, validated, parallel work. Instead of you manually breaking down tasks, running tests, retrying failures, and remembering patterns — Forge automates that loop.

**Without Forge:** You tell Claude Code what to do, it does it sequentially, you check if it worked, you retry manually if it didn't.

**With Forge:** You say `/forge add JWT auth with refresh tokens` and it:
1. **Explores** the codebase to understand what exists
2. **Plans** — breaks the task into a dependency graph of modules (e.g., m1: token generation, m2: middleware, m3: refresh endpoint)
3. **Validates the plan** — checks for DAG cycles, file overlaps, missing commands
4. **Executes** workers in parallel in isolated git worktrees — so they can't break each other
5. **Validates deeply** — syntax checks, API contract verification between modules, stagnation/velocity/oscillation analysis
6. **Retries** intelligently — detects stagnation, sends a debugger agent for root-cause analysis
7. **Reviews** modules for correctness and security, using contract checks
8. **Learns** — saves conventions and failure patterns to memory for next time
9. **Resumes** — if a session crashes, pick up where you left off

## What It Is

A Claude Code plugin — ~900 lines across 9 files. No runtime dependencies beyond Claude Code and one small MCP server. Installs in seconds, works in any project.

- **4 agent definitions** (markdown) — planner, worker, reviewer, debugger
- **3 skill definitions** (markdown) — /forge, /forge-validate, /forge-status
- **1 MCP server** (~600 lines Node.js) — 7 tools for validation, memory, iteration tracking, logging, and session management

## Installation

### As a Plugin (recommended)

```bash
# Install directly from GitHub
claude plugin add github:TT-Wang/forge
```

That's it. Claude Code will load the agents, skills, and MCP server automatically.

### Manual Installation

If you prefer to copy files into your project:

```bash
# 1. Clone the repo
git clone https://github.com/TT-Wang/forge.git /tmp/forge

# 2. Copy plugin components to your project's .claude/ directory
mkdir -p .claude/agents .claude/skills
cp /tmp/forge/agents/*.md .claude/agents/
cp -r /tmp/forge/skills/* .claude/skills/
cp -r /tmp/forge/forge-mcp-server/ ./forge-mcp-server/

# 3. Install MCP server dependencies
cd forge-mcp-server && npm install && cd ..

# 4. Add the MCP server to your .claude/settings.json
# (see .claude/settings.json in this repo for the config)

# 5. The .forge/ directory is created automatically on first run
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
  ├─ Phase 0: CHECK — look for incomplete sessions to resume
  ├─ Phase 1: PLAN — decompose into modules, validate plan structure
  ├─ Phase 2: EXECUTE — parallel workers in git worktrees
  ├─ Phase 3: VALIDATE — deep checks (syntax, contracts, velocity)
  ├─ Phase 4: RETRY — debugger agent with root-cause analysis + log inspection
  ├─ Phase 5: REVIEW — reviewer agent with contract verification
  └─ Phase 6: LEARN — save patterns to memory for next time
```

## Architecture

Forge is built entirely on Claude Code's native plugin extension points — no patches, no forks, no custom runtime:

```
┌─────────────────────────────────────────────────────────────────────┐
│  User: /forge "add JWT auth with refresh tokens"                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Forge Skill (Orchestrator)                         │
│                    skills/forge/SKILL.md                              │
│                                                                      │
│  Manages the full lifecycle: plan → execute → validate → retry       │
│  Spawns agents via Claude Code's native Agent tool                   │
└──────┬──────────┬──────────────┬──────────────┬─────────────────────┘
       │          │              │              │
       ▼          ▼              ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐
│ Planner  │ │ Worker   │ │ Reviewer │ │   Debugger   │
│          │ │          │ │          │ │              │
│ Reads    │ │ Edits    │ │ Reviews  │ │ Root-cause   │
│ codebase,│ │ files,   │ │ for      │ │ analysis +   │
│ produces │ │ runs in  │ │ bugs,    │ │ log inspect  │
│ module   │ │ isolated │ │ security │ │ on failed    │
│ DAG plan,│ │ worktree │ │ + API    │ │ modules      │
│ validates│ │          │ │ contracts│ │              │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘
     │            │             │               │
     │       ┌────┴─────────────┴───────────────┘
     │       │  Agents call MCP tools for shared state
     ▼       ▼
┌──────────────────────────────────────────────────────────────────────┐
│                     MCP Server (Node.js)                             │
│                     forge-mcp-server/index.mjs                       │
│                                                                      │
│  ┌───────────┐ ┌──────────────┐ ┌─────────────┐ ┌────────────────┐ │
│  │ validate  │ │validate_plan │ │ memory_*    │ │ iteration_state│ │
│  │           │ │              │ │             │ │                │ │
│  │ Syntax,   │ │ DAG cycles,  │ │ Recall &   │ │ Track retries  │ │
│  │ contracts,│ │ file overlap,│ │ save        │ │ & stagnation   │ │
│  │ velocity, │ │ cmd check,  │ │ patterns    │ │                │ │
│  │ oscillate │ │ schema      │ │             │ │                │ │
│  └───────────┘ └──────────────┘ └─────────────┘ └────────────────┘ │
│  ┌───────────┐ ┌──────────────┐                                    │
│  │forge_logs │ │session_state │                                    │
│  │           │ │              │                                    │
│  │ Structured│ │ Save/load/   │                                    │
│  │ JSONL logs│ │ list session │                                    │
│  │ per run   │ │ for resume   │                                    │
│  └───────┬───┘ └──────┬───────┘                                    │
└──────────┼─────────────┼───────────────────────────────────────────┘
           ▼             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        .forge/ (persistent state)                    │
│                                                                      │
│   plans/*.json       memory/*.jsonl    iterations/m*.json            │
│   (module DAGs)      (learnings)       (retry history)               │
│                                                                      │
│   logs/*.jsonl       state/*.json                                    │
│   (structured logs)  (session state for resumability)                │
└──────────────────────────────────────────────────────────────────────┘
```

Forge uses these Claude Code extension points:

| Extension Point | What Forge Uses It For |
|---|---|
| Custom Agents (.md) | planner, worker, reviewer, debugger agents |
| Skills (.md) | /forge, /forge-validate, /forge-status commands |
| MCP Server | validate, validate_plan, memory, iteration_state, forge_logs, session_state |
| Hooks (agent frontmatter) | PostToolUse syntax checks on Edit/Write |
| `isolation: worktree` | Git isolation per worker agent |
| CLAUDE.md rules | Workflow constraints loaded contextually |

## Project Structure

```
forge/
├── .claude-plugin/
│   └── plugin.json          # Plugin manifest
├── agents/                   # Agent definitions
│   ├── planner.md           # Codebase exploration + module decomposition + plan validation
│   ├── worker.md            # Implementation with post-edit syntax checks
│   ├── reviewer.md          # Code review with API contract verification
│   └── debugger.md          # Root-cause analysis with structured log inspection
├── skills/                   # Skill definitions (slash commands)
│   ├── forge/SKILL.md       # /forge — full orchestrator workflow with session resumability
│   ├── forge-validate/SKILL.md  # /forge-validate — validate a module
│   └── forge-status/SKILL.md    # /forge-status — show plan status
├── forge-mcp-server/         # MCP server (~600 lines)
│   ├── index.mjs            # 7 tools: validate, validate_plan, memory, iteration, logs, session
│   └── package.json
├── statusline/               # Status line integration
│   └── forge-status.sh      # Progress bar with phase display and ETA
├── .forge/                   # Runtime data (auto-created)
│   ├── plans/               # Generated execution plans
│   ├── memory/              # Project and global memory (JSONL)
│   ├── iterations/          # Retry state per module
│   ├── logs/                # Structured JSONL logs per run
│   └── state/               # Session state for resumability
└── .claude/settings.json     # MCP config (for manual installs)
```

## MCP Tools

| Tool | Description |
|---|---|
| `validate` | File checks, AST syntax validation, cross-module API contract verification, command execution. Returns score, stagnation, velocity, and oscillation analysis. |
| `validate_plan` | Structural plan validation: DAG cycle detection (topological sort), file overlap warnings, verify command existence checks, module schema validation. |
| `memory_recall` | Keyword-based search across project and global memory stores. Returns top matches by relevance then confidence. |
| `memory_save` | Persist learned patterns (conventions, failures, test commands, architecture) with deduplication. |
| `iteration_state` | Track retry attempts per module: get/update/reset. Records scores, issues, stagnation flags. |
| `forge_logs` | Query structured JSONL logs. Filter by runId, moduleId, phase, severity. Auto-logs every tool call. |
| `session_state` | Save/load/list orchestrator state for session resumability. Persists progress across crashes. |

## Status Line

Forge writes progress to `/tmp/forge-status.json` on every MCP tool call. A bundled status line script renders it as a colored progress bar:

```
[forge] ████░░░░░░ 2/5 | VALIDATE | refresh endpoint | 3m19s | ~2m30s left
```

### Setup

```bash
# Set as your Claude Code status line
claude statusline set "bash /path/to/forge/statusline/forge-status.sh"

# Or in tmux
set -g status-right '#(bash /path/to/forge/statusline/forge-status.sh)'
```

The script auto-hides when forge isn't running (status file older than 5 minutes). Requires `jq` for best results, falls back to `python3`.

All forge output is also prefixed with `[forge:agent-name]` (e.g. `[forge:planner]`, `[forge:worker]`, `[forge:debugger]`) so you can distinguish forge work from regular Claude Code output.

## Design Principles

1. **Compose, don't rebuild** — Uses Claude Code's tools, permissions, UI, and agent system
2. **Markdown over code** — Agents and skills are markdown files, not TypeScript
3. **Validation is deep** — Syntax checks, API contract verification, velocity tracking
4. **Retry with intelligence** — Stagnation + oscillation detection prevents infinite loops
5. **Memory across sessions** — Patterns learned in one project help the next
6. **Resumable sessions** — Pick up where you left off after a crash

## See Also

- **[Vibereader](https://github.com/TT-Wang/vibereader)** — A companion Claude Code plugin that pushes curated tech news while Claude works. Built with Forge.

## License

MIT
