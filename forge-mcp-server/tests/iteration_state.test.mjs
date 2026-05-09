// Tests for iteration_state handler — overseer compatibility (m3 F-4).
//
// The overseer agent (agents/overseer.md) reads iteration_state to detect
// stuck/looping patterns before the debugger is spawned. These tests verify:
//
//   1. The existing iteration_state API is sufficient for overseer use:
//      - attempts[] contains {timestamp, status, issues, score, rootCause}
//      - stagnant boolean is present
//      - scores[] is present
//   2. No summary field was added (API unchanged — existing callers unaffected)
//   3. Existing callers that read attempts.length, stagnant, scores still work
//
// NOTE: No `summary` field was added to index.mjs because the overseer can
// derive all loop-detection patterns from:
//   - iteration_state: attempts[].issues and stagnant (retry history)
//   - forge_logs: full tool-call sequence (Edit/Read call patterns)
// Adding a redundant summary field would duplicate information already
// available in forge_logs and impose maintenance cost. The conformance rule
// in m3 says: "If existing API is sufficient, DO NOT add a redundant summary
// field; just document what overseer reads." This test file documents that.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "forge-iter-state-test-"));
process.env.FORGE_CWD = TMP_ROOT;

// Import AFTER setting FORGE_CWD.
const { handleIterationState } = await import("../index.mjs");

function parseJsonResult(result) {
  assert.ok(result.content, "result should have content");
  assert.ok(result.content[0], "result should have content[0]");
  return JSON.parse(result.content[0].text);
}

