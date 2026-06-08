# Changelog

All notable changes to forge.

## [0.7.0] - 2026-06-08

Failure-pattern-driven release. Audited recurring failures across the last ~15 forge runs (memem v1.4 through v2.1.0, loom m1-m4, demand-dog, text-editor-proto) and shipped fixes for the highest-impact recurrence patterns.

### Fixed (orchestrator — skills/forge/SKILL.md)

- **Stale-base bug** — workers spawned with `isolation: "worktree"` for tier ≥1 can branch from `git merge-base HEAD master` instead of current HEAD, missing prior tier's WIP commit. Confirmed in memem v1.5.0 m1, v2.0.0 m8, v2.0.0 triage worker — 3 separate recurrences. Fix: orchestrator now does a pre-spawn worktree rebase check (Phase 2 step 1a) and force-rebases when stale.
- **Silent worker death** — forge:worker Agent calls can hang or exit without DONE/BLOCKED, leaving orchestrator waiting forever. Confirmed in memem v2.0.0 m8 + triage worker. Fix: Phase 2 step 1b adds watchdog convention — poll worktree mtime every 2-3 min; if static for 5+ min AND no Agent result, classify as DEAD and surface to user.
- **Post-DONE worktree merge inconsistency** — workers' worktree changes sometimes auto-merged, sometimes not (m5/m6 vs m2/m4 in memem v1.4.0). Fix: Phase 2 step 3a now requires orchestrator to always check `git -C <worktreePath> diff` and apply patches explicitly.
- **Phase 4.5 single-lens critical promotion** — strict ≥2-lens rule missed memem v2.1.0 A1 (mine_delta nested-schema mismatch) — only Lens A read the actual transcript file; tests all passed; would have shipped a silently nonfunctional miner. Fix: Phase 4.5 aggregation now also promotes single-lens findings with severity=error AND category in {silent-failure, contract-mismatch, schema-drift} to must-fix.

### Fixed (validate MCP tool — forge-mcp-server/index.mjs)

- **`grep -c` exit-1 false-positive** — `grep -c PATTERN FILE` outputs `0` (desired, no matches) but exits 1, which validate treated as failure. Score 1.0 → 0.93 → RETRY_WITH_DEBUGGER on a tool-artifact. Recurred 2× in memem v2.1.0 (m5 + m10). Fix: detect `grep -c` with exit code 1 and numeric-0 stdout, treat as passing with note.
- **Per-file `tsc --noEmit` syntax-check removed** — running `npx tsc --noEmit --allowJs --skipLibCheck <file>` standalone has no tsconfig context, so any TS file importing a project module fails unresolved-module errors even when project-level type-check is clean. Confirmed in loom-m1. Fix: removed the .ts/.tsx case from per-file syntax check. Plans should use a project-level type-check in their `verify` commands.

### Added (planner — agents/planner.md)

- **Delete-X blast radius pre-check** — for every file slated for deletion, grep importers and either expand the module's scope OR add a tier-0 const-inline module. Prevents memem v2.1.0 m5's mid-execution scope expansion (specced 2 files, needed 5).
- **Subprocess constant import enforcement** — when adding a subprocess call to a CLI/API the codebase already uses, force-import existing timeout/auth/retry constants. Prevents memem v1.7 m3's silent timeout drift.
- **Real-fixture requirement for parsers** — parser/extractor modules must include at least one test fixture sourced from real production data, not synthesized. Prevents memem v2.1.0 A1 (mine_delta schema mismatch).

### Added (release process)

- **`FORGE_VERSION` constant + single-source-of-truth** — Server constructor version now reads from `package.json` at module load. Server-version drift had been independently re-introduced in v0.5.0, v0.6.0, and v0.6.1 — three regressions of the same class. This change eliminates the class entirely.
- **`tests/version_consistency.test.mjs`** — asserts Server constructor uses `FORGE_VERSION`, the constant is derived from `PACKAGE_JSON.version`, and `.claude-plugin/{plugin,marketplace}.json` versions lock-step with `package.json`. Drift now fails CI, not production.
- **Release checklist** added to CONTRIBUTING.md — explicit 4-manifest bump list with pre-flight grep.

### Tests

- 53 passing (was 51) — added 2 version-consistency tests
- All pre-existing tests still green

## [0.6.1] - 2026-05-09

