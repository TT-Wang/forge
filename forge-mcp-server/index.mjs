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
import { execSync } from "child_process";
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
import { join, resolve, extname } from "path";

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

function initRunLog(runId) {
  currentRunId = runId;
  const logsDir = join(FORGE_DIR, "logs");
  mkdirSync(logsDir, { recursive: true });
}

// ─── Ensure directories ──────────────────────────────────────────

for (const dir of ["plans", "memory", "iterations", "logs", "state"]) {
  mkdirSync(join(FORGE_DIR, dir), { recursive: true });
}

const server = new Server(
  { name: "forge", version: "0.2.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "validate",
      description:
        "Run verification commands, file-existence checks, syntax validation, and cross-module API contract checks for a forge module. Returns structured pass/fail with stagnation detection, velocity, and oscillation analysis.",
      inputSchema: {
        type: "object",
        properties: {
          moduleId: {
            type: "string",
            description: "Module ID (e.g. m1, m2)",
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
              "File paths (relative to project root) that should exist after module completion",
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
      description:
        "Validate a forge plan for structural correctness: DAG cycle detection, file overlap warnings, command existence checks, and schema validation.",
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
      description:
        "Search project and global memory for patterns relevant to a query. Returns matching learnings sorted by confidence.",
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
      description:
        "Save a learned pattern to project or global memory for future recall.",
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
              "test_command",
              "architecture",
              "dependency",
              "tool_usage",
            ],
            description: "Category of the learning",
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
      description:
        "Get or update the retry/iteration state for a module. Tracks attempts, scores, and stagnation.",
      inputSchema: {
        type: "object",
        properties: {
          moduleId: {
            type: "string",
            description: "Module ID (e.g. m1)",
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
      description:
        "Query structured logs from forge runs. Filter by runId, moduleId, phase, or severity.",
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
      description:
        "Save, load, or list orchestrator session state for resumability. Persists progress across crashes or conversation restarts.",
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
  const { moduleId, commands = [], files = [], contractChecks = [] } = args;
  const results = [];
  let allPassed = true;

  // 1. Check files exist
  for (const f of files) {
    const absPath = resolve(CWD, f);
    const exists = existsSync(absPath);
    results.push({ type: "file_check", file: f, passed: exists });
    if (!exists) allPassed = false;
  }

  // 2. AST-level syntax validation on listed files
  for (const f of files) {
    const absPath = resolve(CWD, f);
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
          cwd: CWD,
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
    const exporterPath = resolve(CWD, check.exporter);
    const importerPath = resolve(CWD, check.importer);

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

  // 4. Run verification commands
  for (const cmd of commands) {
    try {
      const output = execSync(cmd, {
        cwd: CWD,
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

  // 5. Update iteration state with validation result
  const iter = loadIterationState(moduleId);
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
  saveIterationState(moduleId, iter);

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
        execSync(`which ${firstWord}`, { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
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
  const { moduleId, action } = args;

  if (action === "get") {
    const state = loadIterationState(moduleId);
    return textResult(JSON.stringify(state, null, 2));
  }

  if (action === "reset") {
    const iterPath = join(FORGE_DIR, "iterations", `${moduleId}.json`);
    const empty = { attempts: [], scores: [], stagnant: false };
    writeFileSync(iterPath, JSON.stringify(empty, null, 2));
    return textResult(`Reset iteration state for ${moduleId}`);
  }

  if (action === "update") {
    const state = loadIterationState(moduleId);
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

    saveIterationState(moduleId, state);
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

  const iterDir = join(FORGE_DIR, "iterations");
  const iterations = {};
  if (existsSync(iterDir)) {
    for (const f of readdirSync(iterDir).filter((f) => f.endsWith(".json"))) {
      try {
        const id = f.replace(".json", "");
        iterations[id] = JSON.parse(readFileSync(join(iterDir, f), "utf-8"));
      } catch (_) {}
    }
  }

  // Try to read currentPhase from latest session state
  let currentPhase = null;
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
      } catch (_) {}
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

function loadIterationState(moduleId) {
  const iterPath = join(FORGE_DIR, "iterations", `${moduleId}.json`);
  if (existsSync(iterPath)) {
    try {
      return JSON.parse(readFileSync(iterPath, "utf-8"));
    } catch {
      // Corrupted file, reset
    }
  }
  return { attempts: [], scores: [], stagnant: false };
}

function saveIterationState(moduleId, state) {
  const iterPath = join(FORGE_DIR, "iterations", `${moduleId}.json`);
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

// ─── Start server ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
