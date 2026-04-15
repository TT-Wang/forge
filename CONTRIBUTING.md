# Contributing to forge

Thanks for your interest in contributing!

## Dev setup

```bash
git clone https://github.com/TT-Wang/forge.git
cd forge/forge-mcp-server
npm install
```

Forge is pure Node.js (ESM) with zero build step — `index.mjs` is the entry
point and runs directly.

## Running tests

```bash
cd forge-mcp-server
npm test                        # run all tests (node --test)
npm run test:watch              # watch mode
node --test tests/validate.test.mjs   # single file
```

## Code style

- `eslint` for linting (flat config, ESM)
- `prettier` for formatting

```bash
cd forge-mcp-server
npm run lint
npm run format
```

## PR process

1. Fork the repo
2. Create a branch: `git checkout -b feat/my-feature`
3. Make changes, add tests
4. Run `npm run lint && npm test`
5. Commit with a clear message
6. Push and open a PR against `master`

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or updating tests
- `chore:` maintenance

Example: `feat: scope iteration state per-run`

## Architecture notes

Forge has four moving parts:

1. **Orchestrator skill** (`skills/forge/`) — the top-level `/forge` workflow
   that coordinates planning, execution, validation, and retry
2. **Agents** (`agents/`) — planner, worker, reviewer, debugger
3. **MCP server** (`forge-mcp-server/`) — 7 tools the orchestrator and agents
   call to validate plans, run verification commands, track iteration state,
   query logs, and persist memory
4. **`.forge/`** (runtime) — per-project state: plans, iterations, logs,
   session snapshots, memory

Key files:

- `forge-mcp-server/index.mjs` — MCP server entry, all 7 tool handlers
- `skills/forge/SKILL.md` — top-level orchestration prompt
- `agents/*.md` — agent system prompts
- `.claude-plugin/plugin.json` — Claude Code plugin manifest

Do NOT touch:

- The validator's `cwd` resolution logic without re-reading
  CHANGELOG v0.4.0 — it's the fix for the worktree-clobber trust bug
- Iteration state file layout (`iterations/<runId>/<moduleId>.json`) —
  changes here break resumability
- Plugin manifest schema — coordinate with the Claude Code plugin spec

## Questions?

Open an issue or start a discussion on GitHub.
