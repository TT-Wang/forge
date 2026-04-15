# Security Policy

## Supported versions

The latest minor release on `main` is the only actively supported version.
Older versions do not receive security fixes.

## Reporting a vulnerability

Please report security issues **privately** via GitHub Security Advisories:

> https://github.com/TT-Wang/forge/security/advisories/new

Do **not** open a public issue for security reports — doing so may expose
other forge users before a fix is available.

When reporting, include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a minimal proof-of-concept
- The affected forge version (check `.claude-plugin/plugin.json`)
- Your environment (OS, Node.js version, plugin install method)

I will acknowledge the report within 72 hours and aim to publish a fix and
advisory within 14 days of validation, depending on severity.

## Scope

In scope for security reports:

- Command injection in `validate` tool's user-supplied verification commands
- Path traversal in `.forge/` state reads/writes (plans, iterations, logs, memory)
- Worktree escape — a worker executing code outside its assigned worktree
- Arbitrary file read/write via `session_state`, `forge_logs`, or `memory_save`
- Unsanitized log output that enables prompt injection into agents
- Cross-run state leakage that allows one forge run to corrupt another's state

Out of scope (not a security issue):

- `validate` executing commands that the running user can already execute —
  the tool is a deliberate shell by design, gated on the user's trust in the
  plan before execution
- A malformed plan causing a forge run to ESCALATE (documented behavior)
- Missing authentication on the stdio MCP server (stdio-only, no network
  surface by design)

## Defence-in-depth features already in place

- The MCP server is stdio-only — no network ports are opened.
- `validate_plan` rejects DAG cycles, overlapping worktree file claims, and
  missing verification commands before any worker runs.
- Iteration state is scoped per-run (`iterations/<runId>/<moduleId>.json`)
  so a stuck attempt counter can't leak into a fresh plan.
- The validator's `cwd` parameter is resolved against the calling worker's
  worktree — workers can't silently validate against the main project root.
- `.forge/` state writes use atomic rename (`tmp + rename`) to prevent
  partial-write corruption on crash.
- No credentials, API keys, or tokens are stored by forge itself. Worker
  agents use the user's existing Claude Code session.

Thanks for helping keep forge users safe.
