# Forge MCP Tools Reference

The forge MCP server exposes 7 tools over stdio. All state is read from
`.forge/` under `FORGE_CWD` (or `process.cwd()` if unset).

## `validate`

Run verification commands against a module. Checks file existence, runs
syntax checks, executes `verify[]` commands, and analyses stagnation /
velocity / oscillation across retry attempts.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `moduleId` | string | Module ID from the plan |
| `files` | string[] | Files the module should have touched |
| `verify` | string[] | Verification commands to run |
| `cwd` | string? | Override working directory (e.g. a worker's worktree) |
| `runId` | string? | Scope iteration state to a specific run |

**Returns** — JSON with `pass`, `checks[]`, `attempt`, `stagnant`,
`recommendation` (`PROCEED`, `RETRY`, `ESCALATE`).

## `validate_plan`

Structurally validate a plan JSON file before execution.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `planPath` | string? | Path to plan JSON (default: most recent in `.forge/plans/`) |

**Returns** — JSON with `valid`, `errors[]`, `warnings[]`.

Checks performed:

- Schema: every module must have `id`, `title`, `objective`, `files`,
  `verify`, `doneWhen`
- DAG cycles via Kahn's algorithm
- Unknown `dependsOn` targets
- File overlap between modules that could run in parallel (warning)
- Verify command executables exist on PATH

## `memory_recall`

Search project and/or global memory for learned patterns.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | Text to search for |
| `scope` | `"project"` \| `"global"` \| `"all"` | Which memory stores to read |

**Returns** — text summary of matching entries.

## `memory_save`

Persist a learned pattern. Dedupes on `(category, pattern)`.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `pattern` | string | The learned pattern text |
| `category` | string | E.g. `convention`, `failure`, `contract` |
| `scope` | `"project"` \| `"global"` | Where to store (default `"project"`) |
| `confidence` | number? | 0.0–1.0 (default 0.7) |

**Returns** — confirmation or "duplicate skipped" message.

## `iteration_state`

Track per-module retry state, scoped per `runId`.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `moduleId` | string | Module ID |
| `action` | `"get"` \| `"update"` \| `"reset"` | Operation |
| `runId` | string? | Scope to a specific run |
| `update` | object? | For `update`: `{status, score, issues, rootCause}` |

**Returns** — JSON state or confirmation.

## `forge_logs`

Query the structured JSONL log stream.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `runId` | string? | Filter by run |
| `moduleId` | string? | Filter by module |
| `phase` | string? | Filter by phase (`planning`, `execution`, `validation`, etc.) |
| `severity` | string? | `info` \| `warn` \| `error` |
| `limit` | number? | Max entries (default 100) |

**Returns** — text with matching log lines.

## `session_state`

Save, load, or list orchestrator session snapshots for resumability.

**Arguments**

| Field | Type | Description |
|-------|------|-------------|
| `action` | `"save"` \| `"load"` \| `"list"` | Operation |
| `runId` | string | Required for `save` and `load` |
| `state` | object | Required for `save` — arbitrary JSON orchestrator state |

**Returns**

- `save` — `{saved: true, runId, lastUpdatedAt}`
- `load` — `{found: true, ...state}` or `{found: false, runId}`
- `list` — `{sessions: [{runId, lastUpdatedAt, currentPhase, completedCount, totalCount}]}`

## Tool dispatch error shape

Unknown tool names and handler errors return:

```json
{
  "content": [{"type": "text", "text": "ERROR: <message>"}],
  "isError": true
}
```
