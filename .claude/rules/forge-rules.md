---
paths: |
  .forge/**
  forge-mcp-server/**
---

# Forge Workflow Rules

When the user invokes /forge or works with forge plans:

## Planning
- ALWAYS explore the codebase before planning (read 5-10 files minimum)
- ALWAYS check for existing test infrastructure and use it
- Every module MUST have verification commands

## Execution
- Use `isolation: worktree` for worker agents to prevent cross-module conflicts
- Spawn independent modules in parallel using multiple Agent calls
- Maximum 7 modules per plan — split into multiple plans if larger

## Validation
- After each module, call mcp__forge__validate — never skip validation
- If validate returns `stagnant: true`, STOP retrying and report to user
- Maximum 3 retry attempts per module
- Attempt 1: worker retries. Attempt 2+: debugger agent takes over

## Memory
- Save learnings after every completed forge run
- Load memory at the start of every new plan
- Categories: convention, failure_pattern, test_command, architecture, dependency, tool_usage

## Reporting
- Announce each phase transition (Planning → Executing → Validating → Complete)
- Show module-level progress (which modules done, which pending)
- Final report must include retry count and any blocked modules
