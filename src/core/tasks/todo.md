# Commit Plan

## Checklist
- [x] Review current worktree changes and group them into coherent commits
- [x] Commit shared/runtime/session infrastructure refactors
- [x] Commit Codara command/facade API consolidation
- [x] Commit documentation and task record updates
- [x] Record verification results and commit SHAs
- [x] Review newly added middleware/guidelines/commands changes
- [x] Commit middleware and guidelines capability extraction
- [x] Commit builtin command module extraction
- [x] Record second-round verification and commit SHAs

## Notes
- Goal: create multiple commits grouped by concern, without rewriting user changes.
- Verification: run targeted tests that cover the touched areas before finalizing.
- Current round focus:
  - split guidelines source loading out of the index module
  - split middleware summary/budget helpers out of conversation
  - move builtin slash commands into dedicated modules

## Review
- Commit `86b3450` `refactor(core): consolidate session runtime infrastructure`
- Commit `e83445a` `refactor(core): unify codara facade and slash commands`
- Commit `d9ce93f` `fix(core): route delegated resumes through tool mode`
- Commit `79d989b` `refactor(core): split summary budget and guidelines capabilities`
- Commit `fd84c22` `refactor(core): extract builtin slash command modules`
- Verification:
  - `bun test tests/unit/agents/checkpoint-sources.test.ts tests/unit/core/codara-session-fork.test.ts tests/unit/core/codara-session-host.test.ts tests/unit/core/codara-session-sources.test.ts tests/unit/core/codara-session-telemetry.test.ts tests/unit/summary/summary.test.ts`
  - `bun test tests/unit/core/codara-commands.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-skill-commands.test.ts`
  - `bun test tests/unit/agents/checkpoint-sources.test.ts tests/unit/core/codara-commands.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-session-fork.test.ts tests/unit/core/codara-session-host.test.ts tests/unit/core/codara-session-sources.test.ts tests/unit/core/codara-session-telemetry.test.ts tests/unit/core/codara-skill-commands.test.ts tests/unit/summary/summary.test.ts`
  - `bun run typecheck`
  - `bun test tests/unit/agents/checkpoint-sources.test.ts tests/unit/core/codara-middleware-stack.test.ts tests/unit/core/codara-session-host.test.ts tests/unit/guidelines/guidelines.test.ts tests/unit/guidelines/source.test.ts tests/unit/middleware/context-budget.test.ts tests/unit/middleware/conversation-context.test.ts tests/unit/middleware/public-surface.test.ts tests/unit/summary/summary.test.ts`
  - `bun test tests/unit/core/codara-commands.test.ts`
