// Tests for validate_plan optional field schema (F-2 + F-3 contractor fields).
//
// Covers:
//   - Plan with all 5 new optional fields valid → passes validation
//   - Plan with NO new optional fields → still passes (back-compat — critical)
//   - acceptance_criteria not an array → fails with clear error
//   - cost_budget.max_tokens as a string → fails
//   - expected_trajectory containing non-strings → fails
//   - disallowed_changes not an array → fails
//   - success_evidence empty string → fails
//   - partial optional fields (only some present) → passes if well-formed

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP_ROOT = mkdtempSync(join(tmpdir(), "forge-validate-plan-test-"));
process.env.FORGE_CWD = TMP_ROOT;

// Import AFTER setting FORGE_CWD.
const { handleValidatePlan } = await import("../index.mjs");

function parseJsonResult(result) {
  assert.ok(result.content, "result should have content");
  assert.ok(result.content[0], "result should have content[0]");
  return JSON.parse(result.content[0].text);
}

/** Minimal valid module — required fields only, no optional fields. */
function baseModule(overrides = {}) {
  return {
    id: "m1",
    title: "Test Module",
    objective: "Do the thing",
    files: ["src/a.mjs"],
    verify: ["node --version"],
    doneWhen: "file exists",
    ...overrides,
  };
}

function writePlan(name, modules) {
  const path = join(TMP_ROOT, `${name}.json`);
  writeFileSync(path, JSON.stringify({ modules }));
  return path;
}

after(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── Back-compat: no optional fields ─────────────────────────────────

test("validate_plan: plan with NO optional fields still passes (back-compat)", () => {
  const path = writePlan("no-optional-fields", [baseModule()]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
  assert.equal(out.errors.length, 0);
});

// ─── All 5 optional fields valid ─────────────────────────────────────

test("validate_plan: plan with all 5 optional fields valid → passes", () => {
  const path = writePlan("all-optional-fields", [
    baseModule({
      acceptance_criteria: [
        { check: "tests pass", expected: "5/5 green", blocking: true },
        { check: "lint clean", expected: "exit 0", blocking: false },
      ],
      disallowed_changes: ["src/db/migrations/*", "*.lock"],
      cost_budget: { max_tokens: 50000, max_retries: 3 },
      success_evidence: "test output showing 5/5 pass",
      expected_trajectory: [
        "read src/auth.ts",
        "edit src/auth.ts to add JWT validation",
        "run npm test",
      ],
    }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
  assert.equal(out.errors.length, 0);
});

// ─── acceptance_criteria validation ─────────────────────────────────

test("validate_plan: acceptance_criteria not an array → fails with schema error", () => {
  const path = writePlan("ac-not-array", [
    baseModule({ acceptance_criteria: "should be an array" }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("acceptance_criteria")),
    `expected acceptance_criteria schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: acceptance_criteria item missing blocking field → fails", () => {
  const path = writePlan("ac-missing-blocking", [
    baseModule({
      acceptance_criteria: [
        { check: "tests pass", expected: "green" /* missing blocking */ },
      ],
    }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("blocking")),
    `expected blocking schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: acceptance_criteria with valid items → passes", () => {
  const path = writePlan("ac-valid", [
    baseModule({
      acceptance_criteria: [
        { check: "all tests pass", expected: "exit 0", blocking: true },
      ],
    }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

// ─── disallowed_changes validation ───────────────────────────────────

test("validate_plan: disallowed_changes not an array → fails", () => {
  const path = writePlan("dc-not-array", [
    baseModule({ disallowed_changes: "*.lock" }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("disallowed_changes")),
    `expected disallowed_changes schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: disallowed_changes containing non-string → fails", () => {
  const path = writePlan("dc-non-string", [
    baseModule({ disallowed_changes: ["*.lock", 42] }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("disallowed_changes")),
    `expected disallowed_changes item schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: disallowed_changes as valid string array → passes", () => {
  const path = writePlan("dc-valid", [
    baseModule({ disallowed_changes: ["src/db/migrations/*", "*.lock"] }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

// ─── cost_budget validation ───────────────────────────────────────────

test("validate_plan: cost_budget.max_tokens as a string → fails", () => {
  const path = writePlan("cb-tokens-string", [
    baseModule({ cost_budget: { max_tokens: "50000", max_retries: 3 } }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("max_tokens")),
    `expected max_tokens schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: cost_budget.max_retries as zero → fails (must be positive)", () => {
  const path = writePlan("cb-retries-zero", [
    baseModule({ cost_budget: { max_retries: 0 } }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("max_retries")),
    `expected max_retries schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: cost_budget not an object → fails", () => {
  const path = writePlan("cb-not-object", [
    baseModule({ cost_budget: 50000 }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("cost_budget")),
    `expected cost_budget schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: cost_budget with valid positive integers → passes", () => {
  const path = writePlan("cb-valid", [
    baseModule({ cost_budget: { max_tokens: 100000, max_retries: 5 } }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

test("validate_plan: cost_budget with no fields (empty object) → passes", () => {
  const path = writePlan("cb-empty", [baseModule({ cost_budget: {} })]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

// ─── success_evidence validation ─────────────────────────────────────

test("validate_plan: success_evidence empty string → fails", () => {
  const path = writePlan("se-empty", [baseModule({ success_evidence: "" })]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("success_evidence")),
    `expected success_evidence schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: success_evidence whitespace-only string → fails", () => {
  const path = writePlan("se-whitespace", [baseModule({ success_evidence: "   " })]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("success_evidence")),
    `expected success_evidence schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: success_evidence non-empty string → passes", () => {
  const path = writePlan("se-valid", [
    baseModule({ success_evidence: "test output showing 5/5 pass" }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

// ─── expected_trajectory validation ──────────────────────────────────

test("validate_plan: expected_trajectory not an array → fails", () => {
  const path = writePlan("et-not-array", [
    baseModule({ expected_trajectory: "read the file" }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("expected_trajectory")),
    `expected expected_trajectory schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: expected_trajectory containing non-strings → fails", () => {
  const path = writePlan("et-non-strings", [
    baseModule({ expected_trajectory: ["read file", 42, true] }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, false);
  assert.ok(
    out.errors.some((e) => e.type === "schema" && e.message.includes("expected_trajectory")),
    `expected expected_trajectory item schema error, got: ${JSON.stringify(out.errors)}`
  );
});

test("validate_plan: expected_trajectory as valid string array → passes", () => {
  const path = writePlan("et-valid", [
    baseModule({
      expected_trajectory: ["read src/auth.ts", "edit src/auth.ts", "run npm test"],
    }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

// ─── Partial optional fields ──────────────────────────────────────────

test("validate_plan: only acceptance_criteria present, rest absent → passes", () => {
  const path = writePlan("partial-ac-only", [
    baseModule({
      acceptance_criteria: [{ check: "x", expected: "y", blocking: true }],
    }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});

test("validate_plan: only expected_trajectory present, rest absent → passes", () => {
  const path = writePlan("partial-et-only", [
    baseModule({ expected_trajectory: ["step one", "step two"] }),
  ]);
  const out = parseJsonResult(handleValidatePlan({ planPath: path }));
  assert.equal(out.valid, true, `expected valid=true, got errors=${JSON.stringify(out.errors)}`);
});
