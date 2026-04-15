#!/usr/bin/env node

// forge MCP server
// Provides: validate, memory_recall, memory_save, iteration_state,
//           validate_plan, forge_logs, session_state
// Run: node forge-mcp-server/index.mjs
// Env: FORGE_CWD — project root (defaults to cwd)

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync, execFileSync } from "child_process";
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  renameSync,
} from "fs";
import { join, resolve, extname, dirname } from "path";

const CWD = resolve(process.env.FORGE_CWD || process.cwd());
const FORGE_DIR = join(CWD, ".forge");
const PROGRESS_FILE = "/tmp/forge-status.json";
const PROGRESS_TMP = "/tmp/forge-status.tmp";
let forgeStartedAt = null;

// ─── Structured logging ───────────────────────────────────────────

let currentRunId = null;

function getOrInitRunId() {
  if (currentRunId) return currentRunId;
  const logsDir = join(FORGE_DIR, "logs");
  mkdirSync(logsDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const existing = existsSync(logsDir)
    ? readdirSync(logsDir).filter((f) => f.startsWith(today) && f.endsWith(".jsonl"))
    : [];
  const n = existing.length + 1;
  currentRunId = `${today}-${n}`;
  return currentRunId;
}

function logEvent(event) {
  try {
    const runId = getOrInitRunId();
    const entry = {
      timestamp: new Date().toISOString(),
      runId,
      phase: event.phase || "unknown",
      moduleId: event.moduleId || null,
      event: event.event || "unknown",
      severity: event.severity || "info",
      data: event.data || {},
    };
    const logPath = join(FORGE_DIR, "logs", `${runId}.jsonl`);
    appendFileSync(logPath, JSON.stringify(entry) + "\n");
  } catch (_) {
    // Logging should never crash the server
  }
}

// ─── Ensure directories ──────────────────────────────────────────

for (const dir of ["plans", "memory", "iterations", "logs", "state"]) {
  mkdirSync(join(FORGE_DIR, dir), { recursive: true });
}

const server = new Server(
  { name: "forge", version: "0.5.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "validate",
      description: `Run full verification for a forge module against a specific working directory. Executes the module's verify commands in a subprocess, checks that required files exist on disk, runs AST-level syntax validation for .js/.mjs/.cjs/.py/.ts/.tsx files, and performs cross-module API contract checks (importer references matched against exporter symbols). Tracks attempts across retries, detects stagnation when the same failure set recurs, measures score velocity across attempts, and flags oscillation when the current failures match any of the last four attempts. Returns a structured pass/fail verdict with a per-check breakdown and a recommendation field (PROCEED, RETRY, ESCALATE).

Behaviour:
  - MUTATION. Appends an attempt entry to the module's iteration state
    at \`.forge/iterations/<runId>/<moduleId>.json\` when runId is
    provided, or the legacy flat path otherwise. Also emits a
    \`tool_call\` and a \`validate\` event to the current run's JSONL log.
  - No authentication, no network calls, no rate limits.
  - Verify commands run with a 2-minute per-command timeout; AST
    syntax checks get 60 seconds each. Commands execute through the
    shell (\`execSync\`) so plan-generated commands can use pipes and
    redirects — plans are human-approved before execution.
  - The \`cwd\` argument (v0.4.0+) redirects file existence checks,
    syntax checks, contract checks, and command execution to a
    specified directory. Precedence: \`args.cwd > FORGE_CWD env >
    process.cwd()\`. Workers running in isolated git worktrees MUST
    pass their worktree path as \`cwd\` — otherwise validation silently
    checks the main project root, and every worker DONE report would
    be meaningless.
  - Nonexistent \`cwd\` returns a \`cwd_check\` failure with
    \`recommendation: "ESCALATE"\` and a clear diagnostic, rather than
    letting every command fail with an opaque ENOENT.

Use when:
  - The orchestrator has received a DONE report from a worker agent
    and needs to verify that the changes actually compile, run, and
    honor any cross-module API contracts before merge-back.
  - A module has just been retried by the debugger agent and you
    want to know whether the attempt count has crossed the stagnation
    threshold.
  - A user invokes \`/forge-validate <moduleId>\` manually to re-run
    checks on a completed or in-progress module.

Do NOT use for:
  - Plan-level structural checks (DAG cycles, missing commands) —
    use \`validate_plan\` instead.
  - Querying past validation attempts without bumping a counter —
    use \`forge_logs\` or \`iteration_state\` with \`action: "get"\`.
  - Running commands outside the context of a known moduleId — this
    tool mutates per-module iteration state.

Returns: A JSON text block with
\`{ passed, score, results[], attempt, stagnant, velocity, oscillating,
recommendation, sameAsPrev }\`
where \`results[]\` is a list of per-check objects tagged with \`type\`
(\`file_check\`, \`syntax_check\`, \`contract_check\`, \`command\`,
\`cwd_check\`) and their pass/fail metadata.

Example:
    validate({
      moduleId: "m3",
      runId: "2026-04-15-1",
      files: ["src/auth.mjs", "src/auth.test.mjs"],
      commands: ["node --test src/auth.test.mjs"],
      cwd: "/tmp/forge-worktrees/m3"
    })
    → { "passed": true, "score": 1.0, "recommendation": "PROCEED",
        "results": [ ... ], "attempt": 1, "stagnant": false }`,
      inputSchema: {
        type: "object",
        properties: {
          moduleId: {
            type: "string",
            description: "Module ID (e.g. m1, m2)",
          },
          runId: {
            type: "string",
            description:
              "Optional run ID (plan slug). Scopes iteration state so attempts from different forge runs don't pollute each other. Strongly recommended — without it, attempts accumulate across all runs forever.",
          },
          cwd: {
            type: "string",
            description:
              "Optional absolute path to redirect file checks and command execution. Workers running in git worktrees should pass their worktree path here so validation sees their changes. Precedence: args.cwd > FORGE_CWD env > process.cwd(). Must exist when provided — nonexistent paths return a cwd_check failure with recommendation=ESCALATE.",
          },
          commands: {
            type: "array",
            items: { type: "string" },
            description: "Shell commands to run as verification checks",
          },
          files: {
            type: "array",
            items: { type: "string" },
            description:
              "File paths (relative to the validation working dir — `cwd` if provided, else server CWD) that should exist after module completion",
          },
          contractChecks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                exporter: { type: "string", description: "File path that exports symbols" },
                importer: { type: "string", description: "File path that imports symbols" },
              },
              required: ["exporter", "importer"],
            },
            description:
              "Optional cross-module API contract checks — verifies importer references match exporter exports",
          },
        },
        required: ["moduleId", "commands"],
      },
    },
    {
      name: "validate_plan",
      description: `Structurally validate a forge plan JSON file before any worker spawns. Checks: required-field schema (\`id\`, \`title\`, \`objective\`, \`files\`, \`verify\`, \`doneWhen\` on every module), DAG cycle detection via Kahn's algorithm, references to unknown \`dependsOn\` modules, file-overlap warnings between modules that could run in parallel (which would cause worktree merge conflicts), and verify-command existence on \`PATH\` (commands are checked via \`execFileSync('which', [firstWord])\` to avoid shell injection via crafted verify strings). Catches plans that would fail at runtime and reports concrete errors before any worker is spawned.

Behaviour:
  - READ-ONLY for the plan file. Emits a \`plan_validation\` event to
    the current run's JSONL log.
  - No authentication, no network, no rate limits.
  - Never throws to the caller — every problem is returned as an
    entry in the \`errors[]\` or \`warnings[]\` arrays.
  - \`planPath\` is optional; when omitted, the most recently modified
    file in \`.forge/plans/\` is used.

Use when:
  - Immediately after the planner agent writes a plan to disk, and
    before the orchestrator enters Phase 1b (plan approval).
  - Debugging why a plan's execution order looks wrong — file-overlap
    warnings usually explain "two parallel workers clobbered each
    other" bug reports.
  - A human is hand-editing a plan file and wants a pre-flight check.

Do NOT use for:
  - Executing a plan — this tool is dry-run only.
  - Validating a single module's build output — use \`validate\`
    instead.
  - Inspecting attempt counts or retry history — use
    \`iteration_state\` with \`action: "get"\`.

Returns: \`{ valid: bool, errors[], warnings[] }\`. \`valid\` is true iff
\`errors[]\` is empty. Errors halt execution (cycles, missing required
fields, commands not found on PATH). Warnings are advisory (file
overlap between parallel modules).

Example:
    validate_plan({ planPath: ".forge/plans/add-auth.json" })
    → { "valid": true, "errors": [],
        "warnings": [
          { "type": "file_overlap", "modules": ["m2", "m3"],
            "files": ["src/config.mjs"],
            "message": "Modules m2 and m3 both modify src/config.mjs but could run in parallel. Consider adding a dependency edge." }
        ] }`,
      inputSchema: {
        type: "object",
        properties: {
          planPath: {
            type: "string",
            description:
              "Path to a plan JSON file. If omitted, reads the most recent plan from .forge/plans/.",
          },
        },
      },
    },
    {
      name: "memory_recall",
      description: `Search forge's learned-pattern memory for entries relevant to a query. Memory is a simple JSONL store (not a vector index) — forge keeps it deliberately primitive so the format is human-readable, git-friendly, and cheap to grep. Each entry has a category (convention, failure_pattern, success_pattern, test_command, architecture, dependency, tool_usage), a free-text pattern, a confidence in [0,1], and a timestamp. Results are keyword-matched against pattern text, category name, and any included tags.

Behaviour:
  - READ-ONLY, idempotent. No telemetry side effects, no access
    counters bumped, no state mutated.
  - No authentication, no network, no rate limits.
  - Reads \`.forge/memory/project.jsonl\` and/or
    \`.forge/memory/global.jsonl\` depending on \`scope\`.
  - Returns an informative empty result if the query has no matches
    — never throws.

Use when:
  - The planner agent is about to decompose an objective and wants
    to check whether forge has already learned conventions for this
    project (test commands, style rules, known failure modes).
  - The debugger agent is analysing a failure and wants to check
    whether the same pattern has been seen and resolved before.
  - A worker agent is deciding between two approaches and wants to
    bias towards one that previously worked.

Do NOT use for:
  - Saving new patterns — use \`memory_save\`.
  - Looking up per-module retry history — use \`iteration_state\`.
  - Querying structured run events — use \`forge_logs\`.
  - Full-text search across commit history or codebase — this is
    learned patterns only, not source code.

Returns: A text block listing matching entries, each showing
category, pattern, confidence, and timestamp. Grouped by scope
(project first, then global) and sorted by confidence descending
within each group.

Example:
    memory_recall({ query: "test command", scope: "project" })
    → "Found 2 matches in project memory:
       [test_command] 0.9 — pnpm vitest --run (watch mode hangs in CI)
       [test_command] 0.8 — avoid npm test, use pnpm test instead"`,
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Keywords to search for (e.g. 'test conventions', 'auth patterns', 'python')",
          },
          scope: {
            type: "string",
            enum: ["project", "global", "all"],
            description: "Which memory store to search (default: all)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_save",
      description: `Persist a learned pattern to forge's project or global memory for future recall. Patterns are stored as JSONL entries with category, pattern text, confidence, and timestamp. Duplicate patterns (same category + same text, case-insensitive) are rejected on write to prevent memory bloat from repeatedly saving the same lesson across runs.

Behaviour:
  - MUTATION. Appends a new JSON line to
    \`.forge/memory/<scope>.jsonl\`. Dedup check reads the existing
    file first; if a matching \`(category, pattern)\` already exists,
    the save is skipped and a "duplicate skipped" message is returned.
  - Idempotent on \`(category, pattern)\`: calling twice with the same
    values produces one entry, not two.
  - No authentication, no network, no rate limits.
  - Appends are atomic on POSIX filesystems, so parallel workers can
    save concurrently without corrupting the file.

Use when:
  - Phase 5 (Learn) at the end of a forge run — the orchestrator
    records test commands that worked, conventions discovered by
    the planner, and failure patterns surfaced by the debugger.
  - A debugger agent has diagnosed a non-obvious root cause and
    wants to make sure the next run doesn't re-learn it from
    scratch.
  - A reviewer agent has identified a convention (naming, file
    layout, test framework) the project consistently follows and
    wants future workers to match it automatically.

Do NOT use for:
  - Ephemeral session state — use \`session_state\` instead. Memory
    is for knowledge that should outlive the run.
  - Module retry history — that is tracked automatically by
    \`iteration_state\` and \`validate\`.
  - Run-specific commentary or event logs — those belong in
    \`forge_logs\`, which is written automatically on every tool call.
  - Huge blobs of text (>1 KB) — memory entries are meant to be
    compact lessons, not dumps.

Returns: Confirmation string — either "Saved to <scope> memory
[<category>]: <pattern>" on new insert, or "Duplicate pattern
already in <scope> memory, skipped." on dedup hit.

Example:
    memory_save({
      pattern: "pnpm vitest --run for CI; watch mode hangs",
      category: "test_command",
      scope: "project",
      confidence: 0.9
    })
    → "Saved to project memory [test_command]: pnpm vitest --run..."`,
      inputSchema: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The pattern or learning to save",
          },
          category: {
            type: "string",
            enum: [
              "convention",
              "failure_pattern",
              "success_pattern",
              "test_command",
              "architecture",
              "dependency",
              "tool_usage",
            ],
            description:
              "Category of the learning. `success_pattern` is used by orchestrator Phase 5 to record run-shape calibration data (module count, tier depth, total time) for future planning.",
          },
          confidence: {
            type: "number",
            minimum: 0,
            maximum: 1,
            description: "Confidence level 0-1 (default: 0.7)",
          },
          scope: {
            type: "string",
            enum: ["project", "global"],
            description:
              "Save to project memory (this project only) or global (all projects). Default: project",
          },
        },
        required: ["pattern", "category"],
      },
    },
    {
      name: "iteration_state",
      description: `Read, update, or reset the per-module retry state for a forge run. Tracks attempt count, score history, last status, last root cause from the debugger, and a stagnation flag. In v0.4.0+ state is scoped per run via \`runId\` so attempt counts don't accumulate across unrelated forge runs that happen to share a moduleId (pre-v0.4.0 a brand-new m1 in a fresh plan could see \`attempt: 21\` because 20 prior runs had also used "m1" — stagnation detection would then escalate a module that had just started).

Behaviour:
  - READ (get), MUTATION (update, reset).
  - State files live at
    \`.forge/iterations/<runId>/<moduleId>.json\` when runId is
    provided, or \`.forge/iterations/<moduleId>.json\` for legacy
    callers.
  - \`runId\` is guarded against path traversal via the
    \`_RUN_ID_PATTERN\` regex (\`/^[\\w.-]{1,128}$/\`) — invalid
    values return a structured error, never a traversal attempt.
  - No authentication, no network, no rate limits.
  - \`get\` on an unknown module returns a clean empty-state object
    \`{ attempts: [], scores: [], stagnant: false }\` rather than
    throwing.

Use when:
  - The orchestrator wants to know how many times module m3 has
    been retried so far and whether the stagnation flag has
    flipped — drives the decision between RETRY and ESCALATE.
  - A debugger agent wants to inspect the last root cause before
    proposing a new approach.
  - Resetting: a plan has finished and the next run should start
    fresh even if moduleIds are reused. Or a human has manually
    cleared a stuck module and wants the counter zeroed.

Do NOT use for:
  - Cross-module reasoning or run-wide progress — that is
    \`session_state\`.
  - Recording the result of a single validation attempt — that is
    done automatically by \`validate\` on every call.
  - Inspecting validation results without side effects — \`get\` is
    safe, but \`update\` bumps counters and flags.

Returns (get): The full state object
\`{ attempts: [...], scores: [...], stagnant: bool, lastStatus,
lastRootCause }\`.
Returns (update): \`{ updated: true, attempt: N, stagnant: bool }\`.
Returns (reset): A confirmation string.

Example:
    iteration_state({
      moduleId: "m3",
      action: "get",
      runId: "2026-04-15-1"
    })
    → { "attempts": [
          { "timestamp": "...", "status": "failed", "score": 0.4, "issues": [...] },
          { "timestamp": "...", "status": "failed", "score": 0.6, "issues": [...] }
        ], "scores": [0.4, 0.6], "stagnant": false }`,
      inputSchema: {
        type: "object",
        properties: {
          moduleId: {
            type: "string",
            description: "Module ID (e.g. m1)",
          },
          runId: {
            type: "string",
            description:
              "Optional run ID (plan slug). Scopes state to the current forge run. Without it, falls back to legacy global-state behavior.",
          },
          action: {
            type: "string",
            enum: ["get", "update", "reset"],
            description: "get = read state, update = add attempt, reset = clear state",
          },
          update: {
            type: "object",
            description: "Data for update action",
            properties: {
              status: {
                type: "string",
                enum: [
                  "running",
                  "passed",
                  "failed",
                  "stagnant",
                  "escalated",
                  "blocked",
                ],
              },
              issues: {
                type: "array",
                items: { type: "string" },
                description: "List of issues found in this attempt",
              },
              score: {
                type: "number",
                description: "Validation score (0-1)",
              },
              rootCause: {
                type: "string",
                description: "Root cause identified by debugger",
              },
            },
          },
        },
        required: ["moduleId", "action"],
      },
    },
    {
      name: "forge_logs",
      description: `Query the structured JSONL event stream that forge writes on every tool call throughout a run. Filter by \`runId\`, \`moduleId\`, \`phase\` (\`planning\`, \`execution\`, \`validation\`, \`review\`, \`retry\`, \`memory\`, \`session\`, \`tool_call\`, \`plan_validation\`), \`severity\` (\`info\`, \`warn\`, \`error\`), and \`limit\`. Lets agents reconstruct what happened without re-running anything, and lets humans audit a run after the fact without paging through console output.

Behaviour:
  - READ-ONLY, idempotent.
  - Reads \`.forge/logs/<runId>.jsonl\`. When \`runId\` is omitted,
    the most recently modified log file in \`.forge/logs/\` is used.
  - \`runId\` is guarded against path traversal via
    \`_RUN_ID_PATTERN\`.
  - JSON parse errors on individual lines are silently skipped —
    a single corrupt line does not crash the query.
  - No authentication, no network, no rate limits.

Use when:
  - A debugger agent needs the sequence of events leading up to a
    module failure — especially useful for diagnosing why
    validation failed even though review passed.
  - A user wants to audit what a forge run actually did, after the
    fact, without re-running anything.
  - The orchestrator wants to confirm that a prior phase completed
    successfully before transitioning.
  - Investigating an escalation: pull all \`severity: "error"\`
    entries for the run and read them in order.

Do NOT use for:
  - Live progress display — read \`/tmp/forge-status.json\` which
    the server refreshes on every tool call, or call
    \`session_state\` with \`action: "list"\`.
  - Appending new entries — the server writes logs automatically;
    there is no external append API.
  - Long-term knowledge — that's \`memory_save\` / \`memory_recall\`.

Returns: \`{ runId, entries: [...], total }\`. Each entry is
\`{ timestamp, runId, phase, moduleId, event, severity, data }\`.
\`data\` is a free-form object whose shape depends on the event
type.

Example:
    forge_logs({
      runId: "2026-04-15-1",
      phase: "validation",
      severity: "error",
      limit: 10
    })
    → { "runId": "2026-04-15-1", "total": 2, "entries": [
          { "timestamp": "...", "phase": "validation",
            "moduleId": "m3", "event": "validate",
            "severity": "error",
            "data": { "passed": false, "score": 0.5, ... } },
          ...
        ] }`,
      inputSchema: {
        type: "object",
        properties: {
          runId: {
            type: "string",
            description: "Run ID to query. If omitted, uses most recent log file.",
          },
          moduleId: {
            type: "string",
            description: "Filter by module ID",
          },
          phase: {
            type: "string",
            description: "Filter by phase name",
          },
          severity: {
            type: "string",
            enum: ["info", "warn", "error"],
            description: "Filter by severity level",
          },
          limit: {
            type: "number",
            description: "Max entries to return (default: 50)",
          },
        },
      },
    },
    {
      name: "session_state",
      description: `Save, load, or list orchestrator session snapshots for resumability. Lets a \`/forge\` workflow survive a crash, conversation restart, or an intentional pause — the next invocation can pick up exactly where the previous one left off, without re-planning or re-running completed modules.

Behaviour:
  - MUTATION on \`save\`, READ on \`load\` and \`list\`.
  - State lives at \`.forge/state/<runId>.json\`. Writes use atomic
    tmp + rename semantics so a crash mid-save can never leave a
    partial file on disk.
  - \`runId\` is guarded against path traversal via
    \`_RUN_ID_PATTERN\` (\`/^[\\w.-]{1,128}$/\`).
  - Every \`save\` stamps the state with a fresh \`lastUpdatedAt\`
    ISO timestamp; \`list\` sorts most-recent first using this
    field.
  - No authentication, no network, no rate limits.

Use when:
  - The orchestrator has just completed a phase transition (plan
    approved, first parallel batch finished, module escalated)
    and wants to persist progress in case the session drops.
  - A fresh Claude Code session wants to resume an abandoned run:
    call \`session_state({ action: "list" })\`, find the most
    recent run with \`completedCount < totalCount\`, then
    \`session_state({ action: "load", runId: "..." })\`.
  - A user has invoked \`/forge-status\` and the orchestrator is
    computing the summary.

Do NOT use for:
  - Per-module retry state — that's \`iteration_state\`.
  - Cross-run learned patterns — that's \`memory_save\`.
  - Ephemeral progress for the statusline — the server writes
    \`/tmp/forge-status.json\` automatically on every tool call;
    don't duplicate it here.

Returns:
  \`save\`: \`{ saved: true, runId, lastUpdatedAt }\`
  \`load\`: \`{ found: true, ...state }\` when the file exists,
  \`{ found: false, runId }\` when it does not.
  \`list\`: \`{ sessions: [{ runId, lastUpdatedAt, currentPhase,
           completedCount, totalCount }, ...] }\` sorted by
  \`lastUpdatedAt\` descending.

Example:
    session_state({
      action: "save",
      runId: "2026-04-15-1",
      state: {
        currentPhase: "execute",
        moduleStatuses: { m1: "done", m2: "running", m3: "pending" },
        completedModules: ["m1"],
        startedAt: "2026-04-15T10:00:00Z"
      }
    })
    → { "saved": true, "runId": "2026-04-15-1", "lastUpdatedAt": "..." }`,
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["save", "load", "list"],
            description: "save = persist state, load = restore state, list = show all sessions",
          },
          runId: {
            type: "string",
            description: "Run ID (required for save/load, ignored for list)",
          },
          state: {
            type: "object",
            description:
              "Orchestrator state to persist (for save). Expected shape: {runId, planPath, currentPhase, moduleStatuses: {[moduleId]: status}, retryCounts: {[moduleId]: number}, completedModules: [string], startedAt, lastUpdatedAt}",
          },
        },
        required: ["action"],
      },
    },
  ],
}));

