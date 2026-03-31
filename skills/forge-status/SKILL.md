---
name: forge-status
description: Show current forge project status, plan, and iteration history
allowed-tools: Read, Glob, Bash, mcp__forge__memory_recall, mcp__forge__iteration_state
---

Show the current status of the forge project. Prefix all output with `[forge:status]`.

1. Find the latest plan in `.forge/plans/` (most recent JSON)
2. Read it and display the module DAG
3. For each module, call mcp__forge__iteration_state to get attempt history
4. Check `.forge/memory/project.jsonl` for saved learnings
5. Report:

```
## Forge Status

**Plan:** {objective}
**Created:** {timestamp}

### Modules
| ID | Title | Deps | Attempts | Status | Last Score |
|----|-------|------|----------|--------|------------|
| m1 | ...   | —    | 2        | passed | 1.0        |
| m2 | ...   | m1   | 0        | pending| —          |

### Memory
- {count} project patterns saved
- {count} global patterns saved

### Recent Learnings
- "{pattern}" (category, confidence)
```

If no plan exists, say "No active forge plan. Run /forge <objective> to start."
