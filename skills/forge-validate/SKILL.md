---
name: forge-validate
description: Run validation on a specific module from the current forge plan
argument-hint: <module-id>
allowed-tools: [Read, Bash, mcp__forge__validate, mcp__forge__iteration_state]
---

Validate a specific module from the active forge plan. Prefix all output with `[forge:validate]`.

1. Read the latest plan from `.forge/plans/` (most recent JSON file)
2. Find the module matching the argument (e.g., "m1", "m2")
3. Call mcp__forge__validate with that module's verify commands and files
4. Call mcp__forge__iteration_state to get retry history
5. Report results:

```
## Validation: {module title}

**Status:** PASSED / FAILED
**Score:** {X}/{Y} checks passed
**Stagnant:** yes/no
**Attempt:** {N}

### Results
- [PASS] npm test -- --grep 'auth'
- [FAIL] npx tsc --noEmit (error: TS2345 in src/auth.ts:42)

### Recommendation
{PASS / RETRY_WITH_DEBUGGER / ESCALATE}
```