Patch release — Phase 4.5 final review caught one BLOCKER + three warnings on v0.6.0.

### Fixed (BLOCKER)

- **MCP server version drift regression** — `forge-mcp-server/index.mjs` Server
  constructor still advertised `"0.5.0"` while every manifest was at `0.6.0`.
  This is the same drift bug v0.5.0 explicitly fixed and shipped as a fix.
  Bumped to `0.6.1` to match manifests.

### Fixed (warnings)

- **Phase 4 blocked short-circuit now persists state.** The orchestrator now calls
  `mcp__forge__session_state` action=save when overseer classifies a failure as
  `blocked`, so a session drop right after escalation doesn't lose the BLOCKED
  status. Previously the only Phase 2-step-6 save path was bypassed.
- **Tool-call summary sourcing clarified.** SKILL.md Phase 4 step 3 used to say
  "Walk the conversation transcript", which isn't feasible — the orchestrator can
  see Agent tool results, not sub-agent tool call history. Now sourced from the
  worker's DONE report directly. `agents/worker.md` updated to require a
  `toolCallSummary` field on `DONE_WITH_CONCERNS` / `BLOCKED` reports (optional
  on clean DONE).
- **CHANGELOG correction:** v0.6.0 stats said "was 30 pre-v0.6.0" — actual
  baseline was 21 tests. v0.6.1 stats: 51 → still 51 (no new tests this patch).

## [0.6.0] - 2026-05-09 — Agentic Design Patterns batch

Four patterns from Antonio Gulli's *Agentic Design Patterns* (Springer 2025) applied
after a focused audit of forge against the book's 21 patterns.

### Added — F-1: Self-Consistency reviewer for Phase 4.5

Phase 4.5 now spawns three reviewer agents in parallel, each with a distinct lens:
- **Lens A** — cross-cutting bugs and field-name mismatches
- **Lens B** — race conditions, concurrency, lazy state, TOCTOU
- **Lens C** — backward-compat breaks, default-value drift, hardcoded paths

Findings cited by ≥2 lenses become "must-fix" (block release); singletons go in an
"advisory" bucket. All three reviewers spawn with `model: opus`. Cost: 3× a single
Opus reviewer pass — intentional uplift for the release-blocking decision.

Source: book pp. 277-278, 361-362.

### Added — F-2 + F-3: Contractor planner schema + Trajectory eval (optional fields)

Planner output schema extended with five OPTIONAL per-module fields:
- `acceptance_criteria` — list of `{check, expected, blocking}` the reviewer scores against
- `disallowed_changes` — file/glob patterns the worker must not modify (AUTO-BLOCK if violated)
- `cost_budget` — `{max_tokens?, max_retries?}` soft guardrails
- `success_evidence` — string describing what artifact proves completion
- `expected_trajectory` — list of high-level steps; reviewer compares actual vs. expected

All fields are OPTIONAL — existing plans validate unchanged. validate_plan accepts
plans with or without these fields, rejects only when present-but-malformed.

Source: book pp. 316-320.

### Added — F-4: Pre-retry overseer

A new `overseer` agent runs in Phase 4 BEFORE the debugger spawns. It classifies
worker failures as `stuck` / `missing_context` / `blocked` and shapes the debugger's
prompt accordingly. The orchestrator extracts a worker tool-call summary from the
transcript and passes it inline (since native Edit/Read/Bash calls don't appear in
forge_logs — only the 7 MCP tools do). For `blocked` classification, the orchestrator
short-circuits the debugger entirely and escalates to the user.

