# Forge Architecture

Forge turns a one-line objective into a validated dependency graph of
modules, each executed in parallel inside an isolated git worktree, verified
with real commands, reviewed for correctness, and merged back into the main
tree. It learns patterns from successes and failures so the next run is
smarter.

## The four moving parts

```
┌────────────────────────────────────────────────────────────────────┐
│  /forge "add JWT auth with refresh tokens"                         │
└──────────────────────────┬─────────────────────────────────────────┘
                           │
                           ▼
              ┌────────────────────────┐
              │   Orchestrator skill   │   skills/forge/SKILL.md
              └─────┬──────────────────┘   top-level prompt that
                    │                      coordinates the workflow
    ┌───────────────┼───────────────┬───────────────┐
    ▼               ▼               ▼               ▼
┌────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│Planner │   │ Worker   │   │ Reviewer │   │ Debugger │
│        │   │ (×N      │   │          │   │          │
│ Explore│   │ parallel)│   │ Security │   │ Root     │
│ repo   │   │ Isolated │   │ + API    │   │ cause    │
│ → DAG  │   │ worktree │   │ contract │   │ analysis │
└────┬───┘   └────┬─────┘   └────┬─────┘   └────┬─────┘
     │            │               │               │
     └────────────┴───────┬───────┴───────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │     MCP Server         │  forge-mcp-server/index.mjs
              │     (stdio, 7 tools)   │  Node.js ESM, zero build step
              └───────────┬────────────┘
                          │
                          ▼
              ┌────────────────────────┐
              │   .forge/ (per-project)│
              │                        │
              │   plans/   iterations/ │
              │   memory/  logs/       │
              │   state/               │
              └────────────────────────┘
```

### 1. Orchestrator skill

`skills/forge/SKILL.md` is the top-level system prompt invoked by the
`/forge <objective>` slash command. It drives the whole workflow:

1. **Understand** — ask the planner agent to explore the repo and
   decompose the objective into a module DAG.
2. **Validate plan** — call `validate_plan` MCP tool (DAG cycles, file
   overlaps, verify-command existence, schema).
3. **Execute** — for each DAG layer, spawn worker agents in parallel
   (one git worktree per module).
4. **Validate module** — the orchestrator calls `validate` with
   `cwd: <worktreePath>` after a worker reports DONE, so verification
   runs against the worker's isolated worktree rather than main.
   Stagnation triggers the debugger. Workers themselves do not call
   `validate` — they self-check via plain Bash and hand off.
5. **Review** — the reviewer agent checks the diff against the module's
   contract.
6. **Retry** — failed modules go to the debugger agent, which does
   root-cause analysis using structured logs.
7. **Learn** — successful patterns and failure modes are saved via
   `memory_save` so future runs start smarter.

### 2. Agents

- **planner** — Reads the repo, produces a module DAG with `files[]`,
  `verify[]` commands, `doneWhen` criteria, and `dependsOn` edges.
- **worker** — Executes one module. Spawned inside its own worktree,
  self-checks via plain Bash, and hands off a DONE report. The
  orchestrator then calls `validate` with `cwd: <worktreePath>` to
  verify the worker's changes before merge-back.
- **reviewer** — Independent correctness + security review of a
  completed module's diff.
- **debugger** — Invoked on stagnation. Reads structured logs via
  `forge_logs`, identifies root cause, proposes a fix.

### 3. MCP server (`forge-mcp-server/index.mjs`)

Stdio-only, 7 tools, no network surface. Reads `FORGE_CWD` env var at
import time to pin the state directory.

See [mcp-tools.md](./mcp-tools.md) for full schemas.

### 4. `.forge/` state directory

Per-project runtime data. Layout:

```
.forge/
├── plans/         — generated plan JSON files (one per run)
├── iterations/    — retry state, scoped per run:
│   └── <runId>/<moduleId>.json
├── memory/        — learned patterns:
│   ├── project.jsonl — scoped to this repo
│   └── global.jsonl  — cross-project
├── logs/          — structured JSONL event stream:
│   └── <runId>.jsonl
└── state/         — session snapshots for resumability:
    └── <runId>.json
```

## Key invariants

- **Validator `cwd` precedence** — `args.cwd > FORGE_CWD env > process.cwd()`.
  A worker must pass its `worktreePath` as `cwd` to see its own changes.
  See CHANGELOG v0.4.0 for the bug this fix addresses.
- **Iteration state is per-run** — `iterations/<runId>/<moduleId>.json`
  so attempt counts don't accumulate across unrelated runs that happen
  to share a module ID.
- **Atomic writes** — state files use `tmp + rename` so a crash mid-write
  leaves the previous version intact.
- **Stdio-only MCP** — no ports, no listeners, no auth surface. All
  interaction is via the local Claude Code process.

## What Forge is NOT

- Not a task runner. It does not schedule, cron, or watch files.
- Not a build system. `verify[]` commands are user-supplied — Forge runs
  them, it does not replace them.
- Not a language-specific tool. Everything is markdown + Node.js.
- Not a cloud service. Everything lives in the local `.forge/` directory.
