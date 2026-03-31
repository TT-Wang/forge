#!/usr/bin/env node

// forge MCP server
// Provides: validate, memory_recall, memory_save, iteration_state
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
import { join, resolve } from "path";

const CWD = resolve(process.env.FORGE_CWD || process.cwd());
const FORGE_DIR = join(CWD, ".forge");
const PROGRESS_FILE = "/tmp/forge-status.json";
const PROGRESS_TMP = "/tmp/forge-status.tmp";
let forgeStartedAt = null;

// Ensure directories
for (const dir of ["plans", "memory", "iterations"]) {
  mkdirSync(join(FORGE_DIR, dir), { recursive: true });
}

const server = new Server(
  { name: "forge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

// ─── Tool definitions ──────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "validate",
      description:
        "Run verification commands and file-existence checks for a forge module. Returns structured pass/fail with stagnation detection.",
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
        },
        required: ["moduleId", "commands"],
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
  ],
}));

// ─── Tool implementations ──────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case "validate":
        result = handleValidate(args);
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
      default:
        return errorResult(`Unknown tool: ${name}`);
    }
    try { writeProgressFile(); } catch (_) {}
    return result;
  } catch (err) {
    return errorResult(`Tool ${name} failed: ${err.message}`);
  }
});

// ─── validate ──────────────────────────────────────────────────────

function handleValidate(args) {
  const { moduleId, commands = [], files = [] } = args;
  const results = [];
  let allPassed = true;

  // Check files exist
  for (const f of files) {
    const absPath = resolve(CWD, f);
    const exists = existsSync(absPath);
    results.push({ type: "file_check", file: f, passed: exists });
    if (!exists) allPassed = false;
  }

  // Run verification commands
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

  // Update iteration state with validation result
  const iter = loadIterationState(moduleId);
  const total = results.length || 1;
  const score = results.filter((r) => r.passed).length / total;
  const currentIssues = results
    .filter((r) => !r.passed)
    .map((r) => r.error || r.file || r.command)
    .sort();

  // Stagnation detection
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

  const stagnant = sameIssues || scoreRegressing;

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
        attempt: iter.attempts.length,
        recommendation,
      },
      null,
      2
    )
  );
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
      // Sort by relevance first, then confidence
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return (b.confidence || 0.5) - (a.confidence || 0.5);
    })
    .slice(0, 15);

  // If no keyword matches, return recent high-confidence entries
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

  // Dedup: check if a very similar pattern already exists
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

// ─── Progress file ────────────────────────────────────────────────

function writeProgressFile() {
  if (!forgeStartedAt) forgeStartedAt = new Date().toISOString();

  // Read latest plan
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
        plan = JSON.parse(readFileSync(join(plansDir, planFiles[0].name), "utf-8"));
      } catch (_) {}
    }
  }

  // Read iteration states
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

  // Build module status map
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
      score: iter?.scores?.length > 0 ? iter.scores[iter.scores.length - 1] : null,
    };
  }

  const completed = Object.values(modules).filter((m) => m.status === "passed").length;
  const running = Object.values(modules).filter((m) => m.status === "running").length;
  const failed = Object.values(modules).filter((m) =>
    ["failed", "stagnant", "escalated", "blocked"].includes(m.status)
  ).length;
  const total = planModules.length || Object.keys(iterations).length || 0;

  const progress = {
    timestamp: new Date().toISOString(),
    startedAt: forgeStartedAt,
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

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: `ERROR: ${message}` }], isError: true };
}

// ─── Start server ──────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
