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

## Directory Structure

```
.forge/
  plans/        — Generated execution plans (JSON)
  memory/       — Project and global memory (JSONL)
  iterations/   — Retry state per module (JSON)
  forge.json    — Project configuration
```