after(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── API shape: overseer reads these fields ───────────────────────────

test("iteration_state get returns required overseer fields: attempts, scores, stagnant", () => {
  // Fresh state — no prior updates
  const out = parseJsonResult(
    handleIterationState({ moduleId: "m-overseer-shape", action: "get", runId: "run-shape-test" })
  );

  // All three fields the overseer depends on must be present
  assert.ok(Object.prototype.hasOwnProperty.call(out, "attempts"), "missing 'attempts' field");
  assert.ok(Object.prototype.hasOwnProperty.call(out, "scores"), "missing 'scores' field");
  assert.ok(Object.prototype.hasOwnProperty.call(out, "stagnant"), "missing 'stagnant' field");

  // Correct types
  assert.ok(Array.isArray(out.attempts), "attempts should be an array");
  assert.ok(Array.isArray(out.scores), "scores should be an array");
  assert.equal(typeof out.stagnant, "boolean", "stagnant should be a boolean");
});

test("iteration_state attempts contain overseer-readable sub-fields after update", () => {
  const runId = "run-overseer-fields";
  const moduleId = "m-overseer-fields";

  // Record a failed attempt (the kind the overseer will analyze)
  handleIterationState({
    moduleId,
    action: "update",
    runId,
    update: {
      status: "failed",
      score: 30,
      issues: ["Edit same file 4 times with no progress", "verify command still fails"],
      rootCause: "Worker looping on src/index.mjs without reading dependencies",
    },
  });

  const out = parseJsonResult(
    handleIterationState({ moduleId, action: "get", runId })
  );

  assert.equal(out.attempts.length, 1, "expected 1 attempt recorded");
  const attempt = out.attempts[0];

  // The overseer reads these fields to classify stuck/missing_context/blocked
  assert.ok(attempt.timestamp, "attempt should have timestamp");
  assert.equal(attempt.status, "failed");
  assert.deepEqual(attempt.issues, [
    "Edit same file 4 times with no progress",
    "verify command still fails",
  ]);
  assert.equal(attempt.rootCause, "Worker looping on src/index.mjs without reading dependencies");
  assert.equal(attempt.score, 30);

  // scores[] is also readable (overseer uses it to check for score plateau)
  assert.deepEqual(out.scores, [30]);
});

test("iteration_state no summary field added — existing API is unchanged", () => {
  // Verify the API did NOT grow a 'summary' field (conformance rule: don't
  // add redundant fields; overseer uses forge_logs for tool-call patterns).
  const out = parseJsonResult(
    handleIterationState({ moduleId: "m-no-summary", action: "get", runId: "run-no-summary" })
  );

  assert.ok(
    !Object.prototype.hasOwnProperty.call(out, "summary"),
    "iteration_state must NOT have a 'summary' field — overseer reads forge_logs for tool-call patterns instead"
  );
});

// ─── Stagnation detection — overseer reads stagnant flag ─────────────

test("iteration_state stagnant=false on fresh state", () => {
  const out = parseJsonResult(
    handleIterationState({ moduleId: "m-stagnant-check", action: "get", runId: "run-stagnant-1" })
  );
  assert.equal(out.stagnant, false, "fresh state should not be stagnant");
});

test("iteration_state multiple attempts with same issues are detectable by overseer", () => {
  const runId = "run-multi-attempt";
  const moduleId = "m-multi-attempt";
  const repeatedIssue = "Cannot find module './helper' — same error each attempt";

  // Simulate 3 failed attempts with the same root cause (stuck pattern)
  for (let i = 1; i <= 3; i++) {
    handleIterationState({
      moduleId,
      action: "update",
      runId,
      update: {
        status: "failed",
        score: 20,
        issues: [repeatedIssue],
        rootCause: "Worker never read the correct file path",
      },
    });
  }

  const out = parseJsonResult(
    handleIterationState({ moduleId, action: "get", runId })
  );

  // Overseer can count attempts and check for repeated issues
  assert.equal(out.attempts.length, 3, "expected 3 attempts");

  // All three have the same issue — overseer classifies this as 'stuck'
  const allSameIssue = out.attempts.every(
    (a) => a.issues && a.issues[0] === repeatedIssue
  );
  assert.ok(allSameIssue, "all attempts should have the same repeated issue for stuck classification");

  // scores[] allows overseer to detect plateau (no improvement)
  assert.deepEqual(out.scores, [20, 20, 20], "flat scores indicate no progress");
});

// ─── Existing callers still work — backward compatibility ────────────

test("existing callers reading attempts.length still work", () => {
  const runId = "run-compat-1";
  const moduleId = "m-compat-1";

  handleIterationState({
    moduleId,
    action: "update",
    runId,
    update: { status: "failed", score: 50, issues: ["x"] },
  });

  const out = parseJsonResult(
    handleIterationState({ moduleId, action: "get", runId })
  );

  // Existing code pattern: check attempts.length to gate retry logic
  assert.ok(out.attempts.length >= 1, "existing callers can read attempts.length");
});

test("existing callers reading stagnant flag still work", () => {
  const out = parseJsonResult(
    handleIterationState({ moduleId: "m-compat-stagnant", action: "get", runId: "run-compat-2" })
  );
  // Existing code pattern: if (state.stagnant) escalate
  assert.equal(typeof out.stagnant, "boolean", "existing callers can read stagnant as boolean");
});

test("existing callers reading scores[] still work", () => {
  const runId = "run-compat-3";
  const moduleId = "m-compat-scores";

  handleIterationState({
    moduleId,
    action: "update",
    runId,
    update: { status: "done", score: 1.0, issues: [] },
  });

  const out = parseJsonResult(
    handleIterationState({ moduleId, action: "get", runId })
  );

  // Existing code pattern: state.scores to compute trend
  assert.ok(Array.isArray(out.scores), "existing callers can read scores as array");
  assert.ok(out.scores.includes(1.0), "score recorded correctly");
});

test("iteration_state reset still works (backward compat)", () => {
  const runId = "run-reset-compat";
  const moduleId = "m-reset-compat";

  handleIterationState({
    moduleId,
    action: "update",
    runId,
    update: { status: "failed", score: 10, issues: ["y"] },
  });

  handleIterationState({ moduleId, action: "reset", runId });

  const out = parseJsonResult(
    handleIterationState({ moduleId, action: "get", runId })
  );

  assert.equal(out.attempts.length, 0, "reset should clear attempts");
  assert.equal(out.stagnant, false, "reset should clear stagnant");
});
