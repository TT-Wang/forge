// Integration tests for forge-mcp-server handlers.
//
// The server module reads FORGE_CWD at import time and initializes the
// `.forge/` directory there. These tests set FORGE_CWD to a fresh tmp
// directory *before* importing the module so each test run gets an
// isolated workspace.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "forge-test-"));
process.env.FORGE_CWD = TMP_ROOT;

// Import AFTER setting FORGE_CWD.
const mcp = await import("../index.mjs");
const {
  handleValidate,
  handleValidatePlan,
  handleMemorySave,
  handleMemoryRecall,
  handleIterationState,
  handleSessionState,
  handleForgeLogs,
} = mcp;

function parseResult(result) {
  // Server returns { content: [{ type: "text", text: "..." }] }
  assert.ok(result.content, "result should have content");
  assert.ok(result.content[0], "result should have content[0]");
  return result.content[0].text;
}

function parseJsonResult(result) {
  return JSON.parse(parseResult(result));
}

after(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── validate_plan ─────────────────────────────────────────────────

test("validate_plan accepts a well-formed single-module plan", () => {
  const plan = {
    modules: [
      {
        id: "m1",
        title: "Example",
        objective: "Do the thing",
        files: ["src/a.mjs"],
        verify: ["node --version"],
        doneWhen: "file exists",
      },
    ],
  };
  const path = join(TMP_ROOT, "plan-ok.json");
  writeFileSync(path, JSON.stringify(plan));

  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
  assert.equal(out.errors.length, 0);
});

test("validate_plan rejects plans missing required fields", () => {
  const plan = { modules: [{ id: "m1", title: "missing stuff" }] };
  const path = join(TMP_ROOT, "plan-missing.json");
  writeFileSync(path, JSON.stringify(plan));

  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(out.errors.some((e) => e.type === "schema"));
});

test("validate_plan detects dependency cycles", () => {
  const plan = {
    modules: [
      {
        id: "a",
        title: "A",
        objective: "a",
        files: ["a.mjs"],
        verify: ["node --version"],
        doneWhen: "x",
        dependsOn: ["b"],
      },
      {
        id: "b",
        title: "B",
        objective: "b",
        files: ["b.mjs"],
        verify: ["node --version"],
        doneWhen: "x",
        dependsOn: ["a"],
      },
    ],
  };
  const path = join(TMP_ROOT, "plan-cycle.json");
  writeFileSync(path, JSON.stringify(plan));

  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(out.errors.some((e) => e.type === "cycle"), "expected cycle error");
});

test("validate_plan warns on file overlap between parallel modules", () => {
  const plan = {
    modules: [
      {
        id: "p1",
        title: "P1",
        objective: "p1",
        files: ["shared.mjs"],
        verify: ["node --version"],
        doneWhen: "x",
      },
      {
        id: "p2",
        title: "P2",
        objective: "p2",
        files: ["shared.mjs"],
        verify: ["node --version"],
        doneWhen: "x",
      },
    ],
  };
  const path = join(TMP_ROOT, "plan-overlap.json");
  writeFileSync(path, JSON.stringify(plan));

  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.ok(out.warnings.some((w) => w.type === "file_overlap"));
});

test("validate_plan flags missing verify commands", () => {
  const plan = {
    modules: [
      {
        id: "m1",
        title: "bad cmd",
        objective: "x",
        files: ["a.mjs"],
        verify: ["definitely-not-a-real-binary-xyz-12345"],
        doneWhen: "x",
      },
    ],
  };
  const path = join(TMP_ROOT, "plan-badcmd.json");
  writeFileSync(path, JSON.stringify(plan));

  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(out.errors.some((e) => e.type === "missing_command"));
});

test("validate_plan returns structured error for nonexistent plan file", () => {
  const out = parseJsonResult(handleValidatePlan({ planPath: "/no/such/plan.json" }));
  assert.equal(out.valid, false);
  assert.ok(out.errors.length > 0);
});

// ─── memory_save / memory_recall ───────────────────────────────────

test("memory_save persists an entry and memory_recall finds it", () => {
  const save = handleMemorySave({
    scope: "project",
    pattern: "Always atomic-write .forge/state files",
    category: "convention",
    confidence: 0.9,
  });
  assert.match(parseResult(save), /Saved/);

  const recall = parseResult(
    handleMemoryRecall({ query: "atomic-write", scope: "project" })
  );
  assert.match(recall, /atomic-write/);
});

test("memory_save dedupes identical patterns", () => {
  handleMemorySave({
    scope: "project",
    pattern: "Run pre-commit before push",
    category: "convention",
  });
  const second = parseResult(
    handleMemorySave({
      scope: "project",
      pattern: "Run pre-commit before push",
      category: "convention",
    })
  );
  assert.match(second, /[Dd]uplicate/);
});

// ─── iteration_state — per-run scoping (v0.4.0 regression test) ────

test("iteration_state is scoped per-run so counts don't leak across plans", () => {
  // Run A: bump attempt count for m1
  handleIterationState({
    moduleId: "m1",
    action: "update",
    runId: "2026-04-14-1",
    update: { status: "failed", score: 20, issues: ["boom"] },
  });
  handleIterationState({
    moduleId: "m1",
    action: "update",
    runId: "2026-04-14-1",
    update: { status: "failed", score: 25, issues: ["boom again"] },
  });

  // Run B (different runId, same moduleId) — should start at 0
  const runBGet = parseJsonResult(
    handleIterationState({ moduleId: "m1", action: "get", runId: "2026-04-14-2" })
  );
  assert.equal(
    (runBGet.attempts || []).length,
    0,
    "new run should not inherit attempts from prior run with same moduleId"
  );

  // Run A should still have 2 attempts
  const runAGet = parseJsonResult(
    handleIterationState({ moduleId: "m1", action: "get", runId: "2026-04-14-1" })
  );
  assert.equal(runAGet.attempts.length, 2);
});

test("iteration_state reset clears the state file", () => {
  handleIterationState({
    moduleId: "m2",
    action: "update",
    runId: "2026-04-14-3",
    update: { status: "failed", score: 10, issues: ["x"] },
  });
  handleIterationState({
    moduleId: "m2",
    action: "reset",
    runId: "2026-04-14-3",
  });
  const after = parseJsonResult(
    handleIterationState({ moduleId: "m2", action: "get", runId: "2026-04-14-3" })
  );
  assert.equal((after.attempts || []).length, 0);
});

// ─── session_state ─────────────────────────────────────────────────

test("session_state save/load/list roundtrip", () => {
  const runId = "session-test-run-1";
  const state = {
    currentPhase: "execute",
    completedModules: ["m1"],
    moduleStatuses: { m1: "done", m2: "pending" },
  };

  const saved = parseJsonResult(
    handleSessionState({ action: "save", runId, state })
  );
  assert.equal(saved.saved, true);
  assert.equal(saved.runId, runId);

  const loaded = parseJsonResult(handleSessionState({ action: "load", runId }));
  assert.equal(loaded.found, true);
  assert.equal(loaded.currentPhase, "execute");
  assert.deepEqual(loaded.completedModules, ["m1"]);

  const list = parseJsonResult(handleSessionState({ action: "list" }));
  assert.ok(list.sessions.some((s) => s.runId === runId));
});

test("session_state load returns found=false for unknown run", () => {
  const out = parseJsonResult(
    handleSessionState({ action: "load", runId: "does-not-exist" })
  );
  assert.equal(out.found, false);
});

test("session_state save requires runId and state", () => {
  const noRun = handleSessionState({ action: "save" });
  assert.equal(noRun.isError, true);
  const noState = handleSessionState({ action: "save", runId: "x" });
  assert.equal(noState.isError, true);
});

// ─── forge_logs ────────────────────────────────────────────────────

test("forge_logs returns entries after events have been logged", () => {
  // Trigger some log writes via earlier tool calls — validate_plan logs a
  // plan_validation event, so exercise it here to be sure we have entries.
  const plan = {
    modules: [
      {
        id: "log-test",
        title: "t",
        objective: "o",
        files: ["x.mjs"],
        verify: ["node --version"],
        doneWhen: "x",
      },
    ],
  };
  const path = join(TMP_ROOT, "plan-for-logs.json");
  writeFileSync(path, JSON.stringify(plan));
  handleValidatePlan({ planPath: path });

  const out = parseResult(handleForgeLogs({ limit: 50 }));
  assert.match(out, /plan_validation|validate_plan/);
});

// ─── validate (happy path + cwd escalation) ───────────────────────

test("validate happy path: real file + passing command returns passed", () => {
  const srcDir = join(TMP_ROOT, "validate-happy");
  mkdirSync(srcDir, { recursive: true });
  const realFile = join(srcDir, "hello.mjs");
  writeFileSync(realFile, "export const hello = () => 'world';\n");

  const out = parseJsonResult(
    handleValidate({
      moduleId: "validate-happy",
      files: [realFile],
      commands: ["node --version"],
      runId: "test-validate-happy",
    })
  );

  assert.equal(out.passed, true, `expected passed=true, got results=${JSON.stringify(out.results)}`);
  assert.ok(out.results.some((r) => r.type === "file_check" && r.passed));
  assert.ok(out.results.some((r) => r.type === "command" && r.passed));
});

test("validate: nonexistent cwd returns recommendation ESCALATE", () => {
  const out = parseJsonResult(
    handleValidate({
      moduleId: "validate-bad-cwd",
      files: [],
      commands: ["node --version"],
      cwd: "/definitely/not/a/real/path/forge-xyz-12345",
      runId: "test-validate-bad-cwd",
    })
  );

  assert.equal(out.passed, false);
  assert.equal(out.recommendation, "ESCALATE");
  assert.ok(out.results.some((r) => r.type === "cwd_check" && r.passed === false));
});

test("validate: missing file flagged as file_check failure", () => {
  const out = parseJsonResult(
    handleValidate({
      moduleId: "validate-missing-file",
      files: [join(TMP_ROOT, "does-not-exist.mjs")],
      commands: ["node --version"],
      runId: "test-validate-missing-file",
    })
  );

  assert.equal(out.passed, false);
  assert.ok(
    out.results.some((r) => r.type === "file_check" && r.passed === false),
    "expected a failing file_check result"
  );
});

// ─── P0 regression: runId path-traversal guards ────────────────────

test("session_state rejects runId with traversal characters", () => {
  const out = handleSessionState({
    action: "save",
    runId: "../../etc/passwd",
    state: { currentPhase: "x" },
  });
  assert.equal(out.isError, true);
});

test("forge_logs rejects runId with traversal characters", () => {
  const out = handleForgeLogs({ runId: "../../etc/passwd" });
  assert.equal(out.isError, true);
});

test("iteration_state rejects runId with traversal characters", () => {
  const out = handleIterationState({
    moduleId: "m1",
    action: "get",
    runId: "../../etc/passwd",
  });
  assert.equal(out.isError, true);
});

// ─── smoke: .forge directory created at import time ───────────────

test("import-time bootstrap creates all .forge subdirectories", () => {
  for (const sub of ["plans", "memory", "iterations", "logs", "state"]) {
    assert.ok(
      existsSync(join(TMP_ROOT, ".forge", sub)),
      `.forge/${sub} should exist`
    );
  }
});
