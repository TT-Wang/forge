# Forge

Forge is a lightweight workflow layer for Claude Code that adds structured planning, deep validation, retry intelligence, session resumability, and cross-session memory.

## Quick Start

```
/forge <objective>
```

This triggers the full workflow: understand → plan → validate plan → execute → validate → retry → learn.

## Skills

- `/forge <objective>` — Full workflow: plan, execute, validate, learn
- `/forge-validate <module-id>` — Validate a specific module
- `/forge-status` — Show current plan status and memory

## Agents

- `planner` — Decomposes objectives into module DAGs, validates plan structure
- `worker` — Executes a single module in a worktree
- `reviewer` — Reviews completed modules for correctness, uses contract checks
- `debugger` — Root-cause analysis with structured log inspection

## MCP Tools

The forge MCP server provides 7 tools:
- `validate` — Run verification commands with syntax checks, API contract verification, stagnation/velocity/oscillation detection
- `validate_plan` — Structural plan validation: DAG cycles, file overlaps, command existence, schema checks
- `memory_recall` — Search project/global memory
- `memory_save` — Save learned patterns
- `iteration_state` — Track retry attempts per module
- `forge_logs` — Query structured JSONL logs (filter by run, module, phase, severity)
- `session_state` — Save/load/list orchestrator state for session resumability

## Plugin Structure

This project is a Claude Code plugin. Install with `claude plugin add github:TT-Wang/forge`.

```
agents/           — Agent definitions (planner, worker, reviewer, debugger)
skills/           — Skill definitions (/forge, /forge-validate, /forge-status)
forge-mcp-server/ — MCP server (7 tools: validate, validate_plan, memory, iteration, logs, session)
.claude-plugin/   — Plugin manifest (plugin.json)
.forge/           — Runtime data (plans, memory, iterations, logs, state)
```
