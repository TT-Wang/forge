# Changelog

All notable changes to forge.

## [0.4.0] - 2026-04-14

### Fixed — orchestration hardening

Six fixes addressing real bugs surfaced while using forge to ship memem
v0.10.0. Every fix is backed by a concrete failure mode observed in a
production run.

**Validator CWD is no longer fixed** (`forge-mcp-server/index.mjs`)
- `handleValidate` now accepts an optional `cwd` parameter that redirects
  file-existence checks, syntax validation, contract checks, and command
  execution to a specified directory. Precedence: `args.cwd > FORGE_CWD
  env > process.cwd()`. Workers running in git worktrees can pass their
  `worktreePath` so validation sees their changes.
- **Why this mattered:** pre-v0.4.0 the validator resolved every path
  against a module-level `CWD` constant set once at MCP server startup
  (always the main project root). When a worker in a worktree called
  `mcp__forge__validate` to check its own work, the validator silently
  checked main, not the worktree. Every worker self-verify was
  meaningless. This is the root cause of the worktree-clobber trust
  problem we hit in memem v0.10.0.
- **Failure modes covered:**
  - Nonexistent `cwd` paths return a `cwd_check` failure with
    `recommendation: "ESCALATE"` and a clear diagnostic, instead of
    letting every command error with a confusing ENOENT.
  - Missing `cwd` falls back to the legacy `CWD` behavior (backward compat).

**Iteration state is now scoped per-run** (`forge-mcp-server/index.mjs`)
- `loadIterationState`, `saveIterationState`, and `handleIterationState`
  now accept an optional `runId` parameter. When provided, state is stored
  at `iterations/<runId>/<moduleId>.json` instead of `iterations/<moduleId>.json`.
- **Why this mattered:** previously, attempt counts, scores, and stagnation
  flags accumulated across every forge run that ever had a module with
  the same ID. A brand-new `m1` in a fresh plan would see `attempt: 21`
  because 20 prior runs had used "m1" too. The stagnation detector then
  triggered `ESCALATE` on a module that had just started.
- **Security:** `runId` is used as a filesystem path segment. A regex
  guard (`/^[\w.-]{1,128}$/`) rejects path traversal attempts like
  `../../../etc` before they reach `path.join`.
- Missing / empty / whitespace-only `runId` falls back to the legacy
  global path (backward compat).

**Worker self-validate is explicitly forbidden** (`agents/worker.md`)
- Workers no longer call `mcp__forge__validate` themselves. They do Bash
  self-checks from their worktree root; the orchestrator runs validation
  at the canonical location (main after merge-back, or the worktree via
  the new `cwd` parameter).
- **Why this mattered:** related to the CWD bug above. Workers were
  producing `"verifyPassed": true` reports backed by validation runs
  that couldn't see their own code. Silent failure propagation.

**Planner recalls framework failure patterns unconditionally** (`agents/planner.md`)
- At Phase 1, the planner now calls `memory_recall` twice: once for
  task keywords, and once with `query: "forge workflow failure"` to
  surface framework-level failure patterns (worktree clobber,
  parallel-file conflicts) regardless of task topic.
- **Why this mattered:** during the memem v0.10.0 run, a `failure_pattern`
  memory about worktree clobber existed in forge global memory from a
  prior session. The planner's keyword-matching recall missed it because
  "worktree" wasn't in the memem release objective. Framework failures
  are task-agnostic — the recall query needs to be too.
- Planner also now flags file overlaps between parallel modules in the
  plan JSON's `warnings` field, and prefers one-file-per-module.

**Plan approval surfaces file-overlap + known risks** (`skills/forge/SKILL.md`)
- Phase 0 now checks working-tree cleanliness before starting and warns
  about uncommitted-changes-in-main clobber risk.
- New Phase 0b: unconditional `memory_recall` for framework failure
  patterns, surfaced under "Known risks from memory" in the plan
  approval output.
- Phase 1b approval output now includes a prominent "File overlap risk"
  section for any file appearing in multiple modules' `files` arrays.