Real-time async overseer (watching a running worker's callgraph) is deferred — would
require rearchitecting worker spawning.

Source: book pp. 101-105 (SICA case study).

### Changed

- Phase 4.5 cost: 3× Opus reviewer pass (was 1× Opus). Documented in SKILL.md.
- Aggregation summary print now distinguishes "RELEASE BLOCKED" (must-fix > 0) vs
  "RELEASE CLEAR" (must-fix == 0).
- Reviewer agent now evaluates 5 optional planner fields when present.

### Stats

- 51 tests pass (was 21 pre-v0.6.0)
- Two new test files: `validate_plan.test.mjs` (21 tests), `iteration_state.test.mjs` (9 tests documenting overseer API compatibility)
- New agent file: `agents/overseer.md`

## [0.5.0] - 2026-04-15 — Launch

### Fixed — critical plugin loader

- **Plugin bootstrap replaced.** `plugin.json` previously pointed at
  `forge-mcp-server/dist/index.mjs`, an esbuild bundle that had
  drifted from source since around v0.2.x. Every user installing
  forge from the marketplace was running pre-v0.4.0 code — none of
  the v0.4.0 orchestration hardening or the subsequent code-review
  fixes were reaching them. `dist/` is now deleted; `plugin.json`
  points at `forge-mcp-server/start.sh`, which does a first-run
  `npm install --omit=dev` into the plugin directory if
  node_modules is missing, then execs `node index.mjs`. No more
  bundle drift.

### Fixed — code-review P0 + P1 findings

A post-release code review surfaced three P0 bugs and seven P1
quality issues. All fixed:

- **Path traversal** — `handleForgeLogs`, `handleSessionState`, and
  `handleIterationState` now reject `runId` values that don't match
  `/^[\w.-]{1,128}$/`. Previously a crafted `runId` like
  `../../etc/passwd` would escape `.forge/` on read or write.
- **Shell injection** — `validate_plan`'s command existence check
  now uses `execFileSync('which', [firstWord])` instead of
  `execSync(\`which ${firstWord}\`)`. Verify commands starting with
  `$(...)` can no longer execute arbitrary shell.
- **Untested handler** — added tests for `handleValidate` covering
  the happy path, nonexistent `cwd` escalation, and missing-file
  detection. Previously the largest handler had zero test coverage.
- **Per-run progress** — `writeProgressFile` now scans per-run
  iteration subdirectories (`iterations/<runId>/<moduleId>.json`,
  the v0.4.0 layout) with latest-run preference, falling back to
  the legacy flat layout. Before this, the statusline showed
  "pending" for every module even after validation passed.
- **Server version drift** — MCP server advertised `0.2.0` while
  `package.json` was at `0.4.0`. Constructor version bumped to
  `0.5.0` in this release.
- **Branch mismatch** — `CONTRIBUTING.md`, `SECURITY.md`, and
  `llms.txt` all said `master`; CI was triggered on `main`. All
  aligned on `main`.
- **Strict lint** — ESLint was previously advisory (`|| true`) in
  CI. Now blocking. Prettier check moved from CI to local/editor.
- **Deterministic install** — `npm ci || npm install` fallback
  removed; CI now uses plain `npm install --no-audit --no-fund`.
- Dead code (`initRunLog`) removed; unused imports in tests
  removed; ESLint config updated to recognize
  `caughtErrorsIgnorePattern: "^_"`.

### Added — OSS polish

- **SECURITY.md** — private vulnerability reporting, scope,
  defence-in-depth posture
- **CONTRIBUTING.md** — dev setup, test/lint/PR process,
  architecture notes
- **docs/architecture.md** — full architecture walkthrough with
  ASCII diagram and per-component responsibilities
- **docs/mcp-tools.md** — input/output schemas and examples for all
  7 MCP tools
- **llms.txt** — LLM-discoverable metadata file at repo root
- **docs/launch/** — launch-week materials (blog post, Show HN draft,
  social thread) checked in for transparency and reuse
- **README badges** — CI status, MIT license, Node ≥20
- **.github/workflows/ci.yml** — blocking lint + `node --test`
  matrix on Node 20/22 + import smoke test + plugin manifest JSON
  validation
- **.github/ISSUE_TEMPLATE/** + **pull_request_template.md** — issue
  templates, PR checklist
- **.github/dependabot.yml** — weekly npm + monthly github-actions
  dependency updates
- **forge-mcp-server/eslint.config.mjs** — ESLint flat config
- **forge-mcp-server/tests/forge-mcp.test.mjs** — 21 tests covering
  validate, validate_plan, memory, iteration_state (including the
  v0.4.0 per-run scoping regression), session_state, forge_logs,
  runId traversal guards, and import-time bootstrap
- **Cross-link with [memem](https://github.com/TT-Wang/memem)** —
  README and llms.txt both call out the recommended pairing

### Changed

- MCP server import is now re-entrant for tests: `index.mjs` exports
  all handlers and only connects stdio when run as the main module.
- `docs/architecture.md` corrected: the orchestrator (not the worker)
  calls `validate` with `cwd: <worktreePath>` after a worker reports
  DONE. Previously the doc contradicted `worker.md` and
  `skills/forge/SKILL.md`.

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
