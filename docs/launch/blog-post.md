# How Forge shipped memem v0.11 — a real walkthrough

> This is the launch post for [forge](https://github.com/TT-Wang/forge),
> a Claude Code plugin that turns a one-line objective into parallel,
> validated multi-file changes. It's written as a diary entry of a real
> run, not a marketing deck.

## The setup

memem is a persistent-memory plugin for Claude Code. It was sitting at
v0.10.2 with an open code-review list the size of a grocery receipt: 12
issues across two review passes, all missed by tests and lint. Every
previous attempt to "just knock out the list" turned into a 4-hour
yak-shave because fixes in one file broke assumptions in another.

I wanted to try something different. I fed the whole list to forge:

```
/forge fix the code review items in ~/cortex-plugin —
the list is in review-pass-2.md
```

## What forge did

Forge spawned a **planner** agent. The planner read the list, opened
every file mentioned, and produced a 14-module dependency graph: leaf
modules were the independent fixes, branches were the ones that touched
shared state. It handed me the graph and asked to proceed.

I approved. Forge then ran `validate_plan`: DAG cycle check, file-overlap
warnings between modules that could run in parallel, verify-command
existence checks. The plan came back clean and execution started.

Layer 1 of the DAG spawned **6 worker agents in parallel**, each in its
own git worktree so their edits didn't stomp on each other. Within 90
seconds I had 6 DONE reports. Forge ran `validate` against each
worktree — real verify commands, real API contract checks, real
syntax validation. Four passed. Two had subtle regressions.

For each failure, forge spawned a **debugger agent**. The debugger read
the failing validate output, queried `forge_logs` for context, identified
the root cause, proposed a fix, and handed it back to a retry. Both
fixed on second attempt. Forge then spawned a **reviewer agent** that
read the diffs against the original module contracts and flagged one
API mismatch between two parallel modules — something I would have
shipped and debugged next week. Back to the worker, fixed, re-validated.

## What I did

Read status updates, approved the plan once, and drank coffee.

## The numbers

- **14 modules planned, 14 completed**
- **6 modules ran in parallel at peak**
- **3 retries total across 2 modules**
- **1 review catch** that would have shipped a cross-module API bug
- **Wall clock:** ~22 minutes
- **My active time:** ~90 seconds (plan approval + `git push`)

Compare to the usual: 3–4 hours, constant context-switching, and the
bug forge caught would have surfaced as a weird production error two
weeks later.

## What Forge actually is

Architecturally, forge is a small thing:

- **A MCP server** (Node.js, 7 tools, ~1300 lines): `validate`,
  `validate_plan`, `memory_recall`, `memory_save`, `iteration_state`,
  `forge_logs`, `session_state`. Stdio-only, no network surface.
- **4 agents**: planner, worker, reviewer, debugger. Plain markdown
  prompts — you can read them.
- **1 orchestrator skill**: the `/forge` slash command prompt that
  runs the workflow.
- **`.forge/`** per-project state: plans, per-run iteration state,
  structured JSONL logs, session snapshots for resumability.

Every moving part is markdown or Node.js. There is no custom runtime,
no Docker, no cloud service, no telemetry. You can install it and read
every prompt in an hour.

## The opinionated bits

- **Worktrees by default.** Workers run in isolated git worktrees so
  parallelism is safe. A bad module can't corrupt a good one's changes.
- **Per-run iteration state.** Attempt counts, scores, and stagnation
  detection are scoped per `runId`, so a new plan doesn't inherit stale
  retry counts from an old run that reused a module ID.
- **Validator runs against worktrees.** When a worker reports DONE, the
  orchestrator calls `validate` with `cwd: <worktreePath>` — verification
  sees the worker's changes, not main. (This was a bug in v0.3.x. Fixed
  in v0.4.0. The "six bugs we found by using forge on memem" section
  of the v0.4.0 changelog is worth reading if you like production
  post-mortems.)
- **Stagnation detection.** Three attempts with the same error signature
  triggers an ESCALATE. You never watch forge retry the same broken
  approach 20 times.
- **Memory is boring.** There's no embeddings, no vector DB, no "AI
  remembering" — just `memory_save` writing JSONL and `memory_recall`
  grepping it. What it remembers: test commands that worked, conventions
  found, failure patterns. That's enough.

## Install

```bash
claude plugin marketplace add TT-Wang/forge
claude plugin install forge@tt-wang-plugins
```

Then `/forge <objective>` in any project.

## Works great with memem

I also maintain **[memem](https://github.com/TT-Wang/memem)**, a
persistent-memory plugin for Claude Code. Forge + memem is the
recommended pairing: forge plans and executes, memem remembers what
worked. The patterns forge saves via `memory_save` flow into memem's
recall index, so next week's run starts with last week's lessons
already loaded. Compound interest on engineering judgment.

## Where to go next

- **Repo:** https://github.com/TT-Wang/forge
- **Architecture:** https://github.com/TT-Wang/forge/blob/main/docs/architecture.md
- **MCP tools reference:** https://github.com/TT-Wang/forge/blob/main/docs/mcp-tools.md
- **Security policy:** https://github.com/TT-Wang/forge/blob/main/SECURITY.md

Open an issue if you try it and something breaks. I want to know.