// ─── Tool implementations ──────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Auto-log every tool call
  logEvent({
    phase: "tool_call",
    moduleId: args.moduleId || null,
    event: name,
    severity: "info",
    data: { args: summarizeArgs(args) },
  });

  try {
    let result;
    switch (name) {
      case "validate":
        result = handleValidate(args);
        break;
      case "validate_plan":
        result = handleValidatePlan(args);
        break;
      case "memory_recall":
        result = handleMemoryRecall(args);
        break;
      case "memory_save":
        result = handleMemorySave(args);
        break;
      case "iteration_state":
        result = handleIterationState(args);
        break;
      case "forge_logs":
        result = handleForgeLogs(args);
        break;
      case "session_state":
        result = handleSessionState(args);
        break;
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
    try {
      writeProgressFile();
    } catch (_) {}
    return result;
  } catch (err) {
    logEvent({
      phase: "tool_call",
      moduleId: args.moduleId || null,
      event: `${name}_error`,
      severity: "error",
      data: { error: err.message },
    });
    return errorResult(`Tool ${name} failed: ${err.message}`);
  }
});

// ─── validate ──────────────────────────────────────────────────────

function handleValidate(args) {
  const { moduleId, commands = [], files = [], contractChecks = [], runId } = args;
  // v0.4.0: `cwd` can now override the module-level CWD so workers running
  // inside git worktrees can redirect validation to their own directory.
  // Precedence: args.cwd > FORGE_CWD env > process.cwd(). Falls back to CWD
  // (the server-level constant) when args.cwd is not provided, preserving
  // backward compatibility for legacy callers.
  const workingDir = args.cwd ? resolve(args.cwd) : CWD;

  // Early validation: if the caller passed a cwd that doesn't exist, fail
  // fast with a clear diagnostic instead of letting every command error with
  // a confusing ENOENT. This also catches typos in worktree paths.
  if (args.cwd && !existsSync(workingDir)) {
    return textResult(
      JSON.stringify(
        {
          passed: false,
          score: 0,
          results: [
            {
              type: "cwd_check",
              passed: false,
              cwd: workingDir,
              error: `Working directory does not exist: ${workingDir}`,
            },
          ],
          stagnant: false,
          velocity: null,
          oscillating: false,
          attempt: 0,
          recommendation: "ESCALATE",
        },
        null,
        2,
      ),
    );
  }

  const results = [];
  let allPassed = true;

  // 1. Check files exist (now relative to working dir, not server CWD)
  for (const f of files) {
    const absPath = resolve(workingDir, f);
    const exists = existsSync(absPath);
    results.push({ type: "file_check", file: f, passed: exists });
    if (!exists) allPassed = false;
  }

  // 2. AST-level syntax validation on listed files
  for (const f of files) {
    const absPath = resolve(workingDir, f);
    if (!existsSync(absPath)) continue;
    const ext = extname(f).toLowerCase();
    let syntaxCmd = null;

    if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      syntaxCmd = `node --check "${absPath}"`;
    } else if (ext === ".py") {
      syntaxCmd = `python3 -m py_compile "${absPath}"`;
    } else if (ext === ".ts" || ext === ".tsx") {
      syntaxCmd = `npx tsc --noEmit --allowJs --skipLibCheck "${absPath}"`;
    }

    if (syntaxCmd) {
      try {
        execSync(syntaxCmd, {
          cwd: workingDir,
          timeout: 60_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env, FORCE_COLOR: "0" },
        });
        results.push({ type: "syntax_check", file: f, passed: true });
      } catch (e) {
        allPassed = false;
        results.push({
          type: "syntax_check",
          file: f,
          passed: false,
          error: truncate(e.stderr || e.message || "", 1500),
        });
      }
    }
  }

  // 3. Cross-module API contract checks
  for (const check of contractChecks) {
    const exporterPath = resolve(workingDir, check.exporter);
    const importerPath = resolve(workingDir, check.importer);

    if (!existsSync(exporterPath) || !existsSync(importerPath)) {
      results.push({
        type: "contract_check",
        exporter: check.exporter,
        importer: check.importer,
        passed: false,
        error: "One or both files not found",
      });
      allPassed = false;
      continue;
    }

    const exporterSrc = readFileSync(exporterPath, "utf-8");
    const importerSrc = readFileSync(importerPath, "utf-8");

    // Extract exported names (JS/TS)
    const exportedNames = new Set();
    // Named exports: export function foo, export const foo, export class foo, export { foo, bar }
    const namedExportRe = /export\s+(?:function|const|let|var|class|async\s+function)\s+(\w+)/g;
    let m;
    while ((m = namedExportRe.exec(exporterSrc)) !== null) exportedNames.add(m[1]);
    // export { foo, bar, baz as qux }
    const bracketExportRe = /export\s*\{([^}]+)\}/g;
    while ((m = bracketExportRe.exec(exporterSrc)) !== null) {
      m[1].split(",").forEach((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        exportedNames.add(parts[parts.length - 1].trim());
      });
    }
    // export default
    if (/export\s+default\s/.test(exporterSrc)) exportedNames.add("default");
    // module.exports.foo = ... or exports.foo = ...
    const cjsExportRe = /(?:module\.)?exports\.(\w+)\s*=/g;
    while ((m = cjsExportRe.exec(exporterSrc)) !== null) exportedNames.add(m[1]);

    // Extract imported names from importer that reference the exporter
    const importedNames = new Set();
    const exporterBasename = check.exporter.replace(/^.*[\\/]/, "").replace(/\.\w+$/, "");
    // import { foo, bar } from './exporter'
    const importRe = new RegExp(
      `import\\s*\\{([^}]+)\\}\\s*from\\s*['"][^'"]*${escapeRegex(exporterBasename)}['"]`,
      "g"
    );
    while ((m = importRe.exec(importerSrc)) !== null) {
      m[1].split(",").forEach((s) => {
        const parts = s.trim().split(/\s+as\s+/);
        importedNames.add(parts[0].trim());
      });
    }
    // require('./exporter').foo or destructured
    const requireRe = new RegExp(
      `require\\s*\\(['"][^'"]*${escapeRegex(exporterBasename)}['"]\\)`,
      "g"
    );
    if (requireRe.test(importerSrc)) {
      // Check for .property access after require
      const propRe = new RegExp(
        `require\\s*\\(['"][^'"]*${escapeRegex(exporterBasename)}['"]\\)\\.([\\w]+)`,
        "g"
      );
      while ((m = propRe.exec(importerSrc)) !== null) importedNames.add(m[1]);
    }

    const missing = [];
    for (const name of importedNames) {
      if (name !== "default" && !exportedNames.has(name)) {
        missing.push(name);
      }
    }

    const passed = missing.length === 0;
    if (!passed) allPassed = false;

    results.push({
      type: "contract_check",
      exporter: check.exporter,
      importer: check.importer,
      passed,
      exportedNames: [...exportedNames],
      importedNames: [...importedNames],
      missing: missing.length > 0 ? missing : undefined,
    });
  }

  // 4. Run verification commands (in working dir, not server CWD)
  for (const cmd of commands) {
    try {
      const output = execSync(cmd, {
        cwd: workingDir,
        timeout: 120_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
      });
      results.push({
        type: "command",
        command: cmd,
        passed: true,
        output: truncate(output, 3000),
      });
    } catch (e) {
      allPassed = false;
      results.push({
        type: "command",
        command: cmd,
        passed: false,
        output: truncate(e.stdout || "", 1500),
        error: truncate(e.stderr || e.message || "", 1500),
        exitCode: e.status,
      });
    }
  }

  // 5. Update iteration state with validation result (keyed on runId + moduleId)
  const iter = loadIterationState(moduleId, runId);
  const total = results.length || 1;
  const score = results.filter((r) => r.passed).length / total;
  const currentIssues = results
    .filter((r) => !r.passed)
    .map((r) => r.error || r.file || r.command)
    .sort();

  // Stagnation detection — basic: same issues as last attempt
  const prevAttempt =
    iter.attempts.length > 0
      ? iter.attempts[iter.attempts.length - 1]
      : null;
  const prevIssues = prevAttempt?.issues?.sort() || [];
  const sameIssues =
    currentIssues.length > 0 &&
    JSON.stringify(currentIssues) === JSON.stringify(prevIssues);
  const scoreRegressing =
    iter.scores.length >= 2 &&
    score <= iter.scores[iter.scores.length - 1] &&
    score < 1;

  // Oscillation detection — check if current issue set matches any of the last 4 attempts
  let oscillating = false;
  if (iter.attempts.length >= 2 && currentIssues.length > 0) {
    const currentKey = JSON.stringify(currentIssues);
    const recentKeys = iter.attempts
      .slice(-4)
      .map((a) => JSON.stringify((a.issues || []).sort()));
    const matchCount = recentKeys.filter((k) => k === currentKey).length;
    // If the same issue set appeared in 2+ of last 4 attempts, it's oscillation
    if (matchCount >= 1 && !sameIssues) {
      oscillating = true;
    }
  }

  // Velocity — score improvement rate over recent attempts
  let velocity = null;
  const scores = [...iter.scores, score];
  if (scores.length >= 3) {
    const window = Math.min(scores.length, 4);
    velocity = (scores[scores.length - 1] - scores[scores.length - window]) / (window - 1);
  }

  const stagnant =
    sameIssues ||
    scoreRegressing ||
    oscillating ||
    (velocity !== null && velocity <= 0 && scores.length >= 3 && score < 1);

  // Record this attempt
  iter.scores.push(score);
  iter.attempts.push({
    timestamp: new Date().toISOString(),
    score,
    issues: currentIssues,
    stagnant,
  });
  iter.stagnant = stagnant;
  saveIterationState(moduleId, iter, runId);

  const recommendation = stagnant
    ? "ESCALATE"
    : allPassed
      ? "PASS"
      : "RETRY_WITH_DEBUGGER";

  return textResult(
    JSON.stringify(
      {
        passed: allPassed,
        score,
        results,
        stagnant,
        velocity,
        oscillating,
        attempt: iter.attempts.length,
        recommendation,
      },
      null,
      2
    )
  );
}

