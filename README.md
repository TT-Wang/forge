# Forge

[![CI](https://github.com/TT-Wang/forge/actions/workflows/ci.yml/badge.svg)](https://github.com/TT-Wang/forge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org/)

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
┌─────────────────────────────────────────────────────────────┐
│  /forge "add JWT auth with refresh tokens"                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │    Forge Orchestrator   │
              │    skills/forge/SKILL   │
              └─────┬──────────────────┘
                    │
    ┌───────────────┼───────────────┬───────────────┐
    ▼               ▼               ▼               ▼
┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│Planner │   │ Worker   │   │ Reviewer │   │ Debugger │
│        │   │ (×N      │   │          │   │          │
│ Explore│   │ parallel)│   │ Security │   │ Root     │
│ codebase   │          │   │ + API    │   │ cause    │
│ → DAG  │   │ Isolated │   │ contract │   │ analysis │
│ plan   │   │ worktree │   │ checks   │   │ + logs   │
└────┬───┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
     │            │               │               │
     └────────────┴───────┬───────┴───────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │     MCP Server         │
              │     (Node.js, 7 tools) │
              │                        │
              │  validate              │
              │  validate_plan         │
              │  memory_recall/save    │
              │  iteration_state       │
              │  forge_logs            │
              │  session_state         │
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │   .forge/ (persistent) │
              │                        │
              │   plans/    memory/    │
              │   iterations/  logs/   │
              │   state/               │
              └────────────────────────┘
```

4 agents + 1 MCP server (7 tools) + 3 slash commands. All markdown and Node.js — no custom runtime.

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

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for dev setup, test commands, and
the PR process. See [SECURITY.md](./SECURITY.md) for how to report
vulnerabilities privately.

```bash
git clone https://github.com/TT-Wang/forge.git
cd forge/forge-mcp-server
npm install
npm test
```

## Documentation

- [Architecture](./docs/architecture.md) — orchestrator, agents, MCP server, state
- [MCP tools reference](./docs/mcp-tools.md) — input/output schemas for all 7 tools
- [Changelog](./CHANGELOG.md) — release notes

## See Also

- **[memem](https://github.com/TT-Wang/memem)** — Persistent cross-session memory for Claude Code
- **[Vibereader](https://github.com/TT-Wang/vibereader)** — Curated tech news while Claude works

## License

MIT — see [LICENSE](./LICENSE)
