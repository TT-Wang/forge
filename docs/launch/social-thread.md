# Twitter/X + Reddit launch thread

## Main tweet (280 char)

Shipped Forge v0.5.0 today — a Claude Code plugin that turns a
one-line objective into a validated dependency graph of parallel
worktree modules, with retry, review, and memory.

Multi-file changes that don't regress.

github.com/TT-Wang/forge

🧵👇

## Thread

**2/**
The problem: Claude Code is great at 1–3 file edits, unreliable past
that. Long objectives turn into whack-a-mole. Each fix regresses
something elsewhere. I wanted it to just... handle it.

**3/**
Forge adds 4 agents + a 7-tool MCP server + 3 slash commands:

• planner → produces a DAG plan
• worker ×N → executes in parallel worktrees
• reviewer → cross-module API contract checks
• debugger → root-cause on failure

**4/**
Key design choices that made the difference:

- Workers run in isolated git worktrees. Parallelism is safe.
- Validator runs against each worker's worktree, not main.
- Stagnation detection: 3 identical failures → escalate.
- Per-run iteration state, so new plans don't inherit old retry counts.

**5/**
I shipped memem v0.11 with it last week:

- 14 modules planned, 14 completed
- 6 running in parallel at peak
- 3 retries total
- 1 cross-module API bug caught by reviewer
- My active time: ~90 seconds

**6/**
Everything is markdown + Node.js. No custom runtime. No cloud. No
telemetry. Stdio-only MCP — no network ports opened. You can read
every agent prompt in half an hour.

**7/**
Install:

```
claude plugin marketplace add TT-Wang/forge
claude plugin install forge@tt-wang-plugins
```

Then `/forge <your objective>` in any Claude Code project.

Repo + architecture docs:
github.com/TT-Wang/forge

Honest feedback welcome.

**8/**
Companion project: memem (github.com/TT-Wang/memem) — persistent
memory across Claude Code sessions. Forge + memem is the pairing:
forge plans + executes, memem remembers. Forge's memory_save patterns
flow into memem's recall index.

## Reddit r/ClaudeAI version

**Title:** Forge — parallel, validated multi-file changes for Claude Code (open source)

**Body:**

Hi r/ClaudeAI,

I built a plugin for Claude Code called [Forge](https://github.com/TT-Wang/forge)
that handles multi-file changes reliably. Sharing it here because the
problem it solves is one I kept hitting and couldn't find a good
existing solution for.

**The problem:** Claude Code is excellent at single-file and small
multi-file edits, but long objectives (4+ files, cross-module changes,
refactors) turn into whack-a-mole. Each fix regresses something
elsewhere and you end up context-switching between files trying to
keep everything coherent.

**What Forge does:**

- **Plans** — a planner agent reads your repo and produces a
  dependency graph of modules
- **Executes in parallel** — worker agents run in isolated git worktrees
  so they physically can't stomp on each other
- **Validates deeply** — verify commands, API contract checks between
  files, syntax validation, stagnation detection
- **Retries intelligently** — on failure, a debugger agent does
  root-cause analysis using structured logs and tries again
- **Reviews** — a reviewer agent checks diffs against the module's
  contract before merge-back, catching cross-module API mismatches
- **Learns** — memory_save persists conventions and failure patterns
  for next run
- **Resumes** — session state is snapshotted so you can pick up after
  a crash

**Install:**

```
claude plugin marketplace add TT-Wang/forge
claude plugin install forge@tt-wang-plugins
```

Then `/forge <your objective>` in any project.

Architecture + docs: https://github.com/TT-Wang/forge

All markdown + Node.js. No cloud, no telemetry, no custom runtime.
Stdio-only MCP server.

If you try it and something breaks, open an issue — I want to know.

**Companion project:** I also maintain
[memem](https://github.com/TT-Wang/memem), a persistent-memory plugin
for Claude Code. Forge + memem works well together: forge plans and
executes, memem remembers what worked across runs.
