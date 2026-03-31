# Forge

Forge is a lightweight workflow layer for Claude Code that adds structured planning, validation, retry intelligence, and cross-session memory.

## Quick Start

```
/forge <objective>
```

This triggers the full workflow: understand → plan → execute → validate → retry → learn.

## Skills

- `/forge <objective>` — Full workflow: plan, execute, validate, learn
- `/forge-validate <module-id>` — Validate a specific module
- `/forge-status` — Show current plan status and memory

## Agents

- `planner` — Decomposes objectives into module DAGs
- `worker` — Executes a single module in a worktree
- `reviewer` — Reviews completed modules for correctness
- `debugger` — Root-cause analysis and fix for failed modules

## MCP Tools

The forge MCP server provides:
- `validate` — Run verification commands with stagnation detection
- `memory_recall` — Search project/global memory
- `memory_save` — Save learned patterns
- `iteration_state` — Track retry attempts per module

## Plugin Structure

This project is a Claude Code plugin. Install with `claude plugin add github:TT-Wang/forge`.

```
agents/           — Agent definitions (planner, worker, reviewer, debugger)
skills/           — Skill definitions (/forge, /forge-validate, /forge-status)
forge-mcp-server/ — MCP server (validate, memory, iteration_state)
.claude-plugin/   — Plugin manifest (plugin.json)
.forge/           — Runtime data (plans, memory, iterations)
```
