# Forge

[![CI](https://github.com/TT-Wang/forge/actions/workflows/ci.yml/badge.svg)](https://github.com/TT-Wang/forge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org/)
[![forge MCP server](https://glama.ai/mcp/servers/TT-Wang/forge/badges/score.svg)](https://glama.ai/mcp/servers/TT-Wang/forge)

Turn Claude Code into a structured delivery loop: plan the work, run modules in parallel, validate deeply, retry intelligently, and carry forward what worked.

## Install

```bash
claude plugin marketplace add TT-Wang/forge
claude plugin install forge@tt-wang-plugins
```

## The Pitch

Forge is for the point where plain prompting stops being enough.

If the task touches several files, needs coordination between modules, or needs proof that it actually works, Forge gives Claude Code a workflow instead of just another prompt:

- break the work into modules
- run what can be parallelized
- validate each module hard
- retry failures with debugger context
- remember what worked for the next task

You still use Claude Code. Forge just adds structure around the hard parts.

## What You Get

- **Structured planning**: breaks a feature into modules with dependencies and verification commands
- **Parallel execution**: runs independent modules at the same time in isolated worktrees
- **Deep validation**: checks files, commands, syntax, and cross-module API contracts
- **Intelligent retry**: tracks attempts, detects stagnation, and escalates to a debugger agent
- **Session resumability**: picks up incomplete work instead of starting from scratch
- **Cross-session memory**: remembers conventions, failure patterns, and test commands
- **Status visibility**: exposes progress in Claude output and a terminal status line

## Why Not Just Use Claude Code Directly?

For many tasks, you should.

| Task shape | Plain Claude Code | Forge |
|---|---|---|
| One small edit | Better | Overkill |
| Quick investigation | Better | Overkill |
| Multi-file feature | Manual coordination required | Strong fit |
| Parallelizable work | You manage it yourself | Built in |
| Deep validation | You remember to run it | Part of the workflow |
| Retry after failure | Manual retry and debugging | Tracked, guided, resumable |
| Reusing patterns across sessions | Ad hoc | Built in memory |

Forge is not trying to replace normal usage. It is for the tasks where orchestration matters.

## Quick Start

### Run

```text
/forge build an audit log for admin actions
```

### Check Progress

```text
/forge-status
```

### Re-check One Module

```text
/forge-validate m2
```

## A Typical Session

```text
/forge add JWT auth with refresh tokens

[forge] Phase 1: Planning...
[forge] Proposed Plan: 4 modules, 2 parallel groups
[forge] Proceed with this plan? (yes / modify / abort)

[forge] Phase 2: Executing m1...
[forge] Phase 2: Executing m2, m3 in parallel...
[forge] ✓ m2: DONE — validated, score 1.0
[forge] ✗ m3: FAILED — retrying with debugger
[forge] ✓ m3: DONE — validated after retry

[forge] ## Forge Complete
[forge] 4/4 modules completed
```

That is the experience Forge is aiming for: less manual steering, more visible progress, and fewer silent failures.

## Current Project Structure

```text
forge/
├── .claude-plugin/
│   ├── plugin.json
│   └── marketplace.json
├── .claude/
│   ├── settings.json
│   └── settings.local.json
├── agents/
│   ├── planner.md
│   ├── worker.md
│   ├── reviewer.md
│   └── debugger.md
├── skills/
│   ├── forge/
│   │   └── SKILL.md
│   ├── forge-status/
│   │   └── SKILL.md
│   └── forge-validate/
│       └── SKILL.md
├── forge-mcp-server/
│   ├── index.mjs
│   ├── start.sh
│   ├── package.json
│   └── tests/
├── statusline/
│   └── forge-status.sh
├── docs/
│   ├── architecture.md
│   ├── mcp-tools.md
│   └── launch/
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CLAUDE.md
└── README.md
```

At runtime, Forge also creates a local `.forge/` directory in the working project to store plans, logs, memory, retry history, and resumable state.

## The Main Pieces

### Agents

Forge ships with four focused agents:

- **planner**: explores the codebase and proposes the module plan
- **worker**: implements one module in an isolated worktree
- **reviewer**: checks correctness, security, and contract mismatches
- **debugger**: investigates failed modules and drives retry

### Skills

The user-facing commands are:

- **`/forge`**: full orchestrator workflow
- **`/forge-status`**: current plan, module progress, and learned patterns
- **`/forge-validate`**: re-run validation for one module

### MCP Server

The bundled MCP server provides the shared runtime capabilities Forge needs:

- `validate`
- `validate_plan`
- `memory_recall`
- `memory_save`
- `iteration_state`
- `forge_logs`
- `session_state`

These tools let multiple agents coordinate without relying on loose conversational memory.

### Status Line

Forge can render live progress in your terminal:

```text
[forge] ████░░░░░░ 2/5 | VALIDATE | refresh endpoint | 3m19s | ~2m30s left
```

To use it:

```bash
claude statusline set "bash /path/to/forge/statusline/forge-status.sh"
```

## What Lives In Your Project

Forge keeps its runtime state in a local `.forge/` directory inside the working project. That includes:

- execution plans
- retry history
- learned patterns
- structured logs
- resumable session state

This keeps the workflow inspectable instead of hiding everything behind opaque agent state.

## Documentation

- [Architecture](./docs/architecture.md) — orchestrator, agents, MCP server, and state flow
- [MCP tools reference](./docs/mcp-tools.md) — input/output schemas and examples for all 7 tools
- [Changelog](./CHANGELOG.md) — release notes
- [Contributing](./CONTRIBUTING.md) — dev setup, tests, linting, and PR process
- [Security](./SECURITY.md) — vulnerability reporting and security scope

## Manual Installation

If you do not want to install from the Claude Code marketplace, you can wire Forge manually:

```bash
git clone https://github.com/TT-Wang/forge.git /tmp/forge
mkdir -p .claude/agents .claude/skills
cp /tmp/forge/agents/*.md .claude/agents/
cp -r /tmp/forge/skills/* .claude/skills/
cp -r /tmp/forge/forge-mcp-server ./forge-mcp-server/
cd forge-mcp-server && npm install && cd ..
```

Then wire the MCP server using the reference config in [`.claude/settings.json`](./.claude/settings.json).

## Development

```bash
git clone https://github.com/TT-Wang/forge.git
cd forge/forge-mcp-server
npm install
npm test
```

## Works Great With

- [memem](https://github.com/TT-Wang/memem) — persistent cross-session memory for Claude Code. Forge handles planning and execution; memem helps carry useful patterns across runs.
- [Vibereader](https://github.com/TT-Wang/vibereader) — curated tech news while Claude works

## License

MIT — see [LICENSE](./LICENSE)