- **Why this mattered:** the #1 cause of silent data loss in multi-tier
  forge runs. Users should see it at approval time, not discover it via
  post-ship regression.

**Auto-WIP-commit between tiers is MANDATORY** (`skills/forge/SKILL.md`)
- Phase 2 now requires a `git add -A && git commit -m "forge wip: tier
  N complete" --allow-empty` between tiers. This ensures the next
  tier's worktrees branch from a state that includes the previous
  tier's work.
- WIP commits are squashed into the final release commit in Phase 5
  via `git reset --soft HEAD~N && git commit` unless `--no-wip-squash`.
- **Why this mattered:** without WIP commits, worktrees in tier N+1
  branched from the original HEAD, which didn't include tier N's
  uncommitted work. When tier N+1 workers merged back, they silently
  clobbered tier N. We lost three modules' work in memem v0.10.0 to
  this before noticing via import-failure post-verification.

**Phase 4.5: mandatory final release review** (`skills/forge/SKILL.md`, `agents/reviewer.md`)
- New phase between retry loops and the learn step. Spawns ONE reviewer
  agent in **final release mode** with the full cumulative diff as
  context. Error-severity findings block the release.
- Reviewer agent now operates in two modes: per-module (Phase 2b) and
  final release (Phase 4.5). Final mode has an 8-item checklist
  targeting bugs per-module review misses:
  1. Field-name consistency across modules
  2. Default-value consistency
  3. Hook / subprocess stdin double-drains
  4. Lazy state-creation races
  5. Transient-vs-permanent error handling
  6. Subprocess cold-start cost in latency-sensitive paths
  7. ARG_MAX exposure on user-provided input
  8. Unbounded injection / outputs
- **Why this mattered:** during the memem v0.10.0 → v0.10.2 cycle, two
  post-ship forge reviews found **12 real bugs** that per-module review
  and 73+ passing tests all missed. Every bug matched one of the 8
  categories above. Building them into a mandatory checklist turns
  "maybe someone will ask for a review" into "the release cannot ship
  without this check."

**Success-pattern memory saves** (`skills/forge/SKILL.md`, `forge-mcp-server/index.mjs`)
- Phase 5 now saves a `success_pattern` memory entry on clean runs with
  run-shape metadata (module count, tier depth, time, file surface,
  retry count). Calibration data for future plans.
- `memory_save` tool schema now includes `success_pattern` in the
  category enum.

**Lite mode for small plans** (`skills/forge/SKILL.md`)
- If the plan has ≤4 modules and no parallelism, OR the user invoked
  `forge --lite`, worktree isolation is skipped entirely and workers
  run inline on main. Phase 4.5 still runs.
- **Why this mattered:** for small plans (3-5 modules), the ceremony
  of plan → worker spawn → worktree → validate → merge-back is slower
  than just doing the edits inline, and it adds the clobber risk for
  zero parallelism benefit.

### Changed

- Plugin version bumped from 0.3.1 → 0.4.0
- MCP server package.json version bumped from 0.2.0 → 0.4.0
- Bundle rebuilt via esbuild
- Marketplace manifest version synced to 0.4.0

### Security

- Path traversal guard on `runId` via regex whitelist
- Existence check on caller-provided `cwd` with early-fail response

### Backward compatibility

- Legacy callers that omit `cwd` and `runId` get exactly the same
  behavior as v0.3.x. No migration required.
- Existing iteration state files under `iterations/` are preserved;
  they just won't be read by runId-scoped callers. Safe to keep or
  delete.
- Existing memory entries are unchanged; new `success_pattern`
  category is additive.

### Meta

This release was shipped using a hybrid of forge and inline execution:
the plan was reviewed, the implementation was done inline on main (no
worktree workers, because we were fixing the worktree worker bugs
themselves), and the final cross-module review ran through the new
Phase 4.5 reviewer — which caught 4 error-severity bugs (2 path
traversal, 1 phase ordering, 1 schema drift) that were fixed before
shipping. The review system reviewed itself and found real bugs.
