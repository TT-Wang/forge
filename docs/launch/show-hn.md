# Show HN post — forge

## Title (70 char limit)

Show HN: Forge – parallel, validated multi-file changes for Claude Code

## Alt titles

- Show HN: Forge – a planner+validator+debugger wrapper around Claude Code
- Show HN: Forge – DAG-scheduled git worktrees for AI multi-file edits
- Show HN: Forge – I made Claude Code actually good at multi-file refactors

## Body

Hi HN,

I've been using Claude Code for a few months and kept running into the
same wall: it's great at single-file edits, okay at 2–3 file edits, and
unreliable past that. Long objectives turn into whack-a-mole where each
fix regresses something elsewhere.

Forge is what I ended up building to fix that. It's a Claude Code plugin
that turns a one-line objective into a dependency graph of modules,
executes them in parallel inside isolated git worktrees, validates each
one against real verify commands and API contract checks, retries with a
debugger agent on failure, and reviews diffs for cross-module mismatches
before merge-back.

Architecturally it's four small parts:

- A **planner** agent that reads the repo and produces a DAG plan
- **Worker** agents that each execute one module in their own worktree
- A **reviewer** agent that checks diffs against module contracts
- A **debugger** agent that does root-cause analysis on failures

Plus a 1300-line Node.js MCP server (`validate`, `validate_plan`,
`memory_save/recall`, `iteration_state`, `forge_logs`, `session_state`),
3 slash commands (`/forge`, `/forge-status`, `/forge-validate`), and a
`.forge/` state directory for plans, logs, and session snapshots.

Everything is markdown + Node.js — no custom runtime, no cloud, no
telemetry, no vendor lock-in. You can read every agent prompt in half
an hour.

A few design decisions that worked better than I expected:

1. **Worktrees by default.** Parallelism is safe because workers
   physically can't stomp on each other's files. A broken module can't
   corrupt the good ones.
2. **Validator runs against the worker's worktree, not main.** Sounds
   obvious in retrospect but the v0.3 bug where validation silently
   tested main while the worker edited a worktree was painful.
3. **Stagnation detection.** Three attempts with the same error
   signature triggers an escalate. No more watching AI retry the same
   broken approach 20 times.
4. **Per-run iteration state.** Attempt counts are scoped per run, so a
   new plan doesn't inherit stale retry counts from an old run that
   happened to reuse a module ID.

I shipped memem v0.11 with it last week — 14 modules, 6 parallel at
peak, 3 retries, 1 cross-module API bug caught by the reviewer that I
would have shipped otherwise. My active time was about 90 seconds.

Install:

```
claude plugin marketplace add TT-Wang/forge
claude plugin install forge@tt-wang-plugins
```

Then `/forge <objective>` in any Claude Code project.

Repo + architecture docs:
https://github.com/TT-Wang/forge

Honest feedback welcome — especially edge cases where the orchestration
falls apart, bad assumptions in the debugger, or places the validator is
too generous.

## Prepared Q&A

**Q: Isn't this just a wrapper around Claude Code agents?**

A: Yes, in the same way git is a wrapper around files. The value is in
the workflow glue: the DAG scheduler, the worktree isolation, the
validator that actually runs verify commands, the stagnation detector,
the per-run state scoping, the reviewer that catches cross-module API
mismatches. Each piece is small; the combination is what you want when
you're doing a real multi-file change.

**Q: Does it work with Cursor / Windsurf / Aider / etc?**

A: No, it's Claude Code specific. The agent spawn model and the
`/slash-command` + subagent plumbing are Claude Code features. In
principle the MCP server and the state directory could be reused by
other tools — the 7 tools are standard MCP — but the orchestrator skill
is tied to Claude Code's agent API.

**Q: Why Node.js instead of Python?**

A: Speed of startup and zero-dependency execution matter more than
language features here. The MCP server is 1300 lines and does no heavy
lifting — it's a command runner and a state store. Node was the fastest
path to a stdio MCP server with no build step.

**Q: How does it compare to aider / swe-agent / openhands?**

A: Different layer. Those are end-to-end coding agents — they own the
LLM loop. Forge is a workflow layer on top of Claude Code, which owns
the loop. If you want a ground-up coding agent, use those. If you're
already in Claude Code and want it to handle multi-file changes
reliably, forge.

**Q: What's the failure mode?**

A: Planner makes a bad plan (wrong module decomposition, missing
dependencies, wrong verify commands) and the orchestrator runs the bad
plan to exhaustion before escalating. This happens maybe 1 run in 5,
usually when the objective is under-specified. Mitigation: Phase 1b
forces you to approve the plan before execution, so you catch it
before any work starts.

**Q: What about memory?**

A: Forge has `memory_save` / `memory_recall` for learned patterns
(conventions, failure modes, test commands that worked). It's
intentionally primitive: JSONL append + grep, no embeddings, no vector
DB. For richer cross-session memory I use a companion plugin called
**memem** (https://github.com/TT-Wang/memem). Forge's saves flow into
memem's recall index, so learnings compound.

**Q: Is this production-ready?**

A: I use it daily on my own projects. It has tests (21 passing),
strict CI (lint + node --test matrix + smoke), a stated security
policy, and a 3-figure test count is on the roadmap. Consider it
"stable alpha" — the API surface will change but core behavior is
reliable.

**Q: Telemetry?**

A: None. All state is local in `.forge/`. The MCP server is stdio only
— it opens no network ports.

## Posting checklist

- [ ] Post at 6–9am PT on a Tuesday/Wednesday
- [ ] Reply to every top-level comment in the first 4 hours
- [ ] Don't post-mortem the ranking in a follow-up — just engage with
      comments
- [ ] Have a second screen with the repo open so I can answer
      code-level questions fast