// ─── validate_plan ────────────────────────────────────────────────

function handleValidatePlan(args) {
  let planPath = args.planPath;

  // If no path, find most recent plan
  if (!planPath) {
    const plansDir = join(FORGE_DIR, "plans");
    if (!existsSync(plansDir)) {
      return textResult(JSON.stringify({ valid: false, errors: [{ type: "schema", message: "No plans directory found" }], warnings: [] }));
    }
    const planFiles = readdirSync(plansDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, mtime: statSync(join(plansDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (planFiles.length === 0) {
      return textResult(JSON.stringify({ valid: false, errors: [{ type: "schema", message: "No plan files found" }], warnings: [] }));
    }
    planPath = join(plansDir, planFiles[0].name);
  }

  // Resolve relative to CWD
  const absPath = resolve(CWD, planPath);
  if (!existsSync(absPath)) {
    return textResult(JSON.stringify({ valid: false, errors: [{ type: "schema", message: `Plan file not found: ${planPath}` }], warnings: [] }));
  }

  let plan;
  try {
    plan = JSON.parse(readFileSync(absPath, "utf-8"));
  } catch (e) {
    return textResult(JSON.stringify({ valid: false, errors: [{ type: "schema", message: `Invalid JSON: ${e.message}` }], warnings: [] }));
  }

  const errors = [];
  const warnings = [];
  const modules = plan.modules || [];

  // 1. Schema validation — required fields
  for (const mod of modules) {
    const missing = [];
    if (!mod.id) missing.push("id");
    if (!mod.title) missing.push("title");
    if (!mod.objective) missing.push("objective");
    if (!mod.files || mod.files.length === 0) missing.push("files");
    if (!mod.verify || mod.verify.length === 0) missing.push("verify (at least one)");
    if (!mod.doneWhen) missing.push("doneWhen");
    if (missing.length > 0) {
      errors.push({ type: "schema", message: `Module ${mod.id || "?"}: missing fields: ${missing.join(", ")}` });
    }
  }

  // 2. DAG cycle detection — topological sort via Kahn's algorithm
  const moduleIds = new Set(modules.map((m) => m.id));
  const inDegree = {};
  const adjacency = {};
  for (const mod of modules) {
    inDegree[mod.id] = 0;
    adjacency[mod.id] = [];
  }
  for (const mod of modules) {
    for (const dep of mod.dependsOn || []) {
      if (!moduleIds.has(dep)) {
        errors.push({ type: "schema", message: `Module ${mod.id}: depends on unknown module '${dep}'` });
        continue;
      }
      adjacency[dep].push(mod.id);
      inDegree[mod.id]++;
    }
  }

  const queue = Object.keys(inDegree).filter((id) => inDegree[id] === 0);
  const sorted = [];
  while (queue.length > 0) {
    const node = queue.shift();
    sorted.push(node);
    for (const neighbor of adjacency[node] || []) {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) queue.push(neighbor);
    }
  }

  if (sorted.length < modules.length) {
    const inCycle = modules.map((m) => m.id).filter((id) => !sorted.includes(id));
    errors.push({ type: "cycle", message: `Dependency cycle detected among modules: ${inCycle.join(", ")}` });
  }

  // 3. File overlap detection — warn if parallel modules share files
  for (let i = 0; i < modules.length; i++) {
    for (let j = i + 1; j < modules.length; j++) {
      const a = modules[i];
      const b = modules[j];
      // Check if a and b could run in parallel (neither depends on the other transitively)
      const aDeps = new Set(a.dependsOn || []);
      const bDeps = new Set(b.dependsOn || []);
      if (aDeps.has(b.id) || bDeps.has(a.id)) continue; // Sequential, no issue

      const aFiles = new Set(a.files || []);
      const overlap = (b.files || []).filter((f) => aFiles.has(f));
      if (overlap.length > 0) {
        warnings.push({
          type: "file_overlap",
          modules: [a.id, b.id],
          files: overlap,
          message: `Modules ${a.id} and ${b.id} both modify ${overlap.join(", ")} but could run in parallel. Consider adding a dependency edge.`,
        });
      }
    }
  }

  // 4. Verify command dry-run — check that command executables exist
  const checkedCommands = new Set();
  for (const mod of modules) {
    for (const cmd of mod.verify || []) {
      const firstWord = cmd.trim().split(/\s+/)[0];
      if (checkedCommands.has(firstWord)) continue;
      checkedCommands.add(firstWord);
      try {
        execFileSync("which", [firstWord], {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        errors.push({ type: "missing_command", message: `Command '${firstWord}' not found on PATH (used in ${mod.id} verify)` });
      }
    }
  }

  const valid = errors.length === 0;

  logEvent({
    phase: "plan_validation",
    event: "validate_plan",
    severity: valid ? "info" : "warn",
    data: { valid, errorCount: errors.length, warningCount: warnings.length },
  });

  return textResult(JSON.stringify({ valid, errors, warnings }, null, 2));
}

// ─── memory_recall ─────────────────────────────────────────────────

function handleMemoryRecall(args) {
  const scope = args.scope || "all";
  const memories = [];

  if (scope === "project" || scope === "all") {
    loadMemoryFile(join(FORGE_DIR, "memory", "project.jsonl"), "project", memories);
  }
  if (scope === "global" || scope === "all") {
    loadMemoryFile(join(FORGE_DIR, "memory", "global.jsonl"), "global", memories);
  }

  if (memories.length === 0) {
    return textResult(
      JSON.stringify({ memories: [], message: "No memories found." })
    );
  }

  // Keyword matching — split query into tokens, score by match count
  const queryTokens = args.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  const scored = memories.map((m) => {
    const text = `${m.pattern} ${m.category}`.toLowerCase();
    const matchCount = queryTokens.filter((t) => text.includes(t)).length;
    return { ...m, relevance: matchCount };
  });

  const relevant = scored
    .filter((m) => m.relevance > 0)
    .sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return (b.confidence || 0.5) - (a.confidence || 0.5);
    })
    .slice(0, 15);

  if (relevant.length === 0) {
    const fallback = memories
      .sort((a, b) => (b.confidence || 0.5) - (a.confidence || 0.5))
      .slice(0, 5);
    return textResult(
      JSON.stringify(
        {
          memories: fallback,
          message: `No keyword matches for "${args.query}". Showing top ${fallback.length} by confidence.`,
        },
        null,
        2
      )
    );
  }

  return textResult(JSON.stringify({ memories: relevant }, null, 2));
}

// ─── memory_save ───────────────────────────────────────────────────

function handleMemorySave(args) {
  const scope = args.scope || "project";
  const entry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    pattern: args.pattern,
    category: args.category,
    confidence: args.confidence ?? 0.7,
  };

  const memPath = join(FORGE_DIR, "memory", `${scope}.jsonl`);

  if (existsSync(memPath)) {
    const existing = readFileSync(memPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const patternLower = args.pattern.toLowerCase();
    const duplicate = existing.some((line) => {
      try {
        const m = JSON.parse(line);
        return (
          m.category === args.category &&
          m.pattern.toLowerCase() === patternLower
        );
      } catch {
        return false;
      }
    });
    if (duplicate) {
      return textResult(
        `Duplicate pattern already in ${scope} memory, skipped.`
      );
    }
  }

  appendFileSync(memPath, JSON.stringify(entry) + "\n");
  return textResult(
    `Saved to ${scope} memory [${args.category}]: ${args.pattern}`
  );
}

// ─── iteration_state ───────────────────────────────────────────────

function handleIterationState(args) {
  const { moduleId, action, runId } = args;

  if (runId !== undefined && !_RUN_ID_PATTERN.test(runId)) {
    return errorResult(
      `Invalid runId: ${JSON.stringify(runId)}. Must match ${_RUN_ID_PATTERN}.`
    );
  }

  if (action === "get") {
    const state = loadIterationState(moduleId, runId);
    return textResult(JSON.stringify(state, null, 2));
  }

  if (action === "reset") {
    const iterPath = _iterationPath(moduleId, runId);
    const empty = { attempts: [], scores: [], stagnant: false };
    const parent = dirname(iterPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    writeFileSync(iterPath, JSON.stringify(empty, null, 2));
    return textResult(`Reset iteration state for ${moduleId}${runId ? ` (run ${runId})` : ""}`);
  }

  if (action === "update") {
    const state = loadIterationState(moduleId, runId);
    const update = args.update || {};

    if (update.status) state.lastStatus = update.status;
    if (update.rootCause) state.lastRootCause = update.rootCause;
    if (update.score !== undefined) state.scores.push(update.score);
    if (update.issues) {
      state.attempts.push({
        timestamp: new Date().toISOString(),
        status: update.status || "unknown",
        issues: update.issues,
        score: update.score,
        rootCause: update.rootCause,
      });
    }

    saveIterationState(moduleId, state, runId);
    return textResult(
      JSON.stringify(
        { updated: true, attempt: state.attempts.length, stagnant: state.stagnant },
        null,
        2
      )
    );
  }

  return errorResult(`Unknown action: ${action}`);
}

// ─── forge_logs ───────────────────────────────────────────────────

function handleForgeLogs(args) {
  const logsDir = join(FORGE_DIR, "logs");
  if (!existsSync(logsDir)) {
    return textResult(JSON.stringify({ entries: [], message: "No logs directory found." }));
  }

  if (args.runId !== undefined && !_RUN_ID_PATTERN.test(args.runId)) {
    return errorResult(
      `Invalid runId: ${JSON.stringify(args.runId)}. Must match ${_RUN_ID_PATTERN}.`
    );
  }

  let runId = args.runId;
  if (!runId) {
    // Find most recent log file
    const logFiles = readdirSync(logsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ name: f, mtime: statSync(join(logsDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (logFiles.length === 0) {
      return textResult(JSON.stringify({ entries: [], message: "No log files found." }));
    }
    runId = logFiles[0].name.replace(".jsonl", "");
  }

  const logPath = join(logsDir, `${runId}.jsonl`);
  if (!existsSync(logPath)) {
    return textResult(JSON.stringify({ entries: [], message: `Log file not found for runId: ${runId}` }));
  }

  const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
  let entries = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  // Apply filters
  if (args.moduleId) entries = entries.filter((e) => e.moduleId === args.moduleId);
  if (args.phase) entries = entries.filter((e) => e.phase === args.phase);
  if (args.severity) entries = entries.filter((e) => e.severity === args.severity);

  // Limit
  const limit = args.limit || 50;
  entries = entries.slice(-limit);

  return textResult(JSON.stringify({ runId, entries, total: entries.length }, null, 2));
}

// ─── session_state ────────────────────────────────────────────────

function handleSessionState(args) {
  const { action } = args;
  const stateDir = join(FORGE_DIR, "state");

  if (args.runId !== undefined && !_RUN_ID_PATTERN.test(args.runId)) {
    return errorResult(
      `Invalid runId: ${JSON.stringify(args.runId)}. Must match ${_RUN_ID_PATTERN}.`
    );
  }

  if (action === "save") {
    if (!args.runId) return errorResult("runId is required for save action");
    if (!args.state) return errorResult("state is required for save action");

    const state = { ...args.state, lastUpdatedAt: new Date().toISOString() };
    const statePath = join(stateDir, `${args.runId}.json`);
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    logEvent({
      phase: "session",
      event: "session_save",
      severity: "info",
      data: { runId: args.runId, currentPhase: state.currentPhase },
    });

    return textResult(JSON.stringify({ saved: true, runId: args.runId, lastUpdatedAt: state.lastUpdatedAt }));
  }

  if (action === "load") {
    if (!args.runId) return errorResult("runId is required for load action");

    const statePath = join(stateDir, `${args.runId}.json`);
    if (!existsSync(statePath)) {
      return textResult(JSON.stringify({ found: false, runId: args.runId }));
    }

    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      logEvent({
        phase: "session",
        event: "session_load",
        severity: "info",
        data: { runId: args.runId },
      });
      return textResult(JSON.stringify({ found: true, ...state }, null, 2));
    } catch (e) {
      return errorResult(`Failed to load session state: ${e.message}`);
    }
  }

  if (action === "list") {
    if (!existsSync(stateDir)) {
      return textResult(JSON.stringify({ sessions: [] }));
    }

    const sessions = readdirSync(stateDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        try {
          const state = JSON.parse(readFileSync(join(stateDir, f), "utf-8"));
          return {
            runId: f.replace(".json", ""),
            lastUpdatedAt: state.lastUpdatedAt || null,
            currentPhase: state.currentPhase || null,
            completedCount: (state.completedModules || []).length,
            totalCount: Object.keys(state.moduleStatuses || {}).length,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => (b.lastUpdatedAt || "").localeCompare(a.lastUpdatedAt || ""));

    return textResult(JSON.stringify({ sessions }, null, 2));
  }

  return errorResult(`Unknown action: ${action}`);
}

// ─── Progress file ────────────────────────────────────────────────

function writeProgressFile() {
  if (!forgeStartedAt) forgeStartedAt = new Date().toISOString();

  const plansDir = join(FORGE_DIR, "plans");
  let plan = null;
  if (existsSync(plansDir)) {
    const planFiles = readdirSync(plansDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        name: f,
        mtime: statSync(join(plansDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    if (planFiles.length > 0) {
      try {
        plan = JSON.parse(
          readFileSync(join(plansDir, planFiles[0].name), "utf-8")
        );
      } catch (_) {}
    }
  }

  // Read currentPhase + most recent runId from latest session state.
  // The runId lets us scope the iteration scan to the current run's
  // subdirectory (v0.4.0 layout: iterations/<runId>/<moduleId>.json).
  let currentPhase = null;
  let latestRunId = null;
  const stateDir = join(FORGE_DIR, "state");
  if (existsSync(stateDir)) {
    const stateFiles = readdirSync(stateDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, mtime: statSync(join(stateDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    if (stateFiles.length > 0) {
      try {
        const latestState = JSON.parse(readFileSync(join(stateDir, stateFiles[0].name), "utf-8"));
        currentPhase = latestState.currentPhase || null;
        latestRunId = stateFiles[0].name.replace(".json", "");
      } catch (_) {}
    }
  }

  // Collect iteration state from both the legacy flat layout
  // (iterations/<moduleId>.json, pre-v0.4.0) and the per-run layout
  // (iterations/<runId>/<moduleId>.json, v0.4.0+). Per-run entries for
  // the current session take precedence over any legacy same-ID entries.
  const iterDir = join(FORGE_DIR, "iterations");
  const iterations = {};
  if (existsSync(iterDir)) {
    // 1. Legacy flat files first (lower priority).
    for (const entry of readdirSync(iterDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const id = entry.name.replace(".json", "");
        iterations[id] = JSON.parse(readFileSync(join(iterDir, entry.name), "utf-8"));
      } catch (_) {}
    }

    // 2. Per-run subdirectories. Prefer the current run when we know it,
    // otherwise take the most recently modified run directory.
    const runSubdirs = readdirSync(iterDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, mtime: statSync(join(iterDir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    let activeRun = null;
    if (latestRunId && runSubdirs.some((d) => d.name === latestRunId)) {
      activeRun = latestRunId;
    } else if (runSubdirs.length > 0) {
      activeRun = runSubdirs[0].name;
    }

    if (activeRun) {
      const runDir = join(iterDir, activeRun);
      for (const f of readdirSync(runDir).filter((f) => f.endsWith(".json"))) {
        try {
          const id = f.replace(".json", "");
          iterations[id] = JSON.parse(readFileSync(join(runDir, f), "utf-8"));
        } catch (_) {}
      }
    }
  }

  const modules = {};
  const planModules = plan?.modules || [];
  for (const m of planModules) {
    const iter = iterations[m.id];
    let status = "pending";
    if (iter) {
      if (iter.lastStatus) status = iter.lastStatus;
      else if (iter.attempts.length > 0) {
        const last = iter.attempts[iter.attempts.length - 1];
        status = last.score === 1 ? "passed" : "running";
      }
    }
    modules[m.id] = {
      title: m.title || m.id,
      status,
      attempts: iter?.attempts?.length || 0,
      score:
        iter?.scores?.length > 0 ? iter.scores[iter.scores.length - 1] : null,
    };
  }

  const completed = Object.values(modules).filter(
    (m) => m.status === "passed"
  ).length;
  const running = Object.values(modules).filter(
    (m) => m.status === "running"
  ).length;
  const failed = Object.values(modules).filter((m) =>
    ["failed", "stagnant", "escalated", "blocked"].includes(m.status)
  ).length;
  const total =
    planModules.length || Object.keys(iterations).length || 0;

  const progress = {
    timestamp: new Date().toISOString(),
    startedAt: forgeStartedAt,
    currentPhase,
    plan: plan?.objective || "unknown",
    totalModules: total,
    modules,
    completed,
    running,
    failed,
    pending: total - completed - running - failed,
  };

  writeFileSync(PROGRESS_TMP, JSON.stringify(progress, null, 2));
  renameSync(PROGRESS_TMP, PROGRESS_FILE);
}

// ─── Helpers ───────────────────────────────────────────────────────

// v0.4.0: iteration state is now keyed on (runId, moduleId) instead of just
// moduleId. Previously, state accumulated across every forge run that ever
// had a module with the same ID, so stagnation/attempt counts were global
// (we once saw "attempt 21" on a freshly-spawned m1). Passing runId scopes
// state to the current run. Backward-compatible: when runId is absent,
// empty, or whitespace-only, falls back to the legacy path so existing
// state is not orphaned.
//
// SECURITY: runId is used as a filesystem path segment. Reject anything
// that isn't a safe slug to prevent path traversal (e.g., "../../etc").
// Node's path.join normalizes traversal sequences so the naive form would
// escape FORGE_DIR. The regex below allows only [A-Za-z0-9._-] and limits
// length — matches typical plan slug conventions.
const _RUN_ID_PATTERN = /^[\w.-]{1,128}$/;

function _iterationPath(moduleId, runId) {
  const hasRunId = typeof runId === "string" && runId.trim().length > 0;
  if (hasRunId) {
    if (!_RUN_ID_PATTERN.test(runId)) {
      throw new Error(
        `Invalid runId: ${JSON.stringify(runId)}. Must match ${_RUN_ID_PATTERN} (alphanumerics, dot, dash, underscore; max 128 chars).`,
      );
    }
    return join(FORGE_DIR, "iterations", runId, `${moduleId}.json`);
  }
  return join(FORGE_DIR, "iterations", `${moduleId}.json`);
}

function loadIterationState(moduleId, runId) {
  const iterPath = _iterationPath(moduleId, runId);
  if (existsSync(iterPath)) {
    try {
      return JSON.parse(readFileSync(iterPath, "utf-8"));
    } catch {
      // Corrupted file, reset
    }
  }
  return { attempts: [], scores: [], stagnant: false };
}

function saveIterationState(moduleId, state, runId) {
  const iterPath = _iterationPath(moduleId, runId);
  // Ensure parent directory exists (especially for runId subdirs)
  const parent = dirname(iterPath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
  writeFileSync(iterPath, JSON.stringify(state, null, 2));
}

function loadMemoryFile(path, scope, target) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      target.push({ ...JSON.parse(line), scope });
    } catch {
      // Skip malformed lines
    }
  }
}

function truncate(str, maxLen) {
  if (!str) return "";
  str = str.trim();
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n... [truncated]";
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function summarizeArgs(args) {
  // Avoid logging huge payloads — summarize commands/files arrays
  const summary = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (Array.isArray(v) && v.length > 3) {
      summary[k] = `[${v.length} items]`;
    } else if (typeof v === "object" && v !== null) {
      summary[k] = "{...}";
    } else {
      summary[k] = v;
    }
  }
  return summary;
}

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(message) {
  return {
    content: [{ type: "text", text: `ERROR: ${message}` }],
    isError: true,
  };
}

// ─── Exports (for tests) ───────────────────────────────────────────

export {
  handleValidate,
  handleValidatePlan,
  handleMemoryRecall,
  handleMemorySave,
  handleIterationState,
  handleForgeLogs,
  handleSessionState,
  textResult,
  errorResult,
};

// ─── Start server ──────────────────────────────────────────────────
// Only connect stdio when run as a script (not when imported by tests).

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
