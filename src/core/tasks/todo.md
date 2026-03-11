# Commit Plan

## Checklist
- [x] Review current worktree changes and group them into coherent commits
- [x] Commit shared/runtime/session infrastructure refactors
- [x] Commit Codara command/facade API consolidation
- [x] Commit documentation and task record updates
- [x] Record verification results and commit SHAs

## Notes
- Goal: create multiple commits grouped by concern, without rewriting user changes.
- Verification: run targeted tests that cover the touched areas before finalizing.

## Review
- Commit `86b3450` `refactor(core): consolidate session runtime infrastructure`
- Commit `e83445a` `refactor(core): unify codara facade and slash commands`
- Verification:
  - `bun test tests/unit/agents/checkpoint-sources.test.ts tests/unit/core/codara-session-fork.test.ts tests/unit/core/codara-session-host.test.ts tests/unit/core/codara-session-sources.test.ts tests/unit/core/codara-session-telemetry.test.ts tests/unit/summary/summary.test.ts`
  - `bun test tests/unit/core/codara-commands.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-skill-commands.test.ts`
  - `bun test tests/unit/agents/checkpoint-sources.test.ts tests/unit/core/codara-commands.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-session-fork.test.ts tests/unit/core/codara-session-host.test.ts tests/unit/core/codara-session-sources.test.ts tests/unit/core/codara-session-telemetry.test.ts tests/unit/core/codara-skill-commands.test.ts tests/unit/summary/summary.test.ts`
  - `bun run typecheck`
