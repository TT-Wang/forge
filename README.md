# Forge

Structured planning, parallel execution, and deep validation for Claude Code.

## Install

```bash
claude plugin marketplace add TT-Wang/forge
claude plugin install forge@tt-wang-plugins
```

## What it does

Forge turns a vague objective into structured, validated, parallel work. You say `/forge add JWT auth with refresh tokens` and it plans, executes in parallel worktrees, validates deeply, retries intelligently, and learns for next time.

- **Plans** — breaks tasks into a dependency graph of modules
- **Executes** — parallel workers in isolated git worktrees
- **Validates** — syntax checks, API contract verification, stagnation detection
- **Retries** — debugger agent with root-cause analysis on failures
- **Reviews** — correctness and security checks with contract verification
- **Learns** — saves conventions and failure patterns to memory
- **Resumes** — picks up where you left off after a crash

## Usage

```
/forge add JWT authentication with refresh tokens
/forge-status
/forge-validate m2
```

**Use Forge for** multi-file features, tasks that need validation, ambitious changes. **Skip it for** quick edits or simple questions — just use Claude Code directly.

## How it works

```
/forge "objective"
  ├─ PLAN     — decompose into module DAG, validate structure
  ├─ EXECUTE  — parallel workers in git worktrees
  ├─ VALIDATE — syntax, contracts, velocity analysis
  ├─ RETRY    — debugger agent with root-cause analysis
  ├─ REVIEW   — reviewer agent with contract checks
  └─ LEARN    — save patterns to memory
```

4 agents (planner, worker, reviewer, debugger) + 1 MCP server (7 tools) + 3 slash commands. All markdown and Node.js — no custom runtime.

## MCP Tools

| Tool | What |
|------|------|
| `validate` | Syntax checks, API contracts, stagnation/velocity/oscillation analysis |
| `validate_plan` | DAG cycle detection, file overlap warnings, schema validation |
| `memory_recall` | Search project and global memory |
| `memory_save` | Persist learned patterns with deduplication |
| `iteration_state` | Track retry attempts per module |
| `forge_logs` | Query structured JSONL logs by run, module, phase, severity |
| `session_state` | Save/load session state for resumability |

## See Also

- **[Cortex](https://github.com/TT-Wang/cortex-plugin)** — Persistent cross-session memory for Claude Code
- **[Vibereader](https://github.com/TT-Wang/vibereader)** — Curated tech news while Claude works

## License

MIT
