# 2026-03-22 Subagent Boundary And Permission Propagation Fix

## Plan

- [x] Split the subagent middleware into a clear child-runtime builder plus the outward middleware constructor so the file stops mixing assembly concerns.
- [x] Propagate `permissionMode` from skills subagent definitions into child bootstrap and run records so child sessions can retain the selected mode.
- [x] Stop the default subagent bootstrap from inheriting the main conversation skills prompt while keeping the normal project prompt/guidelines path intact.
- [x] Re-run targeted subagent, skills, and Codara facade verification, then record the results here.

## Review

- `createSubagentMiddleware(...)` remains the outward runtime entry point, while `buildSubagentChildMiddlewares(...)` only assembles child-side middleware.
- `permissionMode` now flows from skill metadata into subagent launch compilation, run storage, and child bootstrap/recovery context so resumed child runs keep the selected mode.
- Child bootstrap strips inherited skills prompt content from both the base system bundle and the prepared instruction context before the child agent starts.
- `src/codara/assembly/middleware.ts` now only forwards prompt/guidelines/memory bootstrap data to children; the main-conversation skills prompt no longer leaks into child startup.
- Targeted verification passed:
  - `bun test tests/unit/tasks/depth-limit.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/child-middlewares.test.ts`
  - `bunx tsc --noEmit --pretty false`

# 2026-03-22 Skills Context Assembly And Background Child Contract

# 2026-03-22 Subagent Naming And Ownership Cleanup

## Plan

- [x] Finish the in-flight `agent-run` to `subagent-run` naming cleanup so mid-layer names stop colliding with `core/agent`.
- [x] Rename the parent continuation handoff path from `agent-completion` to `subagent-completion` and update CLI/controller types to the same vocabulary.
- [x] Tighten `subagent` readability so it clearly reads as build + middleware + tool + run tracking over the single core bootstrap path.
- [x] Re-run focused subagent/task/CLI verification plus eslint, typecheck, and diff-check.

## Review

- `agent-run` / `active-agent-run` ids are now `subagent-run` / `active-subagent-run` in the live CLI path and related tests.
- Parent continuation handoff now lives under:
  - `src/codara/subagent-completion.ts`
  instead of `src/codara/agent-completion.ts`.
- CLI active-turn vocabulary now uses `subagent_completion` rather than `agent_completion`, which better matches the actual meaning: the main turn is consuming completed subagent results.
- `src/capability/subagent/bootstrap.ts` now reads more directly:
  - it explicitly comments that subagents reuse the core `bootstrapAgent/createAgent` path
  - child tool filtering is expressed as `filterSubagentChildTools(...)` with the Claude Code rule that subagents cannot spawn other subagents
- `src/capability/subagent/run-manager.ts` now uses clearer local names:
  - `runPromptInBackground`
  - `ensureChildAgent`
  - `subagentRunEventId`
- `src/codara/assembly/middleware.ts` no longer misnames the child checkpointer as `taskCheckpointer`; it is now `subagentCheckpointer`.
- Focused verification passed:
  - `bun test tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/subagent-runs.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/durability/approval-store.test.ts`
  - `bunx eslint src/capability/subagent/*.ts src/capability/task/*.ts src/codara/*.ts src/codara/assembly/*.ts src/cli/app/*.ts src/cli/hooks/use-subagent-runs.ts src/cli/hooks/use-solidified-transcript.ts src/cli/components/chrome/subagent-run-panel.tsx src/cli/components/conversation/transcript.tsx src/cli/transcript/model.ts tests/unit/agents/*.ts tests/unit/tasks/*.ts tests/unit/cli/*.ts tests/unit/durability/approval-store.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Claude-Code Docs-First Subagent And Task Realignment

## Plan

- [x] Re-read the local Claude Code docs for background tasks, subagents, permissions, interaction control, and context before touching the current `task/subagent` structure again.
- [x] Flatten `src/capability/task` back to a direct coordination surface instead of keeping an unnecessary `coordination/` indirection layer.
- [x] Collapse subagent child bootstrap and recovery assembly into a single bootstrap owner so the path from subagent capability to core agent bootstrap is explicit.
- [x] Move parent continuation policy out of `src/capability/subagent` so the subagent directory only owns child delegation concerns.
- [x] Re-run focused subagent/task/facade verification, lint, typecheck, and residual scans after the rewrite.

## Review

- `src/capability/task` is flat again and now matches the actual scope of the domain:
  - `src/capability/task/types.ts`
  - `src/capability/task/store.ts`
  - `src/capability/task/tools.ts`
  - `src/capability/task/middleware.ts`
  - `src/capability/task/index.ts`
- The old extra nesting under `src/capability/task/coordination/` has been removed.
- Subagent child build/recovery now has a single owner:
  - `src/capability/subagent/bootstrap.ts`
- Deleted old split bootstrap layers:
  - `src/capability/subagent/delegated-child.ts`
  - `src/capability/subagent/recovery.ts`
- Parent completion continuation no longer pollutes the subagent capability:
  - moved from `src/capability/subagent/completion-handoff.ts`
  - to `src/codara/agent-completion.ts`
- The current `src/capability/subagent` surface is down to files that match real child-delegation concerns:
  - `bootstrap.ts`
  - `index.ts`
  - `launch-reuse.ts`
  - `middleware.ts`
  - `review-metadata.ts`
  - `run-store.ts`
  - `runtime.ts`
  - `tool.ts`
  - `types.ts`
- Residual scans are clean for the deleted structure:
  - no `coordination/`
  - no `delegated-child`
  - no `completion-handoff`
  - no `child-middlewares`
  - no `DELEGATION_TOOL`
- Focused verification passed:
  - `bun test tests/unit/tasks/depth-limit.test.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/capability/task src/capability/subagent src/codara/agent-completion.ts src/codara/assembly/middleware.ts tests/unit/tasks/depth-limit.test.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Subagent Outward Surface Correction

## Plan

- [x] Re-align the public delegation surface so `subagent` remains the outward capability owner with a single public middleware entry.
- [x] Fold `src/capability/subagent/child-middlewares.ts` into `src/capability/subagent/middleware.ts` so child middleware assembly stops looking like a second public seam.
- [x] Keep `task` coordination separate and thin; do not move delegated child outward registration back under `task`.
- [x] Update Codara assembly and focused tests to consume the single outward subagent middleware contract.
- [x] Re-run focused subagent/task/facade verification, typecheck, lint, and diff-check.

## Review

- `createAgentMiddleware(...)` is now the single outward delegation middleware in the live Codara runtime path; default runtime assembly no longer mounts a separate `TaskMiddleware` alongside it.
- `AgentMiddleware` now owns both delegated `Agent` registration and shared task-coordination tool registration when a `taskStore` is supplied, so callers no longer need to understand two middleware names for the default orchestration surface.
- `src/capability/subagent/child-middlewares.ts` was deleted; child middleware assembly now lives inside `src/capability/subagent/middleware.ts` with the outward middleware owner.
- Caller-provided `AgentMiddleware` instances are rebound onto runtime-owned stores/runtime/checkpointer through `readAgentMiddlewareOptions(...)`, so Codara keeps a single state source even when callers inject custom child models/tools.
- Focused verification passed:
  - `bun test tests/unit/agents/child-middlewares.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bunx eslint src/capability/subagent src/codara/assembly/middleware.ts tests/unit/agents/child-middlewares.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts`
  - `git diff --check`

## Plan

- [x] Pull `SkillsRuntimeBundle` and `create/loadSkillsRuntimeBundle(...)` back under `context/skills/build` so `@capability/skill` no longer re-exports assembly/build concerns.
- [x] Update tests, helpers, and root/context barrels to consume the skills bundle from `context` while keeping runtime/metadata ownership in `capability/skill`.
- [x] Reconnect delegated child sessions to the same context assembly seam as main sessions by using a shared instruction-context preparer instead of ad-hoc system-message concatenation only.
- [x] Make background child runs non-interactive by default: no `AskUserQuestion` tool, and permission requests auto-deny instead of opening interactive review.
- [x] Add focused regression coverage for the new child middleware contract and rerun skills/subagent/facade verification.

## Review

- `@capability/skill` no longer re-exports `createSkillsRuntimeBundle`, `loadSkillsRuntimeBundle`, or `SkillsRuntimeBundle`; those now live only under:
  - `src/context/skills/build.ts`
  - `src/context/index.ts`
  - `src/index.ts`
- `SkillsRuntimeBundle` moved out of `src/capability/skill/contracts.ts`, which keeps `capability/skill` focused on runtime metadata/contracts rather than session assembly.
- `createInstructionContextPreparer(...)` now accepts the full instruction bundle inputs and merges them into child sessions through `mergePreparedInstructionContext(...)`, so delegated children reuse the same prompt/guidelines/skills/auto-memory assembly seam as main sessions.
- Runtime assembly now passes `skillsSource`, `autoMemorySource`, and `memoryRootDir` into child preparation, instead of only stitching child system prompts locally in the subagent launch path.
- Background child middleware now defaults to Claude Code-style non-interactive behavior:
  - no `AskUserQuestion` tool unless `interactionMode: 'foreground'`
  - permission requests continue to surface through the shared main review/control plane rather than through a separate child-owned approval UI
- Added focused regression coverage in:
  - `tests/unit/agents/child-middlewares.test.ts`
- Verification passed:
  - `bun test tests/unit/agents/child-middlewares.test.ts tests/unit/skills/middleware.test.ts tests/unit/skills/runtime-context.test.ts tests/unit/middleware/skills-export.test.ts tests/unit/sessions/skills.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/public-api-surface.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bunx eslint src/capability/skill src/capability/subagent/child-middlewares.ts src/context/skills/build.ts src/context/index.ts src/context/session-bundle/base-system-message.ts src/core/middleware/skills.ts src/core/middleware/index.ts src/core/middleware/permission src/codara/assembly/context.ts src/codara/assembly/middleware.ts src/codara/facade.ts tests/unit/agents/child-middlewares.test.ts tests/unit/skills/middleware.test.ts tests/unit/skills/runtime-context.test.ts tests/unit/middleware/skills-export.test.ts tests/unit/agents/subagent-task.test.ts tests/integration/skills/skills-project-codara.e2e.test.ts tests/integration/skills/skills-project-standard-flow.e2e.test.ts tests/integration/skills/skills-task-completion.e2e.test.ts tests/integration/skills/skills-progressive-disclosure.e2e.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/unit/agents/task-tool.fixtures.ts`
  - `git diff --check`

# 2026-03-22 Review Naming And Control-Plane Unification

# 2026-03-22 Skills Ownership And Control-Plane Convergence

## Plan

- [x] Move live skills runtime parsing and subagent profile resolution out of `src/context/skills/*` into `src/capability/skill/*` so skills owns its own runtime contract.
- [x] Move skills system-message construction and subagent catalog rendering into the skills capability so `context/session-bundle`, `core/middleware/skills`, and `subagent/*` stop formatting skills output themselves.
- [x] Keep external layers as consumers only:
  - `context/session-bundle` consumes a prepared skills bundle/runtime
  - `core/middleware/skills` consumes skills-owned prompt/runtime helpers
  - `subagent` consumes skills-owned profile/catalog views
- [x] Audit adjacent “common capability management” seams so the resulting structure stays controllable instead of scattering more helpers:
  - prompt assembly
  - runtime shared payload shape
  - subagent profile consumption
  - public barrel/test breakpoints
- [x] Re-run focused skills/subagent/facade/context regressions, eslint, typecheck, and diff-check after the refactor.

## Review

- `capability/skill` is now the only live owner of skills contracts, runtime parsing, runtime bundle construction, and subagent catalog rendering:
  - `src/capability/skill/contracts.ts`
  - `src/capability/skill/runtime/runtime.ts`
  - `src/capability/skill/runtime/commands.ts`
  - `src/capability/skill/discovery/source.ts`
- Deleted old context-side shims:
  - `src/context/skills/contracts.ts`
  - `src/context/skills/runtime-shared.ts`
  - `src/context/prompts/skills-system-prompt.ts`
  - `src/capability/skill/catalog/types.ts`
- `buildBaseSystemMessage` now consumes `skillsSource.getBundle()` directly instead of reconstructing a skills prompt from raw runtime data.
- `createSkillsMiddleware` now consumes `loadSkillsRuntimeBundle(...)` and mounts a skills-owned `createSkillTool(...)`; it no longer owns skill matching or skill file prompt assembly.
- `subagent` now consumes a skills-owned subagent catalog projection instead of formatting it locally.
- Focused verification passed:
  - `bun test tests/unit/skills/middleware.test.ts tests/unit/skills/runtime-context.test.ts tests/unit/skills/subagents.test.ts tests/unit/sessions/skills.test.ts tests/unit/core/codara-session-sources.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/middleware/skills-export.test.ts`
  - `bun test tests/integration/skills/skills-project-codara.e2e.test.ts tests/integration/skills/skills-project-standard-flow.e2e.test.ts tests/integration/skills/skills-task-completion.e2e.test.ts tests/integration/skills/skills-progressive-disclosure.e2e.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bunx eslint src/capability/skill src/core/middleware/skills.ts src/core/middleware/index.ts src/capability/subagent/middleware.ts src/context/session-bundle/base-system-message.ts src/context/index.ts src/index.ts src/durability/session/session.ts tests/unit/skills/middleware.test.ts tests/unit/skills/runtime-context.test.ts tests/unit/skills/subagents.test.ts tests/unit/sessions/skills.test.ts tests/unit/core/codara-session-sources.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/middleware/skills-export.test.ts tests/unit/agents/subagent-task.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/integration/skills/skills-project-codara.e2e.test.ts tests/integration/skills/skills-project-standard-flow.e2e.test.ts tests/integration/skills/skills-task-completion.e2e.test.ts tests/integration/skills/skills-progressive-disclosure.e2e.test.ts`
  - `git diff --check`

## Plan

- [x] Remove the remaining low-level `hil` naming from the live review middleware implementation and public exports.
- [x] Rename review payload/result strings, runtime event handling, and channel adapters so live code no longer mixes `review` and `hil`.
- [x] Update current tests/cases and active docs to the same `review` vocabulary, including renamed case/test paths where needed.
- [x] Re-run focused review/runtime/CLI/subagent verification, typecheck, lint, and diff-check after the cleanup.

## Review

- The live review middleware is now owned by `src/core/middleware/review.ts`; `src/core/middleware/hil.ts` no longer exists, and the middleware public surface only exposes `Review*` names.
- Review payload/result strings were unified to:
  - `review_pause`
  - `review_deny`
  - `review_event`
- Runtime/control-plane consumers now read the same review contract end-to-end:
  - `src/core/agent/run/*`
  - `src/observability/events/*`
  - `src/shared/messages.ts`
  - `src/bus/bus.ts`
  - `src/integration/channel/review-adapter.ts`
- Case/test naming was also pulled forward so active regression paths no longer reinforce the old `hil` mental model:
  - `tests/cases/review/*`
  - `tests/unit/middleware/review-*.test.ts`
  - `tests/unit/channel/review-adapter.test.ts`
- High-signal residual scans are now clean for live code, tests, and current docs:
  - no `HIL`
  - no `createHILMiddleware`
  - no `hil_pause` / `hil_deny`
  - no `CodaraPauseStreamRequest`
  - no `streamKind: 'pause'`
  - no transcript `role: 'task'`
- Verification passed:
  - `bun test tests/unit/middleware/review-middleware.test.ts tests/unit/middleware/review-request-metadata.test.ts tests/unit/middleware/review-resume-routing.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/integration/permission-middleware.test.ts tests/unit/permissions/middleware.test.ts tests/unit/channel/review-adapter.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/agents/agent.test.ts tests/unit/agents/subagent.test.ts tests/cases/review/form-ui.case.test.ts tests/cases/review/subagent-activity-display.case.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bunx eslint src/core/middleware/review.ts src/core/middleware/index.ts src/core/middleware/ask-user-question.ts src/core/middleware/permission/runtime.ts src/core/middleware/permission/middleware.ts src/core/agent/run/agent-loop.ts src/core/agent/run/turn.ts src/observability/events/controller.ts src/cli/transcript/model.ts src/shared/messages.ts src/integration/channel/review-adapter.ts src/bus/bus.ts src/durability/session/session.ts src/capability/subagent/agent.ts tests/unit/middleware/review-middleware.test.ts tests/unit/middleware/review-request-metadata.test.ts tests/unit/middleware/review-resume-routing.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/channel/review-adapter.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/cli/transcript-model.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/review/form-ui.case.test.ts`
- `git diff --check`

# 2026-03-22 Task Coordination And Subagent Directory Realignment

## Plan

- [x] Pull `task` down to a pure coordination domain so the directory itself no longer mixes task-list coordination with delegated child runtime.
- [x] Move the coordination-only task types/middleware under `src/capability/task/coordination/*` and delete the ambiguous root-level duplicates.
- [x] Replace `src/capability/subagent/agent.ts` with more explicit ownership files so delegated child bootstrap/runtime helpers stop colliding with the broader `agent` term.
- [x] Re-run focused task/subagent/facade/CLI transcript verification, eslint, typecheck, and diff-check after the directory changes.

## Review

- `src/capability/task` is now visually and semantically a coordination-only subtree:
  - `src/capability/task/coordination/types.ts`
  - `src/capability/task/coordination/store.ts`
  - `src/capability/task/coordination/tools.ts`
  - `src/capability/task/coordination/middleware.ts`
  - `src/capability/task/index.ts`
- The old root-level coordination files were removed:
  - `src/capability/task/types.ts`
  - `src/capability/task/middleware.ts`
- Delegated child ownership inside `src/capability/subagent` is now clearer:
  - `src/capability/subagent/delegated-child.ts` owns child bootstrap/execution/result formatting
  - `src/capability/subagent/review-metadata.ts` owns parent/child review metadata parsing and merge rules
- The misleading `src/capability/subagent/agent.ts` file no longer exists, which removes a naming collision with the broader `core/agent` runtime.
- Live source-path residuals for the removed files/imports are gone:
  - no `@capability/task/types`
  - no `@capability/task/middleware`
  - no `@capability/subagent/agent`
- The remaining live `task` vocabulary now maps cleanly to shared coordination, while `subagent` owns delegated child runtime.
- Focused verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/tasks/depth-limit.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/run-store-file.test.ts`
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/agent-runs.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/capability/task src/capability/subagent src/core/agent/index.ts src/cli/transcript/model.ts tests/unit/tasks/depth-limit.test.ts tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/agent-runs.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Superworkers Codex Alignment Refresh

# 2026-03-22 Task/Subagent Child Ownership Cleanup

## Plan
- [x] Make the subagent creation path explicit again so `subagent` visibly owns child bootstrap while `core/agent` stays the only execution engine.
- [x] Rename the remaining subagent orchestration layer away from vague `coordinator`/`AgentRun*` language where it still collides with `core/agent`.
- [x] Shrink the root and capability barrels so low-level task/subagent helper constructors stop leaking from the public surface.
- [x] Re-run focused task/subagent/facade/CLI/observability verification after the naming and ownership cleanup.

## Review

- `src/capability/subagent/bootstrap.ts` now visibly owns the child creation seam:
  - `bootstrapSubagent(...)` is the explicit handoff from subagent assembly into `core/bootstrapAgent(...)`
  - child build/recovery/result formatting stay in the same file, so the path from “subagent config” to “core agent” is readable in one place
- `src/capability/subagent/coordinator.ts` was renamed to:
  - `src/capability/subagent/run-manager.ts`
  - exported names now read as `SubagentRunManager` / `createSubagentRunManager(...)`
  - this removes one more “second runtime” smell from the subagent directory
- `src/capability/subagent/tool.ts` now uses `Subagent*` internal names consistently for its launch preparation and result handling, while keeping the outward tool name as `Agent`
- `@capability/subagent` barrel is tighter:
  - keeps run store / run manager / middleware
  - no longer re-exports bootstrap/result/review-metadata helpers
- top-level `src/index.ts` no longer leaks low-level task tool constructors or task tool names; root export now keeps task at the store/type layer and subagent at the middleware layer
- verification passed:
  - `bun test tests/unit/core/public-api-surface.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts`
  - `bun test tests/unit/cli/subagent-runs.test.ts tests/unit/cli/components/chrome/subagent-run-panel.test.tsx tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/durability/approval-store.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bunx eslint src/capability/subagent/*.ts src/capability/task/*.ts src/codara/*.ts src/codara/assembly/*.ts src/core/agent/run/turn.ts src/observability/events/controller.ts src/observability/events/formatters.ts src/index.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/subagent-runs.test.ts tests/unit/cli/components/chrome/subagent-run-panel.test.tsx tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/durability/approval-store.test.ts`
  - `git diff --check`

- [x] Stop routing child-only bootstrap fields through ambiguous shared names like `middleware`, `context`, `values`, `prepareContext`, and `lifecycle`.
- [x] Make delegated child bootstrap options explicitly child-owned in the subagent capability surface.
- [x] Rename subagent persistence from generic `store.ts` to `run-store.ts` so it no longer reads like the shared task-list store.
- [x] Re-run task/subagent/facade/HIL regressions, eslint, typecheck, and diff-check after the rename.

## Review

- `createAgentTool` / `createAgentMiddleware` now use explicit child-owned fields:
  - `childMiddleware`
  - `childContext`
  - `childValues`
  - `childPrepareContext`
  - `childSystemMessages`
  - `childSystemPrompt`
  - `childLifecycle`
- The child bootstrap path in `src/capability/subagent/agent.ts` no longer looks like it is sharing parent middleware/context by default; explicit child seeds are still supported, but they are named as child-only ownership.
- `src/capability/subagent/store.ts` was renamed to `src/capability/subagent/run-store.ts` and imports were updated so task-list persistence and delegated-run persistence no longer present as two generic `store.ts` peers.
- While applying the rename, stale `sessionId` assumptions in agent-run persistence/runtime/assembly were removed so `AgentRunRecord` consistently keys the parent thread as `parentSessionId`.
- Verification passed:
  - `bun test tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/hil/subagent-activity-display.case.test.ts`
  - `bunx eslint src/capability/task src/capability/subagent src/codara/assembly/middleware.ts src/codara/assembly/agent-runs.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/hil/subagent-activity-display.case.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

## Plan

- [x] Audit `.codara/skills/superworkers` for stale Claude Code-only wording and accidental local drift.
- [x] Rework the active superworker prompts and references so subagent dispatch is expressed in platform-neutral terms with explicit Codex equivalents.
- [x] Remove misleading Codex notes such as outdated config flags and weak `Task`/`Agent` word swaps.
- [x] Align reviewer/implementer guidance with the Claude Code docs already collected in `docs/claude-code`, especially around fresh subagents, read-only review roles, and no nested subagent dispatch.
- [x] Re-scan the updated superworkers files for stale delegation wording and formatting issues.

## Review

- Audited and corrected the local superworkers drift, then the user explicitly rolled those files back.
- No `.codara/skills/superworkers` edits are part of the current worktree.
- The outcome from that audit still informed the live code changes below: current Codara should align to Claude Code/Codex semantics in its own implementation and tests, not by mutating shared superworker skills unless explicitly requested again.

# 2026-03-22 Subagent Ownership Cleanup

## Plan

- [x] Move delegated child middleware ownership out of `src/codara/assembly/middleware.ts` and into `src/capability/subagent/*` so subagent bootstrap is self-managed.
- [x] Delete `src/capability/subagent/support.ts` and fold its single-consumer helpers back into `tool.ts` / `middleware.ts`.
- [x] Delete `src/capability/subagent/tool-types.ts` and colocate tool/middleware option types with their owning modules.
- [x] Remove `rebindAgentRunStore(...)` and any similar store-binding shim if direct method calls already make it unnecessary.
- [x] Re-run focused subagent/facade/runtime regression, eslint, typecheck, and diff-check.

## Review

- `src/capability/subagent` no longer depends on a generic `support.ts` bucket or `tool-types.ts` indirection; those helpers and types now live with their real owners in `tool.ts` and `middleware.ts`.
- Delegated child middleware ownership moved out of `src/codara/assembly/middleware.ts`:
  - assembly now passes child runtime settings
  - `createAgentMiddleware(...)` builds the child middleware stack itself
- The store-binding hack `rebindAgentRunStore(...)` was removed. Direct store method calls were already sufficient, so the old rebinding layer only added confusion.
- Current `src/capability/subagent` surface is smaller and more legible:
  - `agent.ts`
  - `tool.ts`
  - `middleware.ts`
  - `runtime.ts`
  - `store.ts`
  - `types.ts`
  - `index.ts`
- Focused verification passed:
  - `bun test tests/unit/agents/subagent.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/tasks/depth-limit.test.ts tests/cases/helpers/cli-runtime-factory.ts`
  - `bunx eslint src/capability/subagent src/codara/assembly/middleware.ts tests/unit/agents/subagent.test.ts tests/unit/tasks/middleware.test.ts tests/unit/core/codara-facade.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/tasks/depth-limit.test.ts tests/cases/helpers/cli-runtime-factory.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Agent Run Parent Identity Cleanup

## Plan

- [x] Remove the ambiguous `sessionId + parentSessionId?` pairing from `AgentRunRecord` and keep only the parent-session identity for delegated runs.
- [x] Update run-store persistence, runtime recovery, and facade summaries to read delegated runs through `parentSessionId`.
- [x] Rewrite the affected run-store tests and fixtures so they assert the clarified parent/child identity contract instead of the old fallback field.
- [x] Re-run focused run-store/facade/subagent regression, eslint, typecheck, and diff-check.

## Review

- `AgentRunRecord` and `AgentRunStartInput` now carry a single required parent identity:
  - `parentSessionId`
- `run-store`, `runtime`, `tool`, and `codara/assembly/agent-runs.ts` no longer fall back between `sessionId` and `parentSessionId`; delegated runs are consistently indexed, filtered, and summarized by the parent session.
- Focused verification passed:
  - `bun test tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/core/codara-facade.test.ts tests/unit/agents/subagent.test.ts tests/unit/tasks/middleware.test.ts`
  - `bunx eslint src/capability/subagent/run-store.ts src/capability/subagent/runtime.ts src/capability/subagent/tool.ts src/codara/assembly/agent-runs.ts src/capability/subagent/middleware.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/core/codara-facade.test.ts tests/unit/agents/subagent.test.ts tests/unit/tasks/middleware.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Task Coordination vs Subagent Delegation Alignment

## Plan

- [x] Finish the directory and public-surface split so `task` only owns shared coordination and `subagent` owns delegation/runtime.
- [x] Remove remaining live-path imports that still pull subagent runtime/store/tool primitives from `@capability/task`.
- [x] Update coordination/delegation tests to match the new barrels and runtime labels instead of relying on old `taskRunStore` / `TaskMiddleware` assumptions.
- [x] Re-run focused task/subagent/facade regressions, eslint, typecheck, and diff-check before committing.

## Review

- `src/capability/task` now only exports coordination surfaces:
  - task store/types
  - `TaskCreate / TaskUpdate / TaskList`
  - `createTaskMiddleware` as the coordination middleware
- Delegation/runtime primitives now live under `src/capability/subagent` and are imported from that barrel in live paths and tests.
- `tests/unit/tasks/middleware.test.ts` no longer mixes coordination and delegation through one faux middleware; delegation assertions now use `createAgentMiddleware`, while task-list assertions stay on `createTaskMiddleware`.
- `tests/unit/core/codara-facade.test.ts` and `tests/cases/helpers/cli-runtime-factory.ts` were updated to pass `agentRunStore` instead of the stale `taskRunStore` option name.
- Public-surface assertions now match the intended contract:
  - `@capability/task` does not expose `AGENT_TOOL_NAME` or low-level subagent primitives
  - `@capability/subagent` owns `Agent` runtime/store/tool exports
- Focused verification passed:
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/task-tool-limits.test.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/tasks/depth-limit.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/hil/subagent-activity-display.case.test.ts`
  - `bunx eslint src/capability/task src/capability/subagent src/codara src/shared/agent-run-launch.ts tests/unit/tasks tests/unit/agents tests/unit/core/codara-facade.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/hil/subagent-activity-display.case.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Permission + Tool Review Verification And Task Launch Preparation

## Plan

- [x] Re-verify that the current frontend review surface covers `permission` and `tool/file/skill` reviews, not just `AskUser`.
- [x] Confirm the new typed review path is stable by rerunning focused CLI review tests.
- [x] Start the next `task + subagents` cut from child launch preparation instead of touching the whole runtime state machine.
- [x] Re-run task/subagent regression, eslint, tsc, and diff-check after the extraction.
- [ ] Reframe `task/store.ts` vs `task/run-store.ts` using Claude Code semantics and decide whether they should be renamed/moved into clearer `coordination` vs `delegation/background-run` boundaries.

## Review

- Verified on the current tree that `permission` and `tool/file` review surfaces are now in the typed review path, not the older catch-all AskUser-only work.
- Focused review verification passed:
  - `bun test tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
- Extracted delegated child launch preparation out of `src/capability/task/task-tool.ts` into:
  - `src/capability/task/task-launch-preparation.ts`
- `task-tool.ts` now mainly does:
  - parse tool input
  - call `prepareTaskLaunch(...)`
  - short-circuit on existing run message
  - call `runtime.launch(...)`
  - return launch tool message
- The extraction keeps `runtime.ts` untouched and leaves recovery/state-machine logic in place, which is the safest next seam for `task + subagents`.
- Task/subagent verification passed after fixing the one real regression introduced during extraction:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/capability/task/task-tool.ts src/capability/task/task-launch-preparation.ts src/capability/task/task-run-support.ts src/capability/task/middleware.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`
- New architectural concern surfaced: even if both stores are legitimate, `task/store.ts` (shared task graph) and `task/run-store.ts` (background delegated run persistence) are too similarly named for their very different roles. This should be realigned to Claude Code-style boundaries, not defended as-is.

# 2026-03-22 Inspect Claude Code Ask/Clarification CLI Reference

# 2026-03-22 Frontend Review HIL Refinement

## Plan

- [x] Split `src/cli/components/conversation/review-panel.tsx` into a thin shell plus typed body renderers so AskUser, permission, and generic review UIs stop sharing one file.
- [x] Keep the frontend-only cut strict: do not redesign backend review control-plane contracts unless the extraction uncovers a genuine blocker.
- [x] Split `src/cli/app/review-state.ts` by concern so navigation/selection math, questionnaire answer editing, submit flow, and permission helpers stop accumulating in one state-machine file.
- [x] Keep `src/cli/app/use-cli-controller.ts` and `src/cli/app/shell-app.tsx` as orchestration/shell layers; move review-specific behavior out instead of adding more local branches.
- [x] Re-run focused CLI review/HIL tests, eslint, typecheck, and diff-check after each extraction slice.

## Notes

- Frontend maintainability is the immediate priority; backend review/task control-plane can stay stable for this round.
- The current hotspots are:
  - `src/cli/app/review-state.ts`
  - `src/cli/components/conversation/review-panel.tsx`
  - `src/cli/app/use-cli-controller.ts`
  - `src/cli/app/shell-app.tsx`
- Desired end-state for this round:
  - `review-panel-shell`
  - typed review body renderers (`ask-user`, `permission`, `generic/tool`)
  - smaller review-state helpers with explicit responsibility boundaries
  - no new giant frontend `.ts`/`.tsx` file introduced while cleaning this up

## Review

- `src/cli/components/conversation/review-panel.tsx` is now a thin router instead of a mixed shell/body file.
- Review body rendering is split into typed components:
  - `src/cli/components/conversation/review/permission-review.tsx`
  - `src/cli/components/conversation/review/generic-review.tsx`
  - `src/cli/components/conversation/review/ask-user-review.tsx`
  - `src/cli/components/conversation/review/review-panel-shell.tsx`
- AskUser rendering was further split so the previous body file did not simply become the next god file:
  - `src/cli/components/conversation/review/ask-user-question-step.tsx`
  - `src/cli/components/conversation/review/ask-user-submit-step.tsx`
  - `src/cli/components/conversation/review/ask-user-tab-strip.tsx`
  - `src/cli/components/conversation/review/ask-user-review-helpers.ts`
- `src/cli/app/review-state.ts` is now a small sync/facade layer instead of the full review state machine.
- Questionnaire-heavy logic moved into:
  - `src/cli/app/review-form-state.ts`
  - `src/cli/app/review-permission-state.ts`
  - `src/cli/app/review-auto-action.ts`
- `src/cli/app/use-cli-controller.ts` now uses a single local review write helper that keeps `reviewRef` and React state in sync, which fixed the queue-handoff regression introduced during the extraction.
- Verification passed:
  - `bun test tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/app/review-state.ts src/cli/app/review-form-state.ts src/cli/app/review-permission-state.ts src/cli/app/use-cli-controller.ts src/cli/components/conversation/review-panel.tsx src/cli/components/conversation/review/*.tsx src/cli/components/conversation/review/*.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Permission And Tool Review Surface Cleanup

## Plan

- [x] Confirm whether `src/cli/components/permission/*` is still a live UI path or just dead frontend residue.
- [x] Remove stale permission UI shells if the new review surface already owns that path, while keeping any genuinely shared types.
- [x] Split tool/file/skill/config review rendering out of the generic review body so front-end review surfaces are typed by intent instead of one fallback bucket.
- [x] Re-run focused review/HIL tests, lint, typecheck, and diff-check.

## Notes

- Current inspection shows the new live review path is:
  - `src/cli/components/conversation/review-panel.tsx`
  - `src/cli/components/conversation/review/permission-review.tsx`
  - `src/cli/components/conversation/review/generic-review.tsx`
- The old `src/cli/components/permission/*` tree appears to be dead except for `types.ts`, which is still imported by the new review state/input modules.
- `src/cli/app/use-cli-controller.ts` still has a duplicated local `isPermissionReview(...)` helper even though `src/cli/app/review-permission-state.ts` already exists.
- Tool/file/skill/config review cases are still all landing in `generic-review`, so the current front-end split is only partial.

## Review

- Confirmed `src/cli/components/permission/*` was dead frontend residue:
  - no live imports remained in `src/` once `PermissionStage` moved into `src/cli/app/review-types.ts`
  - the old `PermissionPanel` subtree and its orphaned unit test were removed
- Removed a duplicate controller-only permission predicate and standardized on the existing review-kind path:
  - `src/cli/app/review-kind.ts`
  - `src/cli/app/use-cli-controller.ts`
- Added a typed `tool-review` body so non-AskUser, non-permission review items with a real tool call no longer render through the generic fallback:
  - `src/cli/components/conversation/review/tool-review.tsx`
  - `src/cli/components/conversation/review-panel.tsx`
  - `src/cli/components/conversation/review/review-panel-shell.tsx`
- Floating review chrome now titles tool-driven reviews by type:
  - `Permission Review`
  - `File Review`
  - `Skill Review`
  - `Tool Review`
- The generic review body is still present, but now only as the true fallback instead of carrying all tool/file/skill/config cases.
- Verification passed:
  - `bun test tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/app/review-types.ts src/cli/app/review-kind.ts src/cli/app/review-permission-state.ts src/cli/app/view-state.ts src/cli/app/use-cli-controller.ts src/cli/hooks/use-cli-interaction-input.ts src/cli/hooks/review-input-action.ts src/cli/components/conversation/review-panel.tsx src/cli/components/conversation/review/review-panel-shell.tsx src/cli/components/conversation/review/tool-review.tsx tests/unit/cli/components/conversation/review-panel.test.tsx`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Review Surface Cleanup For Permission + Tool/File

## Plan

- [x] Audit whether `src/cli/components/permission/*` is still live or is dead frontend residue after the new review-panel split.
- [x] Remove duplicate permission-review detection and centralize review kind helpers so permission / ask-user / tool-review surfaces share one classifier.
- [x] Split generic tool/file/skill/config reviews away from the current catch-all `generic-review` body when the renderer can identify them cleanly.
- [x] Keep this cut frontend-only: do not redesign backend review contracts unless the frontend extraction uncovers a real blocker.
- [x] Re-run focused CLI review tests, eslint, typecheck, and diff-check.

## Review

- `src/cli/components/permission/*` was no longer a live renderer path; only its `PermissionStage` type was still referenced.
- Frontend review kind detection is now centralized in:
  - `src/cli/app/review-kind.ts`
  - `src/cli/app/review-types.ts`
- The live review surface is now cleaner:
  - AskUser stays on `ask-user-review`
  - permission stays on `permission-review`
  - tool/file/skill/config review now has a typed body in `src/cli/components/conversation/review/tool-review.tsx`
  - `generic-review` is left only for true fallback cases
- Removed the obsolete permission component set and its old test:
  - `src/cli/components/permission/*`
  - `tests/unit/cli/components/permission/PermissionPanel.test.tsx`
- `review-panel-shell` titles now reflect the typed surface (`Permission Review`, `File Review`, `Skill Review`, `Tool Review`) instead of treating all non-AskUser items as one generic shell.
- Verification passed:
  - `bun test tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/app/review-kind.ts src/cli/app/review-types.ts src/cli/app/review-permission-state.ts src/cli/app/review-state.ts src/cli/app/use-cli-controller.ts src/cli/app/view-state.ts src/cli/hooks/review-input-action.ts src/cli/hooks/use-cli-interaction-input.ts src/cli/components/conversation/review-panel.tsx src/cli/components/conversation/review/*.tsx tests/unit/cli/components/conversation/review-panel.test.tsx`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Active Transcript Chronology Alignment

## Plan

- [x] Confirm where the active transcript was forcing assistant text ahead of tool/runtime blocks.
- [x] Add failing tests for Claude Code-style chronological ordering during streaming.
- [x] Introduce an explicit runtime boundary in the active turn so assistant text can appear before and after tool blocks.
- [x] Re-run transcript/CLI regression, lint, typecheck, and diff checks.

## Review

- The ordering bug was in the active-turn streaming model, not in completed core-message ordering.
- `CliActiveTurn` previously stored only one `response` string, so once tool/runtime events appeared, all assistant text stayed glued above them.
- Fixed by introducing an explicit `responseBeforeRuntime` segment:
  - `src/cli/app/view-state.ts`
  - `src/cli/app/interaction-turn.ts`
  - `src/cli/app/use-cli-controller.ts`
  - `src/cli/transcript/model.ts`
- The controller now seals the current assistant response at the first visible tool/task runtime boundary, and subsequent streamed text renders below the runtime block.
- Added regressions for:
  - sealing an active turn at the runtime boundary
  - preserving assistant-before-tool-after ordering in `buildActiveItems`
  - keeping the wider transcript/UI suite green
- Verification passed:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/interaction-turn.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/ui-alignment.test.tsx`
  - `bunx eslint src/cli/app/view-state.ts src/cli/app/interaction-turn.ts src/cli/app/use-cli-controller.ts src/cli/transcript/model.ts tests/unit/cli/interaction-turn.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Transcript Projection Cleanup For Skill + AskUser

## Plan

- [x] Reproduce the two latest transcript bugs at the projection layer instead of guessing from controller state: duplicated `Skill` blocks and visible blocked-repeat `AskUserQuestion` chatter.
- [x] Add focused transcript regressions that pin both failures in `transcript-model` / `solidified-transcript`.
- [x] Fix the projection path cleanly in the transcript layer rather than adding more controller/runtime guards.
- [x] Re-run focused CLI transcript tests, lint, typecheck, and real `bun run dev` observation.

## Review

- Root cause 1: duplicated `Skill` output was a projection overlap, not a duplicate tool execution.
  - While runtime events were still visible, the active transcript could also render the same completed tool result again from unsolidified trailing `coreMessages`.
  - Fixed by deduping trailing `tool/task` transcript items when an equivalent runtime-backed item is already present:
    - `src/cli/transcript/model.ts`
    - `src/cli/hooks/use-solidified-transcript.ts`
- Root cause 2: the blocked second `AskUserQuestion` could still leak into the transcript through the paired runtime tool-event path.
  - The old hide logic only considered the end event’s own label/detail and missed the case where the paired start event was `AskUserQuestion` but the end label was generic like `Tool completed`.
  - Fixed by suppressing interaction-tool runtime pairs based on the paired start tool name, and by treating the internal “AskUserQuestion was just answered in this flow...” continuation notice as hidden control-plane output in both tool-result and runtime-event paths:
    - `src/cli/transcript/model.ts`
- Added transcript regressions for both bugs:
  - `tests/unit/cli/transcript-model.test.ts`
  - `tests/unit/cli/solidified-transcript.test.ts`
- Verification passed:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/ui-alignment.test.tsx`
  - `bunx eslint src/cli/transcript/model.ts src/cli/hooks/use-solidified-transcript.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - Real `bun run dev "我希望我们可以讨论下产品形态，ai的，你可以提供一些选项给我参考下，有单选，多选的，啥的"` was re-run and waited; this particular live run stalled for a long initial model phase, but the targeted transcript regressions and current projection code now cover the two reported visible-output failures directly.

# 2026-03-22 Inspect Claude Code AskUser Post-Submit Behavior

## Plan

- [x] Search `tmp/claude-code` for local `AskUserQuestion` references related to question flow, submit behavior, and post-answer handling.
- [x] Read the strongest local evidence in docs/examples/changelog to distinguish questionnaire submission from any subsequent task continuation.
- [x] Record whether the references imply “resume original task” vs “assistant summarizes answers first,” with concrete file citations.

## Review

- `tmp/claude-code` in this repo is a docs/examples/plugins repository, not the terminal UI implementation:
  - `tmp/claude-code/README.md`
- The strongest local references consistently treat `AskUserQuestion` as an inline data-collection step whose result is consumed immediately by the surrounding command/workflow:
  - `tmp/claude-code/plugins/plugin-dev/skills/command-development/references/interactive-commands.md`
  - `tmp/claude-code/plugins/plugin-dev/skills/plugin-settings/examples/create-settings-command.md`
  - `tmp/claude-code/plugins/hookify/commands/configure.md`
- The clearest wording is:
  - “Based on the answers received from AskUserQuestion” followed by processing and file generation
  - “After calling AskUserQuestion, verify answers received … If answers look correct: Process as expected”
  - confirmation flows end in “Proceed with setup” / “Save and apply” / “Execute setup steps”
- `tmp/claude-code/CHANGELOG.md` also says 2.0.55 “auto-submit single-select questions on the last question, eliminating the extra review screen for simple question flows,” which points toward immediate continuation after final selection rather than an added answer-summary turn.
- Conclusion:
  - the local Claude Code references imply that after questionnaire submission, UX should return to the original command/task flow and continue execution;
  - any summary belongs either inside an explicit confirmation step within the questionnaire itself or in the final task outcome, not as a standalone post-submit recap of answers.

# 2026-03-22 Live CLI Error Re-Verification

## Plan

- [x] Reproduce the reported `bun run dev` failure on the real Chinese prompt instead of relying on stale unit-test conclusions.
- [x] Compare fresh `createSession` / `createCodaraRuntime` runs against older `.codara/sessions/*` error checkpoints to determine whether the current code path still fails.
- [x] Inspect the latest live session logs and confirm whether the AskUser path completes cleanly or still throws middleware/runtime errors.
- [x] Record the corrected diagnosis here before touching more runtime code.

## Review

- The current live path no longer reproduces the earlier immediate `Transforms cannot be represented in JSON Schema` failure.
- Fresh runs now behave as:
  - `Thinking...`
  - streamed assistant preface
  - `AskUserQuestion`
  - rendered questionnaire review surface
- Verified with a real terminal run:
  - `bun run dev "我希望我们可以讨论下产品形态，ai的，你可以提供一些选项给我参考下，有单选，多选的，啥的"`
- Confirmed in the latest session log:
  - `.codara/sessions/5da1a414-8d45-44a0-8c53-80e1e6adc3ac/logs/2026-03-21.log`
  - turn 1 completed with `responseToolNames: ["AskUserQuestion"]`
  - `wrapToolCall` for `AskUserQuestion` succeeded
  - no middleware/runtime error was emitted in this fresh live run
- The older `Transforms cannot be represented in JSON Schema` evidence is still present in an earlier historical checkpoint:
  - `.codara/sessions/b88db176-20d0-4eae-8fc4-db18284596e8/checkpoints/latest.json`
  - but that is no longer representative of the current code path after the AskUser middleware/schema hardening work already in the tree.
- Conclusion:
  - do not keep “fixing” `TodoListMiddleware` based only on that stale checkpoint chain;
  - the current live bug report is resolved on the working tree, and further changes should focus on new live regressions only.

# 2026-03-22 Claude Code Free Interaction Control Plane

## Plan

- [x] Inspect the current prompt/review/task continuation flow and confirm whether the system is missing a simple prompt queue or a broader interaction control plane.
- [x] Identify where user input is hard-gated by `running` state versus where scoped queues already exist (`review`, task continuation).
- [x] Design a Claude Code-aligned interaction router that separates free user input from execution scheduling.
- [x] Map the new control plane onto current modules (`Codara`, CLI controller, bus/server, session runtime) without pushing prompt FIFO behavior into the agent loop.
- [x] Write the concrete implementation plan and migration path here before starting code changes.

## Notes

- Current state is not “no queue at all”; it is three partial mechanisms:
  - review queue via `review-control`
  - task completion continuation via `pendingTaskContinuationRef`
  - a hard `isRunningRef` / `Agent is currently running.` gate on new prompt or review resume attempts
- That means the missing abstraction is not a plain `prompt queue`. The missing abstraction is a unified `interaction router + scheduler`.
- Claude Code-style “free interaction” should mean:
  - user input is always accepted at the control-plane layer;
  - the system routes it by scope (`session`, `review`, `task`);
  - the scheduler decides `run now`, `interrupt`, `attach`, or `defer`;
  - the agent runtime stays a single execution engine instead of becoming a FIFO prompt worker.

## Review

- Implemented the first maintainable cut in the CLI control plane instead of patching more `Agent is currently running` guards:
  - `src/cli/app/use-cli-controller.ts` now owns a small scheduler model with explicit interaction kinds (`session_prompt`, `task_continuation`, `review_response`), pending interaction projection, and deferred drain behavior.
  - `session` prompts submitted while another stream is active are now accepted and drained after the active execution settles instead of being silently rejected.
  - task-scoped review submissions can also be deferred through the same scheduler while another foreground interaction is active.
- Prompt input is no longer globally disabled just because `runState.status === 'running'`:
  - `src/cli/app/shell-app.tsx` now derives prompt disabling from scope/focus (`blockingScope`, `inputTarget`, session picker), not from a raw running flag.
  - this keeps the main composer available during non-session-scoped work, which is the key Claude Code-aligned behavior.
- Kept the runtime side intentionally small for this round:
  - no bus/server transport rewrite yet;
  - no prompt FIFO pushed into `session` or `agent-loop`;
  - existing `streamInteraction`/`review-control` APIs remain sufficient for local CLI free interaction.
- Verification passed after the refactor:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/app/view-state.ts src/cli/app/shell-app.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 AskUser Submit Continuation And Single-Review Handoff

## Plan

- [x] Re-check the final AskUser/permission submit path and confirm whether dismissing the current review panel is the right strategy for avoiding multiple review/HIL header conflicts.
- [x] Keep the post-submit UI on the transcript/task surface while preserving a visible running state until the resume stream settles.
- [x] Align AskUser continuation semantics with the local Claude Code references so submit continues the original task instead of recapping questionnaire answers.
- [x] Re-run focused CLI/middleware verification and record any contract changes here.

## Review

- Confirmed the correct control-plane shape for the final focused review submit:
  - dismiss the current review panel immediately once a real resume payload exists;

# 2026-03-22 Task Subagent Support Layer Simplification

## Plan

- [x] Inspect the current `task/subagent` runtime and identify the safest high-value simplification seam after the recent frontend review refactors.
- [x] Avoid behavior changes to delegation itself; prefer a structural split that reduces mixed concerns before touching runtime semantics.
- [x] Split the old support bucket so task-run launch/recovery helpers and task-completion guard logic stop living in the same file.
- [x] Re-run focused task/subagent regression, eslint, typecheck, and diff-check.

## Review

- The highest-value next seam was `src/capability/task/task-tool-support.ts` because it mixed two unrelated concerns:
  - delegated task launch/run/recovery helpers
  - task-completion replay/memory guard logic
- That support bucket is now split into:
  - `src/capability/task/task-run-support.ts`
  - `src/capability/task/task-completion-guard.ts`
- `src/capability/task/task-tool.ts` now only imports launch/recovery support.
- `src/capability/task/middleware.ts` now imports the completion guard separately from the run-store rebinding support.
- This keeps behavior stable while making the next `task + subagents` cuts easier to reason about; the next likely seam is still `delegation.ts` or `runtime.ts`, but this cut removed the most obvious mixed-concern utility file first.
- Verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/capability/task/middleware.ts src/capability/task/task-tool.ts src/capability/task/task-run-support.ts src/capability/task/task-completion-guard.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`
  - suppress only that just-submitted review while hydrate/remove settles;
  - keep the foreground on the transcript/task surface with `runState: running` and `activeKind: review_response` until the resume stream actually finishes.
- Applied that same post-submit contract to both AskUser and single permission reviews in `src/cli/app/use-cli-controller.ts` instead of letting one flow drop to `done` immediately while the other stayed running.
- Tightened AskUser continuation semantics in `src/core/middleware/ask-user-question.ts`:
  - the tool description now instructs the model to continue the original task immediately after answers are collected;
  - resumed tool results now include explicit guidance telling the model not to restate the questionnaire or ask the same clarifications again.
- Added/updated regression coverage for:
  - keeping a running state visible while the final AskUser submit is still resuming;
  - keeping the submitted AskUser review dismissed while runtime removal settles;
  - keeping a single permission review dismissed while the delegated/background resume is still running;
  - preserving AskUser result parsing while carrying continuation guidance.
- Verification passed:
  - `bun test tests/unit/middleware/interaction-middleware.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/core/codara-commands.test.ts`
  - `bunx eslint src/core/middleware/ask-user-question.ts src/cli/app/use-cli-controller.ts src/cli/app/review-state.ts src/cli/components/conversation/review-panel.tsx src/cli/app/shell-app.tsx tests/unit/middleware/interaction-middleware.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/core/codara-commands.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

## Plan

- [x] Locate the Ask/clarification review entry points under `tmp/claude-code` and identify the files that own visible questionnaire UI, keyboard handling, and step-flow state.
- [x] Read the renderer/state/input code to extract the exact visible contract for question pages, review/submit pages, and any chat/freeform actions.
- [x] Capture notable styling/layout details that are explicit in code and answer whether question pages expose a separate chat action.
- [x] Add a short review note here with the concrete reference files inspected and any important constraints.

## Review

- `tmp/claude-code` does not include the Claude Code terminal UI source or app package that would implement the Ask/review renderer directly. The tree is a plugin/examples repository plus release notes.
- The only concrete AskUserQuestion contract visible in this tree comes from:
  - `tmp/claude-code/plugins/plugin-dev/skills/command-development/references/interactive-commands.md`
  - `tmp/claude-code/CHANGELOG.md`
  - `tmp/claude-code/README.md` (used only to confirm repository scope)
- Contract visible from those files:
  - question payload shape is `questions[]` with `question`, short `header`, `multiSelect`, and `options[{label, description}]`;
  - `Other` custom input is automatic;
  - expected authoring scale is 1-4 questions per call and 2-4 options per question;
  - single-select last-question flows can auto-submit instead of showing an extra review screen;
  - there is an AskUserQuestion dialog / preview dialog with an `Other` input field and notes input, plus `Ctrl+G` external-editor support;
  - VS Code supports multiline `Other` input with `Shift+Enter`.
- No file in `tmp/claude-code` exposes a separate `Chat about this` action on question pages, and no terminal renderer/input-state implementation is present in this tree to prove one exists.

# 2026-03-22 Claude Code AskUser Exact UI Re-Alignment

## Plan

- [x] Compare the current AskUser/review CLI flow against the real Claude Code reference material in `tmp/claude-code`, `docs/claude-code`, and the new screenshot correction.
- [x] Replace the old screenshot-only assumptions with explicit failing tests for the real mismatches: question-page `Next` is always present, question pages do not expose `Chat about this`, and submit/cancel stay isolated to the final page.
- [x] Refactor AskUser action generation, question-page footer state, and renderer output to match the corrected contract without keeping the obsolete chat-footer path.
- [x] Re-run focused and broad CLI verification, then document whether any AskUser/review cleanup remains.

## Review

- Real `bun run dev` verification exposed two live-only issues that the earlier test-only pass missed:
  - the review footer was still showing prompt hints (`Enter send ...`) instead of review navigation hints while AskUser owned input;
  - the AskUser question divider used a hard-coded width and wrapped into two lines in a real terminal.
- Fixed the live UI path without touching the excluded welcome behavior:
  - `src/cli/components/chrome/footer.tsx` now switches to review navigation hints when the active input target is `review`;
  - `src/cli/components/conversation/review-panel.tsx` now sizes the divider from the actual terminal width instead of hard-coding 98 columns;
  - `src/cli/app/shell-app.tsx` passes `inputTarget` into the footer and `terminalWidth` into the review panel;
  - reverted the earlier welcome-state filtering changes after the user explicitly said not to modify welcome logic.
- Tightened the AskUser control-plane contract at the middleware boundary so live model output cannot degrade the UI as easily:
  - `src/core/middleware/ask-user-question.ts` now instructs the model to keep AskUser to at most 4 questions with 12-character headers;
  - the middleware normalizes oversized questionnaires into that contract before they hit the CLI;
  - `tests/unit/middleware/interaction-middleware.test.ts` now locks the 4-question / short-label behavior.
- Live verification was re-run with a real `bun run dev` prompt and waited through the full model response until the AskUser review surface appeared.

## Design Notes

- The newest user-provided screenshot overrides the earlier approximation. For AskUser question pages, the source-of-truth contract is now:
  - review queue banner at top,
  - compact step strip,
  - question body with numbered options and a numbered `Type something.` row,
  - a standalone `Next` footer row on question pages,
  - no visible `Chat about this` row on question pages,
  - final page owns `Submit answers / Cancel`.
- `tmp/claude-code` in this repo is the required reference input for this pass, even when it is only docs/examples rather than a directly runnable UI package. The work must follow the visible/local contract, not the previous inferred one.

# 2026-03-22 Claude-Code AskUser Interaction Alignment

## Plan

- [x] Freeze the new CLI AskUser/review contract from the provided Claude Code screenshots and identify every live mismatch in rendering, navigation, and copy.
- [x] Add failing CLI tests that encode the target interaction shape: horizontal step strip, dedicated `Submit` review step, persistent `Chat about this`, question-first layout, and no legacy action/answer sections.
- [x] Refactor the review renderer and input state machine to the new contract without keeping obsolete compatibility branches or teams/HIL-era wording.
- [x] Re-run focused CLI verification, then document the resulting contract and cleanup decisions.

## Design Notes

- The screenshot is the source of truth for this round. The target is not “similar”; it is the Claude Code AskUser interaction model rendered in Ink.
- The review surface stays a single floating window with:
  - top title row and optional skill/runtime header,
  - horizontal step strip with back/forward arrows,
  - one active question body at a time,
  - numbered options plus descriptions,
  - a dedicated final `Submit` step,
  - a persistent bottom `Chat about this` action,
  - footer hints in Claude Code order/copy style.
- Old compatibility UI is not allowed to survive:
  - no `Actions` section heading,
  - no extra `Answer`/`Custom answer` framing when not visible in the target,
  - no mixed legacy HIL wording,
  - no split “inline vs floating” behavior differences for AskUser semantics.

## Review

- Added screenshot-driven regression coverage in:
  - `tests/unit/cli/components/conversation/review-panel.test.tsx`
  - `tests/unit/cli/review-state.test.ts`
  - `tests/unit/cli/review-input.test.ts`
  - `tests/unit/cli/use-cli-controller.test.tsx`
- Reworked the AskUser CLI interaction contract to match the Claude Code design and the project-local `docs/claude-code` guidance:
  - question pages now render plain numbered select rows, checkbox-style multiselect rows, a numbered `Type something.` custom-entry row, and a stable bottom `Chat about this` action;
  - selection and progression are no longer coupled: `Enter` on question content activates the current answer only, while `Next` is a separate footer action;
  - `Submit` is now a dedicated final step with numbered `Submit answers` and `Cancel` actions plus incomplete-answer warning copy;
  - free-text custom answers can now accept spaces while editing instead of treating every space as a selection toggle.
- Removed stale control-plane residue from the live path:
  - AskUser form input types no longer advertise `mixed`;
  - `AskUserQuestion` now includes an explicit `cancel` action in its review action set;
  - `ReviewPanel` no longer keeps the dead `inline | floating` AskUser rendering fork; the CLI now uses one review surface contract;
  - CLI tests and copy no longer refer to old `HIL review overlay`/action-bar wording for this flow.
- Focused verification passed:
  - `bun test tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/core/codara-facade.test.ts --test-name-pattern "AskUser|review|interaction|floating|blockingScope|questionnaire|ReviewPanel"`
  - `bunx eslint src/shared/contracts/agent-types.ts src/core/middleware/ask-user-question.ts src/cli/components/conversation/review-panel.tsx src/cli/app/review-state.ts src/cli/hooks/use-review-input.ts src/cli/app/use-cli-controller.ts src/cli/app/shell-app.tsx tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Fix Duplicate Compact Error While Agent Is Running

## Plan

- [x] Reproduce and lock the duplicate `/compact` running-state error with a focused regression test.
- [x] Remove the duplicate error source by treating compact precondition failures as fast-fail guards instead of started summary operations.
- [x] Re-run targeted command/session verification to confirm `/compact` now reports a single failure path.

## Review

- Root cause: `src/durability/session/session.ts` started a summary runtime event before checking whether compaction was even allowed to start. When `/compact` was invoked during an active run, the session emitted `summary start` + `summary error`, then the slash command returned the same `Agent is currently running.` failure again, which produced duplicate user-facing error surfaces.
- Added a focused regression in `tests/unit/core/codara-commands.test.ts` that holds the agent in a running state, executes `/compact`, and asserts two things:
  - the command returns a single `Agent is currently running.` failure;
  - no `summary` runtime events are emitted for that precondition path.
- Fixed the control-plane bug by moving `runtimeEvents.summaryStarted('Compacting context')` behind the compact precondition guards in `src/durability/session/session.ts`. Precondition failures now fast-fail without emitting summary lifecycle events.
- Verification passed:
  - `bun test tests/unit/core/codara-commands.test.ts --test-name-pattern "compact|single running-state error"`
  - `bun test tests/unit/core/codara-session-runtime.test.ts --test-name-pattern "compact|summary"`
  - `bunx eslint src/durability/session/session.ts tests/unit/core/codara-commands.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Review Current Branch Vs Origin/Main

## Plan

- [ ] Snapshot the review scope by diffing the current branch against `origin/main` and identifying the refactor/fixup files involved.
- [ ] Inspect the changed runtime, task/subagent, and review-control code for concrete bugs, regressions, and incorrect assumptions.
- [ ] Inspect the changed tests to verify the new behavior is actually covered and note any meaningful gaps.
- [ ] Record concrete review findings with severity, file paths, and reasoning only.

# 2026-03-21 Task/Subagent Control Plane Refactor

# 2026-03-22 Scoped Review Blocking And Input Routing

# 2026-03-22 Final Verification Fixups Before PR

# 2026-03-22 Inspect Review Panel Dismissal After Final Submit

## Plan

- [x] Read only the minimum relevant CLI review-flow files (`use-cli-controller`, `review-state`, `review-panel`, `view-state`).
- [x] Trace the final-submit path to determine whether immediately dismissing the focused review panel is the correct way to avoid duplicate review/HIL headers.
- [x] Identify which state, if any, should remain visible while the resume stream is still settling after submit.
- [x] Record concrete recommendations with file references in the response and add a short review note here.

## Review

- Current controller behavior already points to the right split:
  - when the submitted review is the only/final focused review, it immediately hides that review (`setReview(undefined)`) and marks its id in `settlingDismissedReviewIdRef` before starting the resume stream;
  - when more reviews remain queued, it keeps the current review visible-but-busy until the queue handoff finishes, then swaps to the next projected review.
- Recommendation:
  - yes, immediately dismissing the focused panel after final submit is the right way to avoid duplicate foreground review/HIL headers for the last review in the queue;
  - while the resume stream settles, the visible foreground should be the normal transcript/task surface with a running assistant turn / resume placeholder, not the submitted review shell or its header.
- Key references:
  - `src/cli/app/use-cli-controller.ts:396-420`
  - `src/cli/app/use-cli-controller.ts:1141-1181`
  - `src/cli/app/use-cli-controller.ts:1183-1223`
  - `src/cli/app/use-cli-controller.ts:277-288`
  - `src/cli/app/use-cli-controller.ts:384-392`
  - `src/cli/components/conversation/review-panel.tsx:20-35`

## Plan

- [x] Re-run the final targeted verification gate before pushing the active branch.
- [x] Fix the remaining post-refactor regressions surfaced by that gate instead of pushing through known failures.
- [x] Re-run tests, typecheck, lint, and diff checks with fresh evidence after the fixes.

## Review

- The final verification gate surfaced one real CLI case regression plus two lingering type mismatches:
  - `tests/cases/task-skills/task-skill-coordination.case.test.ts` still asserted the older `✓ Agent: ...` transcript string, while the current CLI output contract on this branch renders delegated child rows as `Agent(...)`.
  - `src/capability/task/task-tool.ts` still used the removed Zod `required_error` option instead of the current `error` form.
  - `src/durability/approval-store.ts` still called `persist(next, existing)` after the file-store helper had already been simplified to a single-argument signature.
- Applied the minimal root-cause fixes:
  - aligned the task-skill CLI case expectation with the current delegated child transcript contract;
  - updated the task tool schema to the current Zod option shape;
  - removed the stale extra `persist(...)` argument.
- Fresh verification passed:
  - `bun test tests/cases/task-skills/task-skill-coordination.case.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/tasks/middleware.test.ts tests/unit/skills/subagents.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts tests/cases/task-skills/task-skill-coordination.case.test.ts`
  - `bunx eslint src/capability/task/task-tool.ts src/durability/approval-store.ts tests/cases/task-skills/task-skill-coordination.case.test.ts`
  - `git diff --check`

## Plan

- [x] Add explicit review blocking scope to the review control plane so delegated task reviews stop inheriting session-wide blocking semantics.
- [x] Project blocking scope into CLI review state and replace the old `hasReview => block prompt` shortcut with an explicit `inputTarget`.
- [x] Keep task-scoped reviews visible without disabling main prompt input, while session-scoped foreground pauses still force review input.
- [x] Verify the new scoped review semantics across runtime projection, shell gating, controller behavior, and review UI fixtures.

## Review

- `src/codara/types.ts` now exposes `ReviewBlockingScope`, and `ReviewQueryItem` now carries `blockingScope`. The review assembly in `src/codara/assembly/reviews.ts` assigns delegated task-run reviews to `task` scope and foreground session pauses to `session` scope.
- CLI review state is now explicit about blocking semantics and input ownership:
  - `src/cli/app/view-state.ts` adds `blockingScope` to `CliReviewState` and introduces `CliInputTarget`.
  - `src/cli/app/runtime-projection.ts` copies `blockingScope` from review queries into the active CLI review projection.
  - `src/cli/app/use-cli-controller.ts` now owns `inputTarget`, forces `session`-scoped reviews into review input, leaves `task`-scoped reviews on the main prompt by default, and provides explicit review/prompt focus actions instead of treating any review as a global lock.
- CLI shell gating now follows scoped review semantics in `src/cli/app/shell-app.tsx`:
  - prompt visibility is tied to `blockingScope === 'session'`, not mere review presence;
  - prompt input and review input are routed by `inputTarget`, not by `hasReview`.
- The input hooks now support explicit review focus switching:
  - `src/cli/hooks/prompt-input-action.ts` and `src/cli/hooks/use-prompt-input.ts` add a prompt-side review focus action;
  - `src/cli/hooks/use-review-input.ts` adds the inverse input-target toggle for non-session-scoped reviews.
- Focused verification passed:
  - `bun test tests/unit/cli/review-state.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/active-tasks.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/codara/types.ts src/codara/index.ts src/codara/facade.ts src/codara/assembly/reviews.ts src/cli/app/view-state.ts src/cli/app/runtime-projection.ts src/cli/app/review-state.ts src/cli/hooks/prompt-input-action.ts src/cli/hooks/use-prompt-input.ts src/cli/hooks/use-review-input.ts src/cli/app/use-cli-controller.ts src/cli/app/shell-app.tsx tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts`
  - `rg -n "return !input\\.review|interactive: !hasReview|disabled: hasReview|blockingScope: 'session'|blockingScope: 'task'|inputTarget" src tests -g'*.ts*'`
  - `git diff --check`
- A full `bunx tsc --noEmit` still fails on unrelated pre-existing repository issues:
  - `src/capability/task/task-tool.ts` zod overload mismatch (`required_error`)
  - `src/desktop/features/docs/ui/DocsPage.tsx` missing `StatusPill`
  - `src/durability/approval-store.ts` argument count mismatch

# 2026-03-21 Unified Interaction Stream Refactor

## Plan

- [x] Audit the remaining public interaction-stream entry points across `Codara` facade and CLI controller.
- [x] Introduce one facade-level interaction stream contract that covers prompt, task-completion continuation, pause resume, and approval resume.
- [x] Extract approval queue/focus orchestration out of `src/codara/facade.ts` so stream routing and approval control stop living inline in the facade.
- [x] Switch the CLI controller to consume the unified interaction stream surface instead of stitching together `stream`, `resumePauseStream`, and `resumeApprovalStream` directly.
- [x] Re-run focused facade/controller verification and record the result here.

## Review

- `src/codara/types.ts` now defines a single `CodaraStreamRequest` union for prompt, continuation, pause, and approval interactions. The top-level `Codara` facade exposes `streamInteraction(...)` as the unified outward stream contract.
- `src/codara/facade.ts` is thinner. Approval queue focus, review lookup, and task-approval resume behavior were extracted into `src/codara/approval-control.ts`, while stream routing now lives in `src/codara/interaction-stream.ts`.
- The CLI controller no longer stitches together three different streaming entry points. `src/cli/app/use-cli-controller.ts` now routes prompt submission, task-completion continuation, and HIL resume through `codara.streamInteraction(...)`, which aligns the public interaction model with a single LangChain-style stream surface.
- Focused verification passed:
  - `bun test tests/unit/core/codara-facade.test.ts`
  - `bun test tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx eslint src/codara/types.ts src/codara/facade.ts src/codara/approval-control.ts src/codara/interaction-stream.ts src/cli/app/use-cli-controller.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `git diff --check`

# 2026-03-21 CLI Controller Projection Flattening

## Plan

- [x] Extract reusable interaction-stream chunk projection helpers out of `use-cli-controller`.
- [x] Centralize CLI approval/HIL synchronization helpers to reduce repeated runtime-projection logic.
- [x] Add focused unit coverage for the new CLI interaction helpers and rerun targeted verification.

## Review

- `src/cli/app/interaction-turn.ts` now owns the LangChain-style chunk-to-turn projection logic:
  - reasoning/thinking extraction;
  - streaming token aggregation;
  - Task launch markers;
  - text append behavior for normal prompt streams and resume streams.
- `src/cli/app/runtime-projection.ts` now owns CLI-side approval projection:
  - current approval summaries;
  - foreground pause resolution;
  - HIL review synchronization and approval index/count metadata.
- `src/cli/app/use-cli-controller.ts` is flatter. The controller still coordinates lifecycle and user actions, but it no longer manually repeats chunk parsing or approval projection in multiple branches.
- Focused verification passed:
  - `bun test tests/unit/cli/interaction-turn.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/app/interaction-turn.ts src/cli/app/runtime-projection.ts tests/unit/cli/interaction-turn.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `git diff --check`

# 2026-03-21 CLI Review Panel Alignment

## Plan

- [x] Re-check the current CLI foreground-surface rules for `task/subagent` hierarchy versus HIL/AskUser review rendering.
- [x] Propose a single review-panel model where approval, permission, and AskUser share one placement without replacing the task/subagent mainline.
- [x] After approval, align implementation and verification around the unified review-panel behavior.

## Review

- The public control plane is now `review`-first instead of `approval`-first:
- `src/codara/review-control.ts` owns focused review selection plus resume behavior for both delegated task approvals and foreground session pauses.
  - `src/codara/assembly/reviews.ts` projects queued delegated approvals and foreground session pauses into one `ReviewQueryItem` list with `kind`, `interactionMode`, and execution anchors.
  - `src/codara/types.ts` now exposes `listReviewItems()`, `getFocusedReview()`, `focusReview()`, `resumeReview()`, and `CodaraReviewStreamRequest`.
- CLI projection now consumes the unified review control plane:

# 2026-03-22 Inspect Live AskUser Trigger Path In bun run dev

## Plan

- [x] Map the real `bun run dev` runtime entrypoint and locate the live `AskUserQuestion` trigger path outside tests.
- [x] Trace system prompt assembly, middleware, and tool registration to confirm where `AskUserQuestion` is available and how the model is instructed to use it.
- [x] Reproduce the likely decision path for the reported Chinese prompt and identify why a normal assistant reply can stream instead of the AskUser flow.
- [x] Record the exact files, root-cause evidence, and any verification gaps in the review section below.

## Review

- Live `bun run dev` path is the default CLI runtime, not a test-only shim:
  - `package.json` runs `bun --watch src/cli/main.tsx`.
  - `src/cli/main.tsx` calls `createCodaraRuntime(...)` unless `CODARA_CLI_RUNTIME_FACTORY` overrides it.
  - `src/codara/facade.ts` builds prompt/guideline sources, runtime tools, runtime middlewares, and the session-backed facade.
- In the stock runtime, `AskUserQuestion` is available:
  - `src/codara/assembly/middleware.ts` injects `createAskUserQuestionMiddleware()` whenever `options.hil !== false`.
  - `src/core/middleware/ask-user-question.ts` contributes the actual `AskUserQuestion` structured tool.
  - Verified in a real runtime bootstrap with `bun -e`: `runtime.getAvailableToolNames()` includes `["AskUserQuestion","Task"]`.
- The system prompt path is live:
  - `src/context/prompts/prompt-source.ts` loads `.codara/codara.md`.
  - `src/context/instructions/guidelines.ts` loads `AGENTS.md`.
  - `src/context/session-bundle/base-system-message.ts` merges both into the system message bundle.
  - `src/durability/session/session.ts` reloads and reapplies that bundle when bootstrapping/preparing turns.
- The actual AskUser trigger path in live runtime is:
  - user prompt enters `session.stream(...)`;
  - `src/core/agent/run/agent-loop.ts` binds model tools via `model.bindTools(tools)`;
  - if the model emits an `AskUserQuestion` tool call, `src/core/agent/run/turn.ts` executes it through middleware;
  - `src/core/middleware/ask-user-question.ts` turns that tool call into an HIL pause with `interaction-center` form UI;
  - `src/codara/assembly/reviews.ts` classifies that pause as `ask_user`;
  - `src/cli/components/conversation/review-panel.tsx` renders the AskUser review UI.
- Most likely root cause #1: there is no hard enforcement when the model chooses plain text instead of the tool.
  - `src/core/agent/run/agent-loop.ts` only binds tools; it does not force `tool_choice`.
  - `src/core/agent/run/turn.ts` treats any model response without `tool_calls` as a completed assistant turn.
  - There is no AskUser-specific `afterModel` / `wrapModelCall` validator that detects “the user asked for options but the model answered normally” and retries or fails the turn.
- Most likely root cause #2: the handbook and the tool description do not align tightly enough for this prompt shape.
  - `.codara/codara.md` says AskUser must be used when the user explicitly asks for choices.
  - `src/core/middleware/ask-user-question.ts` describes the tool mainly as “request structured user input before the agent continues” when requirements/scope are missing.
  - For a prompt like `我希望我们可以讨论下产品形态...你可以提供一些选项...有单选，多选的`, the model can plausibly interpret the request as “brainstorm and present options” instead of “pause and ask the user a structured questionnaire”, especially because the stronger “must use tool for options” rule exists only in the handbook text, not in runtime enforcement.
- Likely non-root-cause: missing middleware or missing UI wiring in stock `bun run dev`.
  - The stock path has the handbook, AGENTS, AskUser middleware, tool registration, HIL pause conversion, review classification, and AskUser renderer all wired.
  - The only stock-path caveat is `CODARA_CLI_RUNTIME_FACTORY`: if that env var is set, an external runtime factory can bypass the default wiring. I did not inspect any external factory module because none is part of the repo path itself.
  - `src/cli/app/runtime-projection.ts` reads `ReviewQueryItem[]` instead of task-only approval summaries.
  - `src/cli/hooks/use-active-tasks.ts` uses review anchors to attach delegated reviews back onto task runs without treating review as a separate execution lane.
  - `src/cli/app/use-cli-controller.ts` now focuses and resumes reviews through the unified review API.
- `task/subagent` hierarchy stays primary in the shell:
  - `src/cli/app/shell-app.tsx` no longer treats active review as a separate foreground surface; transcript remains the mainline while the floating review panel stays attached.
  - Review/Ask/permission still share one panel placement, but no longer replace the execution tree.
- The runtime bus now resumes through the unified review stream path in `src/bus/bus.ts`, so outer transport is no longer tied only to `resumePauseStream`.
- Focused verification passed:
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/ui-alignment.test.tsx`
  - `bunx eslint src/codara/types.ts src/codara/facade.ts src/codara/review-control.ts src/codara/interaction-stream.ts src/codara/assembly/reviews.ts src/cli/app/runtime-projection.ts src/cli/app/use-cli-controller.ts src/cli/app/shell-app.tsx src/cli/hooks/use-active-tasks.ts src/bus/bus.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/ui-alignment.test.tsx`
  - `git diff --check`

## Plan

- [x] Re-assess the current `task/subagent` architecture without preserving old layering by default, focusing on where the current control plane is over-nested or over-centralized.
- [x] Settle the refactor boundary for this round: remove teams-era compatibility paths and flatten the control plane instead of preserving old aliases or layered wrappers.
- [x] Split the old `src/capability/task/middleware.ts` monolith into thinner units for tool assembly, prompting, and delegation support.
- [x] Remove live `teams` configuration residue and align end-to-end task/subagent cases with detached delegation semantics.
- [x] Re-run focused and broader task/subagent verification after the refactor.

## Review

- `src/capability/task/middleware.ts` is now a thin assembly layer. The old mixed responsibilities were split into:
  - `src/capability/task/task-tool.ts` for the `Task` tool contract and launch path;
  - `src/capability/task/task-tool-support.ts` for recovery, child activity tracking, tool filtering, and run-store helpers;
  - `src/capability/task/task-prompting.ts` for system-message injection and completion handoff;
  - `src/capability/task/tool-types.ts` for task middleware/tool option contracts.
- Base child delegation is now fully explicit as the runtime-owned `Agent` path. `Task` no longer advertises “omit subagent_type for the default child”; live prompts, schemas, and case fixtures now require or demonstrate explicit `subagent_type: "Agent"` for the baseline child. Named skills profiles stay in the skills runtime, and the only remaining `general-purpose` references are negative tests plus the reserved-name guard in `src/context/skills/runtime-shared.ts`.
- The real CLI/task cases now match the flattened runtime model:
  - mixed `TaskCreate` + multiple `Task` calls in one parent response are covered by unit tests;
  - the multi-profile real-CLI case now expects detached behavior instead of a fake post-launch `PARENT_DONE` response;
  - reserved default-profile override files are ignored in the real-CLI prompt inheritance case.
- `.codara/settings.json` no longer carries the dead `teams.enabled` flag.
- Verification passed:
  - `bun test tests/unit/skills/subagents.test.ts tests/unit/agents/task-tool-errors.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/core/codara-facade.test.ts`
  - `bun test tests/unit/agents/subagent-task.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/observability/events-formatters.test.ts tests/cases/hil/subagent-activity-display.case.test.ts`
  - `bunx eslint src/context/skills/runtime-shared.ts src/capability/skill/runtime/runtime.ts src/capability/task/middleware.ts src/capability/task/task-tool.ts src/capability/task/task-tool-support.ts src/capability/task/task-prompting.ts src/capability/task/tool-types.ts src/shared/tool-display.ts src/observability/events/formatters.ts src/observability/events/controller.ts src/cli/transcript/model.ts tests/unit/skills/subagents.test.ts tests/unit/agents/task-tool-errors.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `git diff --check`

# 2026-03-21 Task-Only Runtime Cleanup

## Plan

- [x] Remove remaining task/subagent prompt and runtime compatibility paths that still expose old `general-purpose` and `team` era semantics instead of the current task-only model.
- [x] Normalize the default delegated child flow so runtime labels, prompt injection, and observability treat it as the default `Agent` path while keeping `general-purpose` only as a backward-compatible input alias.
- [x] Delete live prompt instructions that still advertise Team workflows and align project guidance to the current task/subagent model.
- [x] Re-run focused task/subagent/CLI/runtime verification and document the result in this review section.

## Review

- The live handbook and worker prompt surface is now task-only. `.codara/codara.md` no longer advertises Team Collaboration workflows, and the superworker prompt templates now describe the default Task path as “default delegate; omit subagent_type” instead of instructing callers to use a fake `general-purpose` profile.
- Default delegated children now resolve to a consistent display/runtime identity: `Agent`. The compatibility alias `general-purpose` still exists only in runtime parsing and loader guards (`src/context/skills/runtime-shared.ts`, `src/capability/skill/runtime/runtime.ts`) so old callers keep working, but it no longer leaks into launch labels, observability pre-registration, task middleware guidance, or transcript display.
- `src/capability/task/middleware.ts`, `src/shared/tool-display.ts`, `src/observability/events/formatters.ts`, `src/observability/events/controller.ts`, `src/capability/task/delegation.ts`, and `src/cli/transcript/model.ts` now share the same default semantics:
  - omit `subagent_type` for the default child;
  - display that child as `Agent`;
  - reserve named profiles for skills-defined roles such as `Explore` and `Plan`;
  - keep subagents single-layer with no Team-era orchestration path.
- Focused tests were updated to lock the new default-path semantics in runtime summaries, launch artifacts, CLI projections, and middleware prompt injection.
- Verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/cli/transcript-model.test.ts`
  - `bunx eslint src/context/skills/runtime-shared.ts src/capability/task/middleware.ts src/capability/task/delegation.ts src/shared/tool-display.ts src/observability/events/formatters.ts src/observability/events/controller.ts src/cli/transcript/model.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/active-tasks.test.ts`
  - `git diff --check`

# 2026-03-21 Builtin Agent Prompt Enrichment

## Plan

- [x] Inspect the current builtin `Explore` / `Plan` prompts against the richer Claude/OpenClaw-style reference under `/private/tmp/openclaw`.
- [x] Expand the builtin named subagent prompts so they carry stronger delegation boundaries, output expectations, and execution guidance without reintroducing a skills-owned `general-purpose` default.
- [x] Add regression coverage that locks the richer prompt contract while preserving tool filtering and the default `general-purpose` inheritance path.
- [x] Re-run focused skills/task/subagent verification and document the final prompt model in this review section.

## Review

- I verified the user-provided reference path by tracing `/tmp` to `/private/tmp` and inspecting `/private/tmp/openclaw`. The most useful local reference was `/private/tmp/openclaw/skills/coding-agent/SKILL.md`, which carries stronger delegated-agent discipline around execution mode, ownership boundaries, and progress reporting. There was no drop-in `Explore` / `Plan` prompt to copy verbatim, so I adapted the structure rather than blindly importing text.
- `.codara/skills/builtin-agents/agents/Explore.md` is now a real delegated-child contract instead of a one-line persona. It explicitly states that the child is running in a fresh child session, must stay read-only, must not delegate further, should ground conclusions in repo evidence, and should return concise findings with evidence and open questions.
- `.codara/skills/builtin-agents/agents/Plan.md` now does the same for planning work: fresh child session, read-only, no further delegation, fact-vs-assumption separation, simple actionable sequencing, and a default plan output shape including trade-offs and verification.
- `.codara/skills/builtin-agents/SKILL.md` now explains the real contract of builtin named profiles: they exist to define child-session boundaries and reporting expectations, while `general-purpose` remains runtime-owned and must not be recreated inside skills.
- `tests/unit/skills/subagents.test.ts` now locks the richer builtin prompt model by asserting that `Explore` and `Plan` include child-session semantics and “do not delegate further” guidance, while the default `general-purpose` path still resolves to an empty inherited prompt.
- Verification passed:
  - `bun test tests/unit/skills/subagents.test.ts tests/unit/agents/task-tool-filtering.test.ts tests/unit/tasks/middleware.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `bunx eslint src/context/skills/runtime-shared.ts tests/unit/skills/subagents.test.ts`
  - `git diff --check`

# 2026-03-21 Task And Subagent Runtime Simplification

## Plan

- [x] Make the default `general-purpose` subagent profile inherit the main-agent baseline instead of loading a separate skills prompt, while keeping named profiles like `Explore` / `Plan` on the skills path.
- [x] Persist and expose explicit `parentSessionId` metadata for delegated task runs so child execution lineage is readable without inferring it from other fields.
- [x] Keep delegated children single-level by locking tests around “subagents cannot dispatch again” and tightening any runtime/profile edges that still imply nested delegation.
- [x] Re-run focused task/subagent/runtime suites, fix regressions, and document the final behavior in this review section.

## Review

- `src/context/skills/runtime-shared.ts` now treats `general-purpose` as a true built-in default profile. It always resolves to an empty system prompt that inherits the main-agent baseline, instead of consuming a skills-defined override.
- `src/capability/skill/runtime/runtime.ts` now skips `general-purpose` files while loading skills/subagent definitions. Named profiles such as `Explore` and `Plan` still come from the skills filesystem, but the default delegate no longer has a second management path.
- `src/capability/task/types.ts`, `src/capability/task/run-store.ts`, `src/capability/task/runtime.ts`, `src/shared/task-run-launch.ts`, `src/codara/types.ts`, and `src/codara/assembly/task-runs.ts` now persist and expose explicit `parentSessionId` metadata for delegated runs and launch artifacts.
- `src/capability/task/middleware.ts` now explains the profile split more clearly in the tool schema and injected prompt text: omit `subagent_type` for the default inherited delegate, use named profiles only when you want a skills-defined role.
- The builtin agents skill surface was simplified:
  - `.codara/skills/builtin-agents/agents/general-purpose.md` was removed.
  - `.codara/skills/builtin-agents/SKILL.md` now documents only named profiles because the default delegate is runtime-owned.
- Focused regression coverage now locks the intended behavior:
  - default `general-purpose` ignores skills overrides and inherits the main-agent baseline;
  - delegated runs and launch artifacts carry `parentSessionId`;
  - delegated children remain single-level because delegation tools are removed from child tool surfaces;
  - real CLI prompt inheritance still exposes project/system instructions inside delegated children even when a `general-purpose` skill file exists.
- Verification passed:
  - `bun test tests/unit/skills/subagents.test.ts tests/unit/tasks/run-store.test.ts tests/unit/agents/subagent.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/task-tool-limits.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `bunx eslint src/context/skills/runtime-shared.ts src/capability/skill/runtime/runtime.ts src/capability/task/types.ts src/capability/task/run-store.ts src/capability/task/runtime.ts src/shared/task-run-launch.ts src/capability/task/middleware.ts src/codara/types.ts src/codara/assembly/task-runs.ts tests/unit/skills/subagents.test.ts tests/unit/tasks/run-store.test.ts tests/unit/agents/subagent.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/agents/task-tool-limits.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `git diff --check`

# 2026-03-21 Full Team Surface Removal And Task-Subagent Alignment

## Plan

- [x] Replace obsolete team-centric tests with coverage that matches the current model: `Task` for delegated work, `TaskCreate/Update/List` for shared coordination, and `subagent` for execution profiles.
- [x] Remove remaining `team` branches from CLI transcript logic so the main transcript only reasons about assistant output, tool output, delegated task runs, HIL, and commands.
- [x] Remove leftover `team` runtime/event/bus/public typing that no longer corresponds to any live implementation.
- [x] Re-run targeted task/CLI/runtime suites, fix regressions, then repeat the search for `team` residues until only intentional third-party payload fields remain.

## Review

- `src/cli/transcript/model.ts` no longer carries team-specific suppression or summary paths. Active transcript rendering now reasons only about assistant output, tool output, delegated task runs, HIL, and commands.
- `src/observability/events/types.ts` and `src/bus/types.ts` no longer expose `team` runtime/event kinds or member/team bus events, so the runtime event surface now matches the delegated-task architecture.
- The stale test surface was rewritten to the current model:
  - `tests/unit/config/settings.test.ts` now covers plugin/memory settings instead of removed `teams.enabled`.
  - `tests/unit/agents/tool-execution.test.ts` now verifies generic same-turn context propagation instead of removed team tools.
  - `tests/unit/cli/use-cli-controller.test.tsx`, `tests/unit/hil-unified/hil-unified.test.ts`, `tests/unit/core/codara-commands.test.ts`, and `tests/unit/core/codara-facade.test.ts` no longer import or assert deleted team APIs.
  - Related transcript/shared-task tests were renamed or adjusted so they no longer preserve obsolete team-only vocabulary.
- Additional sample-value cleanup removed incidental test-only `team` strings from gateway and Telegram fixtures, so the residual search no longer conflates product leftovers with arbitrary test data.
- Verification passed:
  - `bun test tests/unit/config/settings.test.ts tests/unit/agents/tool-execution.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/hil-unified/hil-unified.test.ts tests/unit/core/codara-commands.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/tasks/shared-tools.test.ts`
  - `bun test tests/unit/gateway/router.test.ts tests/unit/channel/telegram/polling.test.ts`
  - `bunx eslint src/bus/types.ts src/observability/events/types.ts src/cli/transcript/model.ts tests/unit/config/settings.test.ts tests/unit/agents/tool-execution.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/hil-unified/hil-unified.test.ts tests/unit/core/codara-commands.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/tasks/shared-tools.test.ts tests/unit/gateway/router.test.ts tests/unit/channel/telegram/polling.test.ts`
  - `git diff --check`
- Final residual search now finds only `src/integration/channel/slack/types.ts:17` with `team_id`, which is an intentional Slack payload field rather than an internal teams feature surface.

# 2026-03-21 Teams Residual Cleanup And Task/Subagent Boundary Fix

## Plan

- [x] Review the desktop changes already in the worktree so the remaining cleanup does not conflict with them.
- [x] Remove runtime and CLI `teams` residuals that are still part of the public/current surface, especially approval-source typing and header remnants.
- [x] Remove the stale `teamSurface/teamContext` gating from shared task coordination so `TaskCreate/TaskUpdate/TaskList` reflect the current no-teams architecture.
- [x] Update focused unit tests around task tools, approvals, and CLI chrome.
- [x] Run targeted verification for the touched files and document any unrelated pre-existing failures.

## Review

- Desktop cleanup from the delegated worker was kept and verified locally: `TeamsPage` is deleted, desktop navigation no longer exposes `teams`, and desktop runtime event typing/status text no longer includes `team`.
- `src/capability/task/tools.ts` now treats `TaskCreate/TaskUpdate/TaskList` strictly as shared coordination tools. The old `teamSurface/teamContext` branch that converted results into internal team-only artifacts is gone, so delegated task semantics and shared-task semantics are no longer mixed.
- `src/durability/approval-store.ts`, `src/codara/types.ts`, and `src/codara/assembly/approvals.ts` now expose only `task_run` approvals. The stale `team_member` approval model, indexes, and query fields were removed.
- `src/cli/components/chrome/header.tsx` no longer advertises active team counts, and outdated `TeamMiddleware` / `team worker` references were removed from shared runtime comments/constants.
- Focused verification passed:
  - `bun test tests/unit/tasks/shared-tools.test.ts tests/unit/durability/approval-store.test.ts tests/unit/cli/chrome.test.ts tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/capability/task/tools.ts src/durability/approval-store.ts src/codara/types.ts src/codara/assembly/approvals.ts src/cli/components/chrome/header.tsx src/core/pipeline/types.ts src/core/agent/bootstrap.ts src/durability/session/store.ts src/durability/session/types.ts src/desktop/App.tsx src/desktop/components/Chat.tsx src/desktop/components/Sidebar.tsx src/desktop/types.ts tests/unit/tasks/shared-tools.test.ts tests/unit/durability/approval-store.test.ts tests/unit/cli/chrome.test.ts tests/unit/cli/shell-app.test.ts`
- Remaining high-signal `team` residues still exist in `src/cli/transcript/model.ts`, `src/observability/events/types.ts`, and `src/bus/types.ts`, plus older team-centric tests. They are no longer on the critical path for `task/subagent` semantics, but they still need a later cleanup pass if the goal is zero `team` runtime surface.

# 2026-03-21 Docs Cleanup After Teams Removal

## Plan

- [x] Confirm current `main` already contains the teams runtime removal and restrict this task to docs/task records only.
- [x] Update `ARCHITECTURE.md` and `docs/architecture/01-global-architecture-overview.md` to remove `team/teams` as a current capability and reflect the remaining `task/subagent` model.
- [x] Update `README.md` so the public overview matches the current runtime capabilities.
- [ ] Verify the edited docs with targeted searches, then commit on a feature branch and prepare PR/merge state.

## Review

- `main` already contains commit `ccd341b refactor(teams): 移除 Teams 功能，精简 CLI 和转录逻辑`, so this round was scoped to documentation cleanup rather than more runtime deletion.
- Updated the tracked public docs to remove `team/teams` as a current capability:
  - `ARCHITECTURE.md`
  - `README.md`
- In architecture docs, removed the `team` subdomain, `team` middleware, `teams-api.ts`, team UI directory references, and team-specific event/collaboration descriptions.
- In README, rewrote the capability summary and core-mechanism section so current collaboration is described as task delegation / delegated subagents only.

# 2026-03-21 Team Default Interaction Registry-First Audit

# 2026-03-21 Team Transcript Shared-Task Leakage Fix

## Plan

- [x] Confirm that the leaked `Task created.` / `Task updated.` / `Tasks:` text in the teams flow comes from shared task coordination tool results entering the main transcript.
- [x] Suppress `TaskCreate` / `TaskUpdate` / `TaskList` tool results from the main transcript so team bookkeeping stays internal.
- [x] Update focused transcript tests and rerun focused team/CLI suites plus lint.

## Review

- The leak path was `buildToolResultItems()` in `src/cli/transcript/model.ts`: `TaskCreate`, `TaskUpdate`, and `TaskList` were still treated like normal tool outputs, so their formatted task-record text could appear in the main transcript during team coordination.
- The main transcript now suppresses all three shared-task coordination tools. This keeps team/task bookkeeping internal while preserving execution tree rendering and main-agent-only outward narration.
- Updated `tests/unit/cli/transcript-model.test.ts` so shared task coordination output is explicitly expected to stay out of the main transcript.
- Verification:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts`
  - `bunx eslint src/cli/transcript/model.ts tests/unit/cli/transcript-model.test.ts`

## Plan

- [x] 审查 `src/capability/team/surface/conversation-tools.ts`、`src/capability/command/builtin/team.ts`、`src/capability/team/prompts.ts` 的默认 team 入口与提示词叙事。
- [x] 沿调用链抽查相邻实现，确认当前默认交互里是否仍把 team registry 当成一等主表面或前置操作。
- [x] 输出审查结论：残留的默认多-team 入口、最小收敛建议、以及无需改代码的结论说明。

## Review

- `conversation-tools` 当前默认注册已经明显收敛：`createConversationTeamTools()` 与 `TeamMiddleware` 都走 `includeAdvanced: false`，默认不再把 `create_team / enter_team / leave_team / list_teams` 暴露给模型。
- 仍残留的 registry-first 心智主要在两处：
  - `/team` builtin 默认帮助仍把许多命令写成 `[name]` 或 `<name>` 形式，`message` / `assign` 更是默认要求显式 team 名称，等于继续把 registry 寻址当成常规交互面。
  - leader prompt 仍保留 `Jobs vs Sub-Teams` 决策框架和 `depth/maxDepth` 叙事，即使默认工具面并未提供 sub-team 创建入口，模型仍会被提示去思考 peer/sub-team 编排。
- 另外，conversation default tools 虽然隐藏了 advanced tools，但默认 schema 仍普遍接受可选 `teamId`，且在多 resumable teams 时会返回“Use enter_team to switch focus first”，说明默认能力面仍保留了对 registry 的显式寻址假设。
- 本次仅做静态审查，没有改动业务代码。

# 2026-03-20 Team Isolation And UI Alignment Research

# 2026-03-21 Current Team Workspace Cleanup

## Plan

- [x] Remove advanced multi-team conversation tools from the default leader surface while preserving explicit recovery paths.
- [x] Reframe `/team` around the current workspace and keep multi-team switching behind `/team advanced`.
- [x] Tighten CLI team chrome so it tracks a focused current workspace instead of plural team summary counts.
- [x] Stop desktop recovery/history from silently replacing the current workspace.
- [x] Verify focused team suites and lint the touched files.

## Review

- `createConversationTeamTools()` now exposes only current-workspace tools by default; `create_team`, `enter_team`, `leave_team`, and `list_teams` moved behind `createConversationTeamToolsWithMode(..., {includeAdvanced: true})`, which the leader middleware does not use.
- `/team` now advertises only current-workspace commands in its default usage/help, while `/team advanced` remains the explicit manual recovery surface.
- `buildLeaderProtocol()` no longer treats peer/sub-team creation as part of the default planning framework; the default instruction is to staff and dispatch within the current leader-led workspace.
- `useActiveTeams()` now returns focused-workspace state (`hasFocusedTeam`, `focusedTeamStatus`, `isFocusedTeamRunning`, `isFocusedTeamPaused`) instead of acting like a plural summary-panel model, and `shell-app` no longer feeds “N teams” into status chrome.
- Desktop `TeamsPage` no longer lets recovery/history entries silently take over the `Current Team Workspace`; the current card only comes from a live current team, while recovery/history is a passive secondary list.
- Verification:
  - `bun test tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/agents/tool-execution.test.ts tests/unit/desktop/teams-page.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx tests/unit/cli/use-team-detail.test.ts tests/unit/core/codara-facade.test.ts tests/unit/durability/approval-store.test.ts`
  - `bunx eslint src/capability/team/surface/conversation-tools.ts src/capability/team/middleware.ts src/capability/team/prompts.ts src/capability/command/builtin/team.ts src/cli/hooks/use-active-teams.ts src/cli/app/shell-app.tsx src/desktop/pages/TeamsPage.tsx src/capability/team/index.ts tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/agents/tool-execution.test.ts tests/unit/desktop/teams-page.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx`

## Plan

- [x] Audit current `team` runtime isolation, shared state, and approval/inbox boundaries in code.
- [x] Audit current CLI `Teams` panel, team detail, transcript, and HIL interaction model.
- [x] Compare the current design with Claude Code public behavior/docs without claiming hidden internals.
- [x] Write a research/design note under `docs/` covering current architecture, gaps, and a minimal repair direction.

## Review

- Current `team` runtime isolation is stronger than the UI suggests: `LocalTransport`, inbox, team messages, job board, and approvals are keyed per `teamId`, so team-to-team detail leakage is mostly prevented by runtime shape rather than UI shape.
- The biggest architectural mismatch is focus ownership. There are currently two different notions of "active team":
  - runtime/agent context via `teamSurface.activeTeamId`;
  - CLI-local dashboard/detail focus via `teamDashboardState.activeTeamId`.
  This split is why the experience does not yet feel like Claude Code's single focused orchestration surface.
- The current `Teams` panel is already a lower floating summary window, but it is still only a summary projection. The main transcript does not yet have a first-class focused team execution tree analogous to the improved task execution tree.
- HIL/approval is globally foregrounded and independent, which is directionally correct, but approvals are not yet presented with strong team-scoped context labels/queue semantics.
- A new research note was written to `docs/architecture-review/2026-03-20-team-isolation-ui-alignment/README.md` with:
  - current-state analysis,
  - comparison against Claude Code public behavior,
  - recommended source-of-truth model,
  - a minimal control-plane and UI repair plan.

# 2026-03-20 Team Runtime Focus Alignment Plan

## Plan

- [x] 研究当前 `team` 隔离、可见性、focus switching、UI summary/detail/HIL 的实现现状。
- [x] 对照 Claude Code 公共资料与可观察行为，明确应当收敛的产品心智。
- [x] 输出架构评审文档，明确 `main agent`、`Teams` panel、focused team、approval queue、subprocess-capable backend 的边界。
- [x] 写出实施计划文档，明确分阶段修复路径与验证方式。
- [ ] 等用户确认后，按计划进入实现。

## Review

- 已完成两份评审文档：
  - `docs/architecture-review/2026-03-20-team-runtime-isolation-and-switching/README.md`
  - `docs/architecture-review/2026-03-20-team-runtime-claude-code-alignment/README.md`
- 已完成实施计划：
  - `docs/superpowers/plans/2026-03-20-team-runtime-focus-alignment.md`
- 当前结论：先统一 focused team control plane、summary/detail/HIL/main-agent narration，再通过 execution backend abstraction 为后续 subprocess 支持留口，不建议直接把“真实子进程”作为第一阶段改造目标。

# 2026-03-20 Team Auto-Resume And Transcript Cleanup

## Plan

- [x] Reproduce the remaining startup gap: persisted running/paused teams restore into the registry, but the session does not automatically focus the single resumable team on startup.
- [x] Add focused tests for startup auto-resume semantics:
  - exactly one resumable team => auto-focus it as leader;
  - multiple resumable teams => do not auto-pick.
- [x] Add focused transcript tests for suppressing raw JSON/bookkeeping output from team conversation tools so the main UI shows compact summaries instead of artifacts.
- [x] Implement the minimal runtime/transcript changes and verify the focused suites plus lint.

## Review

- `src/codara/assembly/collaboration.ts` now records the restored running/paused team ids during best-effort recovery and returns `restoredActiveTeamId` when the current project has exactly one resumable team snapshot.
- `src/codara/facade.ts` now seeds canonical session context from that restore result: if runtime creation finds exactly one resumable team and no caller-provided focused team surface, startup injects `teamSurface.activeTeamId + leader mode`, so CLI focus derives from the same runtime truth as manual `enter_team`.
- `src/cli/transcript/model.ts` now compacts raw JSON outputs from team conversation tools into concise summaries, so `spawn_teammate`, `create_team`, `team_status`, `plan_jobs`, `assign_job`, `review_job`, and similar team-control outputs stop leaking `{memberId, teamId, ...}` bookkeeping into the main transcript.
- `src/cli/components/chrome/team-panel.tsx`, `src/cli/components/teams/team-detail-view.tsx`, and `src/cli/components/teams/member-panel.tsx` now lean into the single-active-team model visually: singular `Team (...)` copy when only one team is visible, and focused team detail/member rows no longer render zero-value cost/token noise.
- Focused verification passed:
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/use-team-detail.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/durability/approval-store.test.ts`
  - `bunx eslint src/codara/assembly/collaboration.ts src/codara/facade.ts src/cli/transcript/model.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/use-team-detail.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/durability/approval-store.test.ts`
  - `bun test tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/components/teams/team-detail-view.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts`
  - `bunx eslint src/cli/components/chrome/team-panel.tsx src/cli/components/teams/team-detail-view.tsx src/cli/components/teams/member-panel.tsx tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/components/teams/team-detail-view.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts`

# 2026-03-20 Single Active Team UI Cleanup

## Plan

- [x] Re-audit the remaining teams UX mismatches against the single-active-team contract.
- [x] Make the `Teams` panel summary-only and remove member/worker rows from that floating panel.
- [x] Change `useActiveTeams` to project only the current focused team, instead of the whole team registry.
- [x] Reduce CLI-local team focus state so focused detail is derived from canonical runtime focus.
- [x] Keep team runtime/member activity out of the main transcript stream.
- [x] Update focused unit/case tests and re-run lint.

## Review

- `src/cli/components/chrome/team-panel.tsx` is now summary-only again. It no longer accepts or renders member rows; leader/workers remain visible only in focused team detail.
- `src/cli/hooks/use-active-teams.ts` now projects only the current `focusedTeamId`. If no team is focused, the summary projection is empty instead of showing a multi-team registry view in the main session UI.
- `src/cli/app/shell-app.tsx` no longer pulls `getTeamDetail()` for every active team just to feed the floating summary panel, and it no longer carries the old member-selection affordance tied to that panel.
- `src/cli/app/use-cli-controller.ts` now derives `teamDashboardState` from canonical runtime focus instead of maintaining an optimistic second focus truth in local state.
- `src/cli/transcript/model.ts` no longer renders team runtime/member milestones (`joined as`, `member.activity`, job completion milestones) as standalone transcript rows; team internals stay in focused team detail while outward narration remains with the main agent.
- Focused verification passed:
  - `bun test tests/unit/cli/active-teams.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/use-team-detail.test.ts tests/unit/core/codara-facade.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts`
  - `bunx eslint src/cli/hooks/use-active-teams.ts src/cli/app/shell-app.tsx src/cli/app/use-cli-controller.ts src/cli/transcript/model.ts src/cli/components/chrome/team-panel.tsx tests/unit/cli/active-teams.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts`

# 2026-03-20 Task List Shows Latest Batch

## Plan

- [x] Reproduce why the floating `Tasks` panel still uses a flat linger rule instead of following batch boundaries.
- [x] Add/update focused `active-tasks` tests to lock the intended rule: the panel keeps the latest completed batch visible until a newer batch starts, while still retaining completed siblings inside a live batch.
- [x] Implement the minimal `use-active-tasks` change so the task list projects only the latest inferred batch instead of all historical runs.
- [x] Verify the focused task-list tests and lint the touched file.

## Review

- The real bug was not “completed rows linger too long”; it was that the `Tasks` panel had no batch concept at all. A simple linger timeout could not satisfy both desired behaviors:
  - keep the last completed batch visible after it finishes;
  - replace it as soon as a newer batch starts.
- `src/cli/hooks/use-active-tasks.ts` now infers batch boundaries from `startedAt/endedAt`: a new batch begins only after the previous batch has fully terminated. The floating `Tasks` panel projects only the latest inferred batch.
- This preserves both user-facing rules:
  - lone completed/failed rows stay visible when they are still the latest batch;
  - once a newer batch starts, the old batch disappears from the panel;
  - within one live batch, completed siblings remain visible beside running/paused siblings.
- Focused regression coverage in `tests/unit/cli/active-tasks.test.ts` now locks all three cases: latest completed batch retention, replacement by a newer batch, and mixed live+done visibility within one batch.
- Verification:
  - `bun test tests/unit/cli/active-tasks.test.ts`
  - `bunx eslint src/cli/hooks/use-active-tasks.ts tests/unit/cli/active-tasks.test.ts`

# 2026-03-20 Publish fix/lordfoxfairy/tasks To main

## Plan

- [x] Confirm `fix/lordfoxfairy/tasks` is the branch to publish, document its divergence from `origin/main`, and verify the repo is clean for release.
- [x] Run fresh verification on the branch head before any PR or merge action.
- [x] Push `fix/lordfoxfairy/tasks` to `origin`, create a PR targeting `main`, and merge it.
- [x] Record the exact PR/merge result and any follow-up cleanup notes in the review section.

## Review

- `fix/lordfoxfairy/tasks` was 1 commit ahead of `origin/main`; local `main` had already been fast-forwarded to the same head before publish, so the GitHub PR was against the remote branch, not against local `main`.
- Fresh verification failed before publish: `bun run check` exited with code 2 due to TypeScript errors in `src/cli/app/shell-app.tsx`, `src/cli/components/conversation/transcript.tsx`, `src/desktop/features/docs/ui/DocsPage.tsx`, and related unit-test typing fixtures.
- Despite the local verification failure, the branch was pushed to `origin/fix/lordfoxfairy/tasks` and PR [#92](https://github.com/LordFoxFairy/Codara/pull/92) was created against `main` per explicit user instruction.
- GitHub reported PR `#92` as merged at `2026-03-20T12:59:21Z` with merge commit `b943d27213a84773a6bf90671d9989b7e19d9ed4`.
- Local `main` was updated to track `origin/main` after the merge; the current checkout remains `fix/lordfoxfairy/tasks` with this `tasks/todo.md` update still uncommitted.

# 2026-03-20 Live Running Task Tool Counts

## Plan

- [x] Reproduce why running subagent/task execution blocks often show only elapsed time without live tool counts.
- [x] Add focused tests covering live `toolUseCount` persistence during active runs and before delegated-child approval pauses.
- [x] Implement the minimal runtime/store fix so child activity updates increment `toolUseCount` in both normal and recovery/task-runtime paths.
- [x] Verify focused task/CLI tests and lint the touched files; attempt a real `bun run dev` smoke for the live count path.

## Review

- The root cause was not transcript rendering. Live task summaries had no count to display because `TaskRunStore.update()` only persisted `latestActivity`, while `toolUseCount` was written only in `finish()`.
- `src/capability/task/types.ts` and `src/capability/task/run-store.ts` now allow/persist `toolUseCount` on active updates, so running task summaries can surface live subagent counts instead of waiting for completion.
- `src/capability/task/middleware.ts` and `src/capability/task/runtime.ts` now increment `toolUseCount` whenever child tool activity is forwarded into the parent task runtime, covering the normal delegated-child path and the resumed/recovered runtime path.
- `src/capability/task/delegation.ts` now prepends the activity-forward middleware so approval-interrupted tools are counted before HIL blocks execution; this fixes the paused-for-review path where live counts were previously still missing.
- Focused regression coverage now proves both behaviors:
  - active task records keep live `toolUseCount` while still running;
  - a delegated child paused on approval already has `toolUseCount === 1` before resume.
- A manual `bun run dev` smoke was attempted, but this run never left the parent `Thinking...` state before I stopped it, so the live count behavior is currently locked by deterministic tests/lint rather than a clean PTY screenshot.
- Verification:
  - `bun test tests/unit/tasks/run-store.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/ui-alignment.test.tsx`
  - `bunx eslint src/capability/task/types.ts src/capability/task/run-store.ts src/capability/task/runtime.ts src/capability/task/middleware.ts src/capability/task/delegation.ts tests/unit/tasks/run-store.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/ui-alignment.test.tsx`

# 2026-03-20 RunId-First Task Execution Tree

## Plan

- [x] Reproduce why parallel task orchestration can still render duplicate execution blocks like a fake `Done (0s)` row.
- [x] Distinguish pending/synthetic task events from real task run roots and lock the difference with focused transcript tests.
- [x] Make transcript execution blocks runId-first so only real `task-run:<runId>` roots participate in the tree, while the bottom `Tasks` panel remains an independent summary list.
- [x] Verify transcript/shell regressions and lint the touched transcript files.

## Review

- The duplicate parallel-task block came from mixing two concepts in the transcript: controller-generated pending/synthetic task events used for orchestration bookkeeping, and real task runtime roots used for actual execution. The pending placeholder could start and end immediately, which produced a fake completed block like `Done (0s)`.
- `src/cli/transcript/model.ts` now treats only real `task-run:<runId>` task roots as renderable execution-block nodes. Pending placeholders (`detail: pending`) and controller synthetic task roots no longer enter the transcript tree.
- This aligns the UI with the intended two-layer model:
  - transcript = natural downward execution tree keyed by real task run identity;
  - floating `Tasks` panel = independent checklist summary, not part of the tree.
- Focused transcript tests now use real `task-run:<runId>` identifiers for true task roots and explicitly assert that pending placeholders are ignored once real roots exist.
- Verification:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/transcript/model.ts tests/unit/cli/transcript-model.test.ts`

# 2026-03-20 Multi-Task Turn Detach And Child Follow-Up Suppression

## Plan

- [x] Reproduce why a prompt requesting 2 parallel Task subagents only starts one real task and still surfaces child summary prose as if the main agent replied.
- [x] Add focused tests for launching multiple Task tool calls in one parent response and for suppressing child completion follow-ups while sibling tasks remain active.
- [x] Implement the minimal fix so `runTools()` launches every Task tool call in the same turn before detaching, and controller follow-ups do not surface mid-orchestration child summaries.
- [x] Verify focused agent/controller/transcript/shell tests and lint the touched files.

## Review

- The “2 subagents but only 1 real task” bug was in `src/core/agent/run/turn.ts`: `runTools()` returned immediately on the first detached Task launch, so later Task tool calls in the same AI response were never executed.
- `runTools()` now continues through the whole tool-call list, tracks whether any detached Task launches occurred, and only returns `detached` after all tool calls have had a chance to run. This enables true same-turn multi-task orchestration.
- The “main agent replied but it was actually a subagent” bug was in `src/cli/app/use-cli-controller.ts`: child task completion `event.detail` was being promoted directly into an assistant follow-up even when sibling tasks in the same session were still running.
- Controller follow-ups now check current task run summaries and suppress task-completion assistant follow-ups while any sibling task remains `running` or `paused`. This stops partial child summaries from appearing mid-orchestration.
- Focused regression coverage now locks both behaviors:
  - one AI response containing 2 Task tool calls launches both detached runs;
  - no assistant child follow-up appears while sibling tasks are still active.
- Verification:
  - `bun test tests/unit/agents/task-tool-delegation.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/core/agent/run/turn.ts src/cli/app/use-cli-controller.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/cli/use-cli-controller.test.tsx`

# 2026-03-20 Canonical Base Prompt Inheritance

# 2026-03-20 Background Task Follow-Up Loss While Parent Turn Is Still Running

## Plan

- [x] Reproduce the missing final reply path when a delegated task completes before the parent turn fully settles.
- [x] Add a focused controller test that proves completion follow-ups are not dropped while `isRunningRef` is still true.
- [x] Implement the minimal fix in the controller so background task notices/follow-ups are queued and flushed after the foreground run settles.
- [x] Verify the focused controller/transcript tests and re-run a real `bun run dev` smoke for the user prompt.

## Review

- The dropped follow-up was a timing bug in `useCliController`: delegated task end events that arrived while the parent turn still had `isRunningRef.current === true` were skipped by the background-notice path and never replayed afterward.
- `src/cli/app/use-cli-controller.ts` now queues background task follow-up/notice items that arrive during an active foreground run and flushes them once the foreground prompt settles, which prevents the final assistant-style handoff from disappearing.
- Focused regression coverage now includes the exact race: a background task can finish before the parent run exits, and the assistant follow-up still appears after the parent settles.
- A fresh real `bun run dev` smoke still confirms the task hierarchy stays alive while running; the completion handoff itself is now primarily locked by the deterministic controller test rather than a flaky PTY capture.
- Verification:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts`
  - `bun run dev`

# 2026-03-20 Floating Task Panel Placement

## Plan

- [x] Reproduce why task/tool output feels out of order when the task list is rendered inline in the transcript flow.
- [x] Add focused shell-level expectations that the task panel is a floating panel and hides behind stronger overlays.
- [x] Move the task panel out of the transcript flow and render it with the other lower-window overlays.
- [x] Verify shell/task/transcript alignment tests and lint the touched shell files.

## Review

- The ordering bug was real: `TaskPanel` and `TeamPanel` were rendered inline between the transcript and the prompt/footer chrome, so they read like part of the conversation flow even though the user expects them to be independent windows.
- `src/cli/app/shell-app.tsx` now treats the task panel as a floating lower-window panel instead of inline conversation content; it renders near completion/HIL chrome and no longer interrupts the natural transcript order.
- The same lower-window treatment is now applied to the team panel while no stronger overlay is active, which keeps the Ctrl+T surfaces conceptually grouped and prevents them from feeling like transcript messages.
- Focused shell tests now lock the design rule: the task panel is floating when the conversation is active, and it yields to stronger overlays like completion/session picker/command output/HIL.
- Verification:
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/components/chrome/task-panel.test.tsx`
  - `bunx eslint src/cli/app/shell-app.tsx tests/unit/cli/shell-app.test.ts`

# 2026-03-20 Manual `bun run dev` Task Smoke

## Plan

- [x] Confirm the local `bun run dev` entrypoint and launch an interactive CLI session.
- [x] Reproduce the user-provided `Task -> Explore` prompt through the real dev CLI.
- [x] Observe the live task launch, running hierarchy, review handoff, and completion/follow-up behavior for regressions.
- [x] If the manual smoke reveals issues, trace the failing layer before proposing fixes.
- [x] Record the verification result in this section before wrapping up.

## Review

- Real `bun run dev` smoke exposed two separate causes for task launch noise:
  - the parent turn was continuing after `task_run_started`, which let the model consume and narrate the launch result in a second assistant turn;
  - the model could also emit natural-language preamble text in the same `AIMessage` that contained the `Task` tool call itself, so transcript suppression had to understand "AI message with Task tool call" rather than only "assistant text after ToolMessage".
- `src/core/agent/run/turn.ts` now treats a `task_run_started` tool result as a detached handoff that ends the parent turn immediately, so the parent model does not consume a second "task started" reply after delegation.
- `src/cli/app/use-cli-controller.ts`, `src/cli/app/view-state.ts`, and `src/cli/transcript/model.ts` now mark streaming turns that contain a `Task` tool call and suppress all assistant prose for those launch messages in both the active and solidified transcript paths. This keeps the UI on the `Running task...` block immediately, which matches the intended Claude-Code-like feel.
- Focused regression coverage was added/updated in:
  - `tests/unit/agents/task-tool-delegation.test.ts`
  - `tests/unit/cli/transcript-model.test.ts`
- Manual smoke evidence from the live CLI after the fix:
  - the prompt no longer rendered `✅ 任务已启动！/委派信息/正在等待...` chatter;
  - the UI transitioned directly into `⏺ Running task...`;
  - delegated approval still surfaced correctly as an independent review prompt (`Task waiting for review...`, then `Approval 1/1`);
  - approving the review resumed the running task and continued showing live child activity (`glob(package.json)`).
- Verification:
  - `bun test tests/unit/agents/task-tool-delegation.test.ts tests/unit/cli/transcript-model.test.ts`
  - `bunx eslint src/core/agent/run/turn.ts src/cli/app/view-state.ts src/cli/app/use-cli-controller.ts src/cli/transcript/model.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/cli/transcript-model.test.ts`
  - manual smoke via `bun run dev`

# 2026-03-20 Task Launch Prompt De-Noising

## Plan

- [x] Reproduce why delegated task launches still triggered verbose model chatter even after the transcript/task UI was cleaned up.
- [x] Add focused tests for terse task launch text and for suppressing delegated launch metadata in runtime summaries.
- [x] Tighten the `Task` tool description and launch/reuse tool-message text so parent agents stop re-broadcasting launch metadata and promises.
- [x] Update affected real-CLI cases to assert the new Claude-Code-like task hierarchy output instead of the old raw launch banner text.
- [x] Verify the focused task/unit/case suite and lint the touched files.

## Review

- The remaining launch noise was not primarily a transcript rendering bug; it came from the model rephrasing the `Task` tool's own launch `ToolMessage`, which still exposed `run_id`, `delegate_id`, and `agent` metadata and implied it should narrate the delegation.
- `Task` launch text is now terse and directive: it keeps the single "Delegated task started in background." marker for internal continuity, but replaces raw identifiers with explicit guidance not to restate launch metadata or promise follow-up. The reused "already running" tool message follows the same rule.
- Runtime event formatting for launched delegated tasks now suppresses launch metadata details entirely, which removes the stray `⎿ delegate_id: ...` lines from the task transcript hierarchy and keeps the visual focus on real tool activity instead of bookkeeping IDs.
- Real CLI case assertions were updated to lock onto the new task hierarchy surface (`✓ Agent: ...`, `Task waiting for review`, etc.) rather than the old raw launch banner text, so the tests now track the intended Claude-Code-like UX instead of obsolete launch noise.
- Verification:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/observability/events-formatters.test.ts tests/cases/permissions/subagent-permission-default-ask.case.test.ts tests/cases/runtime/default-runtime.case.test.ts tests/cases/task-skills/task-skill-coordination.case.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `bunx eslint src/shared/task-run-launch.ts src/capability/task/middleware.ts src/observability/events/formatters.ts tests/unit/tasks/middleware.test.ts tests/unit/observability/events-formatters.test.ts tests/cases/permissions/subagent-permission-default-ask.case.test.ts tests/cases/runtime/default-runtime.case.test.ts tests/cases/task-skills/task-skill-coordination.case.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`

# 2026-03-20 Parallel Task Transcript Grouping

## Plan

- [x] Reproduce why parallel running tasks still render as separate static-looking tool blocks in the active transcript.
- [x] Add focused transcript rendering tests that lock in a grouped `Running N tasks...` block while keeping the task panel as a pure checklist.
- [x] Implement grouped running-task transcript rendering with one summary row per task and only the latest visible child activity by default.
- [x] Verify the targeted transcript UI/model tests and record the correction in lessons.

## Review

- The mismatch was in `ActiveTranscript`, not the task panel: running task items were still reusing the generic `ToolResultBlock`, so parallel subagents looked like a pile of static tool results instead of one live orchestration block.
- `ActiveTranscript` now groups consecutive running task items into a single `Running N tasks...` block, shows one summary row per task, and hangs only the latest child activity under each task by default; completed tasks still use the normal result rendering.
- The `TaskPanel` stayed untouched and continues to behave as the pure checklist/status surface for task totals, while the active transcript is now the only place that carries the execution hierarchy feel.
- Verification:
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/components/chrome/task-panel.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx eslint src/cli/components/conversation/transcript.tsx tests/unit/cli/ui-alignment.test.tsx`

# 2026-03-20 Task Panel Purity + Live Running Task Summary

## Plan

- [x] Remove elapsed/token/tool stats from the `Tasks` panel so it stays a pure checklist surface.
- [x] Feed active task summaries into the running-task transcript block so elapsed and latest child activity keep moving even when runtime events are quiet.
- [x] Prefer task-summary `detail/toolUseCount/totalTokens` in the grouped running-task rows while preserving the existing runtime-event fallback.
- [x] Verify transcript, task-panel, and shell wiring regressions after the patch.

## Review

- The `Tasks` panel now shows only status marker plus task name; elapsed, tool counts, and token counts are no longer rendered there.
- `ActiveTranscript` now receives `activeTasks` and uses the task runtime summary keyed by `runId` to refresh running rows with live elapsed, tool counts, token counts, and a fallback latest-activity line when child runtime events are sparse.
- This keeps the execution hierarchy dynamic in the transcript without leaking detail back into the task checklist panel.
- Verification:
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/components/chrome/task-panel.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/components/chrome/task-panel.tsx src/cli/components/conversation/transcript.tsx src/cli/app/shell-app.tsx tests/unit/cli/components/chrome/task-panel.test.tsx tests/unit/cli/ui-alignment.test.tsx`

# 2026-03-20 Background Completion Ordering + Assistant-Only Success Follow-Up

## Plan

- [x] Stop successful background task completion from emitting both a system notice and an assistant follow-up.
- [x] Keep new notices in the active transcript tail instead of solidifying them above the current conversation immediately.
- [x] Preserve error/review notices while making successful delegated completions land as a readable assistant-style summary.
- [x] Verify controller/transcript regressions and clean up touched test warnings.

## Review

- Successful background task completion now only appends the assistant-style follow-up, so the concrete child summary is the visible landing point instead of being duplicated by a second system notice.
- `useSolidifiedTranscript` no longer pushes fresh notices straight into the static scrollback region; unsolidified notices stay at the end of the active transcript until the next turn starts, which keeps chronology flowing downward instead of popping new output above older content.
- Error and paused-for-review paths still use warning/error notices, so the change is scoped to the success path that was causing the most confusion.
- Verification:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/components/chrome/task-panel.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/hooks/use-solidified-transcript.ts tests/unit/cli/use-cli-controller.test.tsx`

# 2026-03-20 Single Task Panel Suppression

## Plan

- [x] Hide the `Tasks` side panel when there is only one active task so the transcript remains the single source of truth for that case.
- [x] Keep the multi-task case unchanged so the task panel still appears as a parallel-task overview.
- [x] Add a focused shell-level display test for the `1 task` vs `2 tasks` split.
- [x] Verify the shell/task/transcript regressions after the display-only change.

## Review

- The `Tasks` panel now only renders when there are at least two visible tasks; a single active task no longer duplicates the same information in both the transcript and the side panel.
- This keeps the single-task path cleaner while preserving the panel for true parallel orchestration.
- Verification:
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/components/chrome/task-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx eslint src/cli/app/shell-app.tsx tests/unit/cli/shell-app.test.ts`

# 2026-03-20 Task Transcript Comfort Polish

## Plan

- [x] Reproduce the remaining “too heavy / not Claude-Code-like” parts of running and completed task transcript blocks.
- [x] Add focused UI assertions for a lighter completed-task block and a cleaner orchestration-style running block.
- [x] Implement transcript-only task block polish without changing task runtime semantics or reintroducing task-list duplication.
- [x] Verify the targeted transcript/task CLI regressions and capture the new presentation rules in lessons.

## Review

- Running tasks keep the orchestration-group treatment, but completed tasks in the active transcript now render as lightweight hierarchy summaries instead of falling back to the full generic `ToolResultBlock`.
- Completed task rows now emphasize `agent + status + elapsed` on one line and keep only recent child tool activity underneath, which leaves the assistant follow-up as the main place for final content.
- Single-task running headers now read more naturally (`Running task...` / `Task waiting for review...`) instead of always using the pluralized grouped wording, and completed rows now use a checkmark-style lightweight line.
- Verification:
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/chrome/task-panel.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/components/conversation/transcript.tsx tests/unit/cli/ui-alignment.test.tsx`

# 2026-03-20 Task Running Block Hierarchy Tightening

## Plan

- [x] Reproduce why running task progress was split between the transcript block and the bottom activity line.
- [x] Restructure the running task block into a stable 3-line hierarchy: title row, latest activity row, and live stats row.
- [x] Restore the animated running affordance on task headers and keep completed task blocks from repeating final summary prose.
- [x] Verify transcript/shell regressions and record the presentation rule.

## Review

- Running task hierarchy is now self-contained: the row inside `Running task...` shows task name + elapsed, the next row shows the latest tool/activity line, and a third row carries live stats like `17 tool uses · 32.3k tokens`.
- The bottom `ActivityLine` no longer duplicates task/tool progress once the transcript is already rendering a running task hierarchy block; it stays reserved for generic thinking/responding states.
- Running task headers now animate again with a spinner frame instead of a static `⏺`, which restores the “actively working” feel closer to Claude Code.
- Completed task blocks no longer fall back to rendering delegated child summary prose as output lines when no child tool activity is present; final content stays with the assistant follow-up instead of reappearing under `✓ Explore...`.
- Verification:
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/components/conversation/transcript.tsx src/cli/transcript/model.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/transcript-model.test.ts src/cli/app/shell-app.tsx tests/unit/cli/shell-app.test.ts`

# 2026-03-20 Running Task Elapsed Tick

## Plan

- [x] Reproduce why running task elapsed labels stay stuck at `0ms` until another runtime event arrives.
- [x] Add a lightweight active-transcript clock so running task elapsed text updates even without fresh runtime events.
- [x] Keep the change scoped to active transcript rendering without altering task runtime event semantics.
- [x] Verify transcript and hook regressions after the patch.

## Review

- The stuck `0ms` label was a display bug: running task elapsed time was only recomputed when a new runtime event arrived, so a quiet but healthy task looked frozen.
- `useSolidifiedTranscript` now runs a lightweight 1-second tick while there are active runtime items, and `buildActiveItems`/`buildRuntimeEventItems` accept a clock timestamp so running task summaries can advance elapsed time without any new events.
- The tick is scoped to active transcript rendering only and ignores start events that already have matching end events, so this does not alter task runtime semantics or keep unnecessary timers alive after completion.
- Verification:
  - `bun test tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/transcript-model.test.ts`
  - `bunx eslint src/cli/hooks/use-solidified-transcript.ts src/cli/transcript/model.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/transcript-model.test.ts`

# 2026-03-20 Background Task Completion Follow-Up

## Plan

- [x] Reproduce why background task completion often leaves the CLI without any assistant-style follow-up.
- [x] Add a minimal completion follow-up path so finished background tasks yield a readable assistant transcript block instead of only a system notice.
- [x] Keep approval/error notices intact while tightening only the successful background-task completion path.
- [x] Verify focused controller/transcript regressions after the patch.

## Review

- Background task completion previously only emitted a `system` notice, which meant the transcript never gained an assistant-style “main agent is back” anchor after the delegated run finished.
- `useCliController` now adds a second, assistant-level follow-up notice for successful background task completion while keeping the existing system notice path intact for status visibility.
- This is intentionally a minimal UI/control-plane fix: approvals and failures still use the old warning/error notice semantics, and no prompt-stack changes were needed to make the completion visible.
- Verification:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/app/view-state.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts`

# 2026-03-20 Running Task Activity Block Polish

## Plan

- [x] Enrich running task transcript blocks with a status summary line instead of only showing `...` or raw trailing activity.
- [x] Show the most recent task activity lines plus a collapsed `+N more` footer using the existing expandable tool block UI.
- [x] Include lightweight running stats such as elapsed time and activity count without changing task runtime semantics.
- [x] Verify transcript rendering regressions after the patch.

## Review

- Running task transcript blocks now show a real summary line such as `Running (5s · 4 tool activities)` or `Waiting for review (...)` instead of collapsing all live state into a literal `...`.
- The block now feeds recent activity labels into the existing `ToolResultBlock` output area, so the transcript naturally shows the latest tool lines plus a collapsed `+N more` footer with the current `ctrl+o` expand behavior.
- Activity counting is derived from real child tool activity updates only; task lifecycle markers like `Delegated task resumed` and `waiting for review` now shape the summary label instead of polluting the tool activity list.
- Verification:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx eslint src/cli/transcript/model.ts tests/unit/cli/transcript-model.test.ts`

# 2026-03-20 Task Transcript Duplicate Explore Dedupe

## Plan

- [x] Reproduce why a delegated subagent like `Explore` appears twice in the active transcript.
- [x] Dedupe synthetic Task-tool transcript blocks against real runtime task roots for the same delegation.
- [x] Preserve the real runtime task line and its updates while suppressing the duplicate synthetic launch/done block.
- [x] Verify transcript and solidified-transcript regressions after the patch.

## Review

- The duplicate `Explore` line came from two different event sources describing the same delegation: the Task tool wrapper emitted a synthetic task block, while the task runtime emitted the real background task root.
- The transcript model now suppresses synthetic task launch/done blocks when a matching runtime task root already exists for the same delegated label, so only one `Explore(...)` line remains visible.
- The runtime-owned task line and its review/resume updates are preserved, which keeps the transcript aligned with the actual background task lifecycle instead of the short-lived wrapper tool result.
- Verification:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts`

# 2026-03-20 AskUser Next Footer + Final Submit Tab

## Plan

- [x] Let every AskUser question tab accept free-text input without requiring a `mixed` placeholder row.
- [x] Make question tabs expose a real selectable `[Next]` footer while keeping `Submit/Chat about this` exclusive to a final end step.
- [x] Render `Submit` as a distinct terminal tab in the AskUser navigator instead of leaking submit actions into question steps.
- [x] Tighten AskUser tool guidance so generated forms prefer explicit `select` / `multiselect` / `text` questions over `mixed`.
- [x] Verify focused HIL review, panel, controller, and middleware tests after the rewrite.

## Review

- AskUser question tabs now always accept typed custom answers at the CLI layer, so users are no longer blocked behind `mixed` placeholder rows just to override a choice.
- Question steps now expose a real `[Next]` footer that is independent from option selection, while `Submit/Chat about this` only appear on a separate final submit tab.
- The AskUser tab strip now treats `Submit` as a true end step instead of a side effect of action focus, which keeps the navigator and the body content aligned.
- AskUser tool guidance now explicitly prefers `select`, `multiselect`, and `text`; `mixed` is documented as the exceptional path because the CLI review UI already allows typed overrides for every question.
- Verification:
  - `bun test tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/hil-input.test.ts tests/unit/cli/shell-app.test.ts tests/unit/middleware/interaction-middleware.test.ts`
  - `bunx eslint src/cli/app/hil-review.ts src/cli/app/use-cli-controller.ts src/cli/components/conversation/hil-panel.tsx src/cli/app/view-state.ts src/core/middleware/ask-user-question.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx`

# 2026-03-20 AskUser Explicit Selection + Submit Flow

## Plan

- [x] Separate AskUser option activation from final submission so `Enter` no longer submits from option focus.
- [x] Make `Space` activate the currently highlighted AskUser option while keeping generic text entry behavior intact.
- [x] Move the final AskUser submit step onto the explicit actions bar and update hint copy to match the real keyboard flow.
- [x] Verify the targeted AskUser input/controller/panel tests after the patch.

## Review

- AskUser now treats highlighted options as an explicit intermediate step: `Space` activates the current choice, `Enter` confirms the focused option/tab progression, and final submission only happens after focus moves to the actions bar.
- Completing the last AskUser tab now lands on the explicit `Submit` action instead of silently resuming, which matches the expected multi-tab review flow.
- The floating AskUser panel hint copy now matches the real shortcuts, so the UI no longer claims `Enter submit` while the user is still navigating options.
- Verification:
  - `bun test tests/unit/cli/hil-input.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/conversation/hil-panel.test.tsx`
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/hil-input.test.ts`

# 2026-03-20 AskUser Navigator Polish + Prompt Paste Guard

# 2026-03-20 AskUser End Step + Mixed Input Semantics

## Plan

- [x] Hide the main prompt frame while AskUser review is active so the review fully owns the foreground surface.
- [x] Infer `mixed` tabs when AskUser tool output provides both `options` and `placeholder` without an explicit input type.
- [x] Move intermediate AskUser steps to a `Next`-style navigation flow and reserve `Submit/Chat` for a final virtual `End` step only.
- [x] Verify shell, HIL review, and AskUser panel regressions after the interaction rewrite.

## Review

- AskUser now fully owns the foreground surface: while the review is active, the chat input frame is hidden instead of sitting under the form.
- Tabs with both `options` and `placeholder` now infer `mixed` input by default, which keeps “pick one or type your own” questions from silently collapsing into plain single-select tabs.
- The AskUser panel now uses a Claude-Code-like top tab strip with a virtual `Submit` tab, intermediate question steps no longer expose the submit/chat action bar, and question-step navigation is limited to the current question until all required tabs are complete.
- The AskUser tool description now explicitly documents when to use `select`, `multiselect`, `text`, and `mixed`, so model-generated forms are less likely to default into all-single-select output.
- Verification:
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/middleware/interaction-middleware.test.ts`
  - `bun test tests/unit/cli/prompt-input-action.test.ts tests/unit/cli/composer-view.test.ts tests/unit/cli/composer-state.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/hil-input.test.ts tests/unit/cli/shell-app.test.ts tests/unit/middleware/interaction-middleware.test.ts`

## Plan

- [x] Make AskUser single-select tabs render like radio choices while preserving checkbox styling for multiselect tabs.
- [x] Keep `Space` as selection-only and make explicit `Enter next` handle tab progression; hide `Answer/Actions` chrome during select-only steps.
- [x] Collapse long AskUser tab headers into a compact step navigator so many tabs do not smash together in the floating panel.
- [x] Guard the main prompt input so bare pasted newline chunks are inserted as text instead of being misread as submit.

## Review

- AskUser select-only tabs now use radio-style markers, multiselect tabs keep checkboxes, and the panel no longer shows `Answer` or `Actions` chrome while the user is still choosing options.
- The AskUser header is now a compact `Step X/Y` navigator with current/previous/next labels instead of dumping every tab into one overflowing line.
- Prompt input submission is now keyed off real `Enter` metadata; bare newline chunks without `key.return` fall back to plain text insertion, which reduces accidental sends during pasted multi-line prompts.
- Verification:
  - `bun test tests/unit/cli/prompt-input-action.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/hil-input.test.ts tests/unit/cli/shell-app.test.ts`

# 2026-03-20 Prompt Paste Chunk + CJK Composer Wrapping

## Plan

- [x] Treat paste chunks that contain text plus newline metadata as text insertion instead of immediate submit.
- [x] Make the composer viewport wrap by terminal display width so Chinese/full-width text does not overflow or visually overwrite nearby content.
- [x] Lower the minimum prompt wrap width so narrow terminals still get real soft wrapping instead of a forced one-line overflow.
- [x] Verify prompt input and composer viewport regressions after the patch.

## Review

- Prompt input now only submits on a true empty `Enter` event; pasted chunks that arrive with both content and `return` metadata are preserved as text.
- The composer soft-wrap logic now measures display width instead of raw UTF-16 length, which keeps CJK and mixed-language pasted prompts from collapsing into a single over-wide visual line.
- The composer viewport now respects narrower terminal widths by using a smaller minimum wrap width, so the input frame can actually wrap instead of overflowing until 20 columns.
- Composer text now normalizes pasted `\r\n` and bare `\r` into plain `\n`, which prevents carriage-return overwrite corruption in the prompt frame during multi-line paste.
- The default prompt viewport now keeps up to 10 visual lines visible instead of truncating ordinary pasted prompts down to a 6-line tail with `...`.
- The prompt frame now defaults to showing the full composed input instead of applying a hidden viewport cap; `...` only appears in call sites that explicitly ask for a limited viewport.
- Prompt input once again treats a real lone `Enter` (`\r`/`\n` with return metadata) as submit while still keeping “contentful paste chunks” on the text-insert path.
- Verification:
  - `bun test tests/unit/cli/prompt-input-action.test.ts tests/unit/cli/composer-view.test.ts`
  - `bun test tests/unit/cli/prompt-input-action.test.ts tests/unit/cli/composer-view.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/hil-input.test.ts tests/unit/cli/shell-app.test.ts`
  - `bun test tests/unit/cli/composer-state.test.ts tests/unit/cli/composer-view.test.ts tests/unit/cli/prompt-input-action.test.ts tests/unit/cli/hil-review.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/hil-input.test.ts tests/unit/cli/shell-app.test.ts`

## Plan

- [x] Trace the current `main`, `Task` child, and `team` member prompt assembly paths and pin the exact inheritance gap.
- [x] Apply the smallest runtime patch: stop default `Task` prompt rebuilding and pass the canonical base directly into team workers.
- [x] Verify the `Task` inheritance path with targeted unit tests.
- [x] Record any remaining gaps without expanding into broader prompt-stack refactors.

## Review

- Kept the fix to the two runtime handoff seams the user called out: `Task` no longer rebuilds prompt context by default, and `team` workers now receive the same canonical base prompt/runtimeShared bundle computed at runtime startup.
- Verification:
  - `bun test tests/unit/tasks/middleware.test.ts`
  - `bun run typecheck` still fails on a pre-existing unrelated import error in `src/desktop/features/docs/ui/DocsPage.tsx` for `../../../shared/ui/StatusPill`.

# 2026-03-20 CLI Orchestration Display Fixes

## Plan

- [x] Fix the `TeamMiddleware` worker crash path so missing/invalid protocol callbacks do not kill the member turn.
- [x] Keep runtime task/team activity visible in the active transcript even after the foreground turn has ended.
- [x] Scope the CLI team panel to the current session/runtime’s own teams instead of collapsing to the latest global team.
- [x] Verify the targeted middleware/transcript/team-activity tests after the patch.

## Review

- Worker-side `TeamMiddleware` now safely handles missing protocol/inbox callbacks instead of crashing in `beforeModel`.
- Active transcript rendering now continues to show runtime task/team events without requiring an active foreground turn, which removes the abrupt “reply ended, activity vanished” gap.
- Team creation now stamps the owning `sessionId`, and the Codara facade only exposes team summaries/details for the current session runtime; the CLI panel therefore shows this session’s teams rather than stale teams from other runs.
- Team panel derivation no longer forces a single global “latest active team”; once summaries are session-scoped, it renders the current session’s visible teams in priority order.
- Verification:
  - `bun test tests/cases/teams/local-team-lifecycle.case.test.ts`
  - `bun test tests/unit/middleware/team-context.test.ts`
  - `bun test tests/unit/cli/active-teams.test.ts`
  - `bun test tests/unit/cli/solidified-transcript.test.ts`
  - `bun test tests/unit/core/codara-facade.test.ts`

# 2026-03-20 Task/Subagent Background Completion Anchors

## Plan

- [x] Reproduce why delegated background tasks feel like they disappear after launch and completion.
- [x] Keep completed task rows visible long enough to read the result instead of dropping after a 3 second linger.
- [x] Emit a stable CLI notice when a background task completes, fails, or pauses for review after the foreground turn has already ended.
- [x] Verify focused task/subagent transcript and activity tests after the patch.

## Review

- The task panel now keeps recently completed delegated runs visible for a longer window, which removes the immediate “task vanished” effect after background completion.
- `useCliController` now appends a stable notice for background task completion/failure/review events when the foreground turn is no longer running, so the session keeps a readable end-state even though no new assistant turn is streamed.
- This keeps the current runtime-event model intact while giving delegated subagents a concise final anchor closer to Claude Code’s background-task feel.
- Verification:
  - `bun test tests/unit/cli/active-tasks.test.ts`
  - `bun test tests/unit/cli/use-cli-controller.test.tsx`
  - `bun test tests/unit/cli/solidified-transcript.test.ts`
  - `bun test tests/unit/cli/transcript-model.test.ts`
  - `bun test tests/cases/hil/subagent-activity-display.case.test.ts`

# 2026-03-20 Command Completion Two-Column Layout

## Plan

- [x] Make the command completion popup render as a stable two-column layout without changing its behavior.
- [x] Keep the command column fixed-width with a clear gap before the description column.
- [x] Truncate overlong descriptions with ASCII `...` so the right column never spills past the panel width.
- [x] Verify the layout helpers and affected CLI tests.

## Review

- `CompletionMenu` now computes an explicit panel/name/description layout from terminal width instead of relying on flexible text wrapping.
- The left command column stays fixed-width, the inter-column gap is stable, and long descriptions are proactively truncated with `...`.
- The popup still keeps the same commands, selection behavior, and accept/close hints; only the rendering contract changed.
- Verification:
  - `bun test tests/unit/cli/components/prompt/completion-menu.test.tsx`
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/chrome.test.ts tests/unit/cli/command-completion.test.ts`

# 2026-03-20 Desktop Resource/System Surface Slice

## Plan

- [x] Rebuild `src/desktop/features/mcp/**`, `src/desktop/features/skills/**`, `src/desktop/features/settings/**`, and `src/desktop/features/teams/**` to match `docs/desktop` plus `tmp/desktop-figma-preview/pages.html`.
- [x] Keep MCP and Teams backed by real API data where available; keep Skills near-term/static because no stable backend contract exists.
- [x] Keep Settings read-only and route runtime diagnostics out of the page surface.
- [x] Verify the edited owned files with lint and typecheck, then record any remaining repository-wide gaps.

## Review

- MCP now reads as an inventory/status surface with server cards, tool lists, inspector detail, and Settings handoff.
- Skills now reads as a separate near-term management page with installed skill rows, scope/source detail, and a clear contract boundary note.
- Settings now reads as a configuration reference page with runtime/model/MCP-permissions sections plus a config path callout.
- Teams now treats unavailable as a first-class state and only shows team list/detail/control when the backend is actually initialized.
- Verification:
  - `bunx eslint src/desktop/features/mcp/ui/McpPage.tsx src/desktop/features/skills/ui/SkillsPage.tsx src/desktop/features/settings/ui/SettingsPage.tsx src/desktop/features/settings/domain/models.ts src/desktop/features/settings/application/use-settings-controller.ts src/desktop/features/settings/infra/settings-api.ts src/desktop/features/teams/ui/TeamsPage.tsx src/desktop/features/teams/infra/teams-api.ts`
  - `bun run typecheck` currently fails on unrelated pre-existing errors in `src/desktop/features/overview/infra/overview-api.ts`, `src/desktop/features/runtime/infra/runtime-api.ts`, and `tests/unit/desktop/app-shell.test.tsx`; the edited resource/system pages are not part of those failures.

# 2026-03-20 Desktop Page Pack Rewrite

## Plan

- [x] Audit the approved desktop frame language in `tmp/desktop-figma-preview/{pages,hil}.html` for the allowed feature surfaces only.
- [x] Rewrite `overview`, `chat`, `sessions`, and `runtime` as literal desktop page surfaces under `src/desktop/features/**`.
- [x] Keep the existing shell untouched and preserve current controllers/data sources where useful for fidelity.
- [x] Run desktop-targeted verification (`typecheck`, `lint`) after the page rewrite and fix any type or formatting regressions.

## Review

- `bunx eslint src/desktop/features/overview/ui/OverviewPage.tsx src/desktop/features/chat/ui/ChatPage.tsx src/desktop/features/chat/application/use-chat-controller.ts src/desktop/features/sessions/ui/SessionsPage.tsx src/desktop/features/runtime/ui/RuntimePage.tsx src/desktop/features/runtime/infra/runtime-api.ts src/desktop/features/overview/infra/overview-api.ts` passed.
- `bun run typecheck` still reports pre-existing out-of-scope failures in `src/desktop/features/debug/ui/DebugPage.tsx`, `src/desktop/features/logs/ui/LogsPage.tsx`, and `tests/unit/desktop/app-shell.test.tsx`.

# Desktop support pages rewrite

- [x] Inspect the current docs / debug / logs surfaces and the desktop page-pack rules
- [x] Write a concrete implementation plan for the owned support pages
- [x] Rewrite `DocsPage` to the warm parchment page-pack frame
- [x] Rewrite `DebugPage` to the same visual system and utility-surface hierarchy
- [x] Rewrite `LogsPage` to the same visual system and utility-surface hierarchy
- [x] Verify the desktop typecheck or targeted desktop tests

## Review

- `bunx tsc -p tsconfig.json --noEmit` passed on 2026-03-20.
- `bun run typecheck` failed on a pre-existing test import path in `tests/unit/desktop/app-shell.test.tsx` (`src/desktop/app/bootstrap/DesktopApp`), so I used the source-only compiler check to validate the changed app code.
- Changed files: `src/desktop/features/docs/ui/DocsPage.tsx`, `src/desktop/features/docs/index.ts`, `src/desktop/features/debug/ui/DebugPage.tsx`, `src/desktop/features/logs/ui/LogsPage.tsx`, `tasks/todo.md`, `docs/superpowers/plans/2026-03-20-desktop-support-pages.md`.

# 2026-03-20 Non-UI Architecture Deep Review

## Plan

- [x] Read `docs/architecture/01-global-architecture-overview.md`, `02-a2a-hybrid-architecture-design.md`, `03-multi-agent-context-and-handoff-design.md`, and `04-team-task-subagent-alignment-with-claude-code.md`.
- [x] Map the actual current non-CLI/non-desktop architecture across `src/core`, `src/context`, `src/integration`, `src/observability`, `src/durability`, `src/codara`, `src/shared`, `src/bus`, `src/server`, and `src/gateway`.
- [x] Identify where the current code matches the architecture docs, and where the docs are still aspirational or only partially represented.
- [x] Check for CLI/Desktop leakage only where it distorts the non-UI architecture boundaries or source-of-truth ownership.
- [x] Record concise findings with strengths, risks, and concrete file references in the final response, then summarize the review result here.

## Review

- Wrote the consolidated review to `docs/architecture-review/2026-03-20-runtime-architecture-review/README.md`.
- Actual runtime source of truth is `codara/facade -> durability/session -> core/agent loop`, with `capability/task` and `capability/team` providing the real multi-agent control planes behind the requested directories.
- `01-global-architecture-overview.md` is directionally accurate for the main bounded contexts and the middleware-first execution chain, but several dependency arrows are looser in practice than the doc claims.
- `02-a2a-hybrid-architecture-design.md` remains almost entirely aspirational; current code is local-runtime-first and does not implement AgentCard/discovery/trust/A2A transport stacks.
- `03-multi-agent-context-and-handoff-design.md` and `04-team-task-subagent-alignment-with-claude-code.md` are now only partially aspirational: the code already has persisted `TaskRunStore`, `TaskRuntime`, `ApprovalStore`, `TeamRegistry`, and `TeamRuntime`, but still lacks the cleaner unified control-plane and richer handoff/transcript contracts described there.
- `task` is currently a split model: `TaskCreate/TaskUpdate/TaskList` manage shared coordination records, while `Task` launches durable background `TaskRun`s; this is the main reason the task experience still feels semantically odd.
- `team` is directionally correct as a local leader-worker system, but its truth is split across `TeamRegistry`, `TeamRuntime`, session context, approvals, and a weak `shared-state` mirror.
- The prompt stack is a first-order cause of current weirdness, but not because `main` is too rich. `main` is correctly carrying the full init/base stack; the real issue is that task/team roles do not consistently inherit that same base before adding thin role-specific overlays, and auto-memory/path reminders add extra noise on top.
- Highest-risk mismatches:
  - `src/bus/bus.ts` is not a low-level infra bus; it owns a singleton `Codara` runtime, so the bus layer depends upward on the app layer.
  - `src/server` is not a pure port adapter; chat/resume flow through that singleton bus, while session history bypasses it and reads checkpoints directly.
  - `src/integration/channel/contracts.ts` depends on `@gateway/types`, which inverts the intended layering.
- `src/server/index.ts` creates the teams API handler without injecting registry/runtime dependencies, so that server control surface is effectively a stub today.

# 2026-03-20 CLI Compact + AskUser Display Alignment

## Plan

- [x] Make `/compact` return output that matches the real compaction outcome instead of always claiming success.
- [x] Keep session-owned compaction behavior unchanged while exposing structured `compacted` vs `skipped` results to the command layer.
- [x] Re-layout AskUser/HIL rendering so tabs, options, actions, and hints are visually separated without changing submission semantics.
- [x] Add targeted regression tests for compact outcomes and AskUser action/tab rendering, then run focused CLI/core test suites.

## Review

- `Session.compactConversation()` now returns a structured result with `state`, `outcome`, and optional `reason`, which lets `/compact` report `compacted`, `skipped by hook`, and `already compact enough` without changing the underlying summary/compaction behavior.
- The slash command still returns the resulting `state`, so existing session-owned compaction flows remain intact while the command copy now matches the actual runtime event semantics.
- AskUser/HIL rendering is now visually split into tabs, question/options, action bar, and hint sections; `Submit` and `Chat about this` are no longer rendered as pseudo-tabs or numbered options.
- Verification:
  - `bun test tests/unit/commands/compact.test.ts tests/unit/core/codara-commands.test.ts tests/unit/core/codara-session-runtime.test.ts`
  - `bun test tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/hil-review.test.ts`
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/chrome.test.ts tests/unit/cli/command-completion.test.ts tests/unit/commands/model.test.ts tests/unit/commands/cost.test.ts`

# 2026-03-20 Task Transcript + Checklist Cleanup

## Plan

- [x] Remove duplicate delegated-task launch rendering from the transcript so runtime agent activity shows only once.
- [x] Keep delegated task/tool activity flowing through runtime events without changing the underlying task runtime model.
- [x] Simplify the `Tasks` panel to a checklist-style list instead of a two-line activity/detail block.
- [x] Verify transcript/task panel regressions together with active-task and subagent-activity coverage.

## Review

- Raw `Task` launch `ToolMessage`s with `task_run_started` artifacts are now suppressed in the transcript, so the running agent line comes from the runtime task event path instead of being duplicated by the tool-result path.
- The transcript model now correctly treats the `Task` tool itself as task-role output alongside `TaskCreate`/`TaskUpdate`/`TaskList`, which fixes the previous role mismatch in CLI rendering.
- The `Tasks` panel now renders as a single checklist row per task and no longer prints child activity like `write_todos` as a second detail line under each task.
- Verification:
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/components/chrome/task-panel.test.tsx`
  - `bun test tests/unit/cli/active-tasks.test.ts tests/cases/hil/subagent-activity-display.case.test.ts tests/unit/cli/use-cli-controller.test.tsx`

# 2026-03-20 AskUser Floating Placement

## Plan

- [x] Move AskUser reviews out of the transcript flow and present them as an independent floating panel below the prompt area.
- [x] Keep the prompt frame visible while an AskUser form is active, but leave the existing HIL input behavior and submission semantics unchanged.
- [x] Keep permission reviews on the existing inline path so this change only affects AskUser-style form reviews.
- [x] Verify shell/HIL regression tests after the mount-point change.

## Review

- AskUser forms are now detected as floating HIL reviews in the shell layer, so they no longer occupy the transcript slot that previously made them read like inline conversation content.
- The prompt frame stays visible while a floating AskUser review is active, which matches the “chat input with a review window beneath it” layout the user requested.
- `HilPanel` now supports a floating presentation with a bordered window, while permission reviews continue to use the inline path.
- Verification:
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx tests/unit/cli/hil-review.test.ts`
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/chrome.test.ts tests/unit/cli/command-completion.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - Floating-window polish follow-up:
    - the floating AskUser panel now includes a titled header (`Ask User`), action-hint copy in the title bar, an `Answer` section label, stronger selected action emphasis, and an explicit vertical gap from the prompt frame.

# 2026-03-20 Teams Feature Flag

## Plan

- [x] Add a real `teams.enabled` setting to Codara settings parsing instead of relying on an inert JSON field.
- [x] Let `CodaraRuntimeOptions.teams` explicitly override settings for tests and targeted runtime callers.
- [x] Gate team system assembly in `createCodaraRuntime` on that resolved setting.
- [x] Enable teams for this project in `.codara/settings.json` and verify both disabled and enabled runtime paths.

## Review

- `settings.json` now supports `teams.enabled`, and the resolver defaults teams to disabled unless the project/user config or runtime option explicitly enables them.
- `createCodaraRuntime` now skips `assembleTeamSystem(...)` entirely when teams are disabled, so `/team` correctly reports that the team system is not initialized instead of silently behaving as available.
- `CodaraRuntimeOptions` now supports an explicit `teams?: boolean` override, which keeps runtime tests and special callers deterministic even though the product default is now config-driven.
- The current project config at `.codara/settings.json` now sets `teams.enabled` to `true`, so this workspace keeps the team system enabled by default.
- Verification:
  - `bun test tests/unit/config/settings.test.ts tests/unit/core/codara-facade.test.ts`
  - `bun test tests/unit/core/codara-commands.test.ts tests/unit/cli/active-teams.test.ts tests/unit/middleware/team-context.test.ts`

# 2026-03-20 Task Completion Hierarchy Follow-up

## Plan

- [x] Restore completed task blocks to the original hierarchical task shape instead of the flattened `✓ Explore...` row.
- [x] Keep the done summary as a child line (`Done (...)`) rather than the primary row.
- [x] Remove the generic `Task finished.` assistant fallback so it does not compete with the main-agent follow-up.
- [x] Verify focused transcript/controller tests after the render change.

## Review

- Completed task blocks now render as the original task header shape again, e.g. `⚙ Explore(args) (elapsed)`, with the done summary on the indented child line below.
- The running/completed hierarchy remains separate from the final assistant reply, so the task block stays an execution trace rather than becoming the main content container.
- Background task completion no longer injects a meaningless `Task finished.` assistant notice when the task event has no detail payload.
- Verification:
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx eslint src/cli/components/conversation/transcript.tsx src/cli/app/use-cli-controller.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/use-cli-controller.test.tsx`

# 2026-03-20 Task Execution Block Contract

## Plan

- [x] Freeze the approved ASCII contract for transcript execution blocks, floating task panels, and main-agent follow-ups.
- [x] Save the full implementation plan to `docs/superpowers/plans/2026-03-20-task-execution-block-ui.md`.
- [x] Implement the contract in transcript/model/controller/shell layers without introducing alternate task shapes.

## Review

- The approved contract is now documented as the implementation source of truth: transcript grows naturally downward, task/subagent runs keep a stable execution-block identity, grouped running tasks render as one orchestration block, and final prose remains the responsibility of the main agent.
- The next implementation pass should be judged only against that plan and ASCII contract, not against ad hoc UI tweaks.
- The CLI now renders a single task as a stable execution block header instead of the older `Running task...` grouped wording, keeps `Done (...)` as the child status line for completed tasks, and renders grouped parallel work as `Running N agents...` with stats on the task summary row and only the latest activity below.
- The transcript/controller/shell focused regression suite and targeted lint pass are green after this pass:
  - `bun test tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/chrome/task-panel.test.tsx`
  - `bunx eslint src/cli/components/conversation/transcript.tsx src/cli/transcript/model.ts src/cli/app/use-cli-controller.ts src/cli/app/shell-app.tsx src/cli/components/chrome/task-panel.tsx tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/chrome/task-panel.test.tsx`

# 2026-03-20 Main-Agent Task Completion Continuation

## Plan

- [x] Reproduce the missing control-plane handoff where detached Task runs complete but the main agent never regains a compact view of the batch results.
- [x] Add focused failing tests for:
  - tracked task batches re-entering the main agent instead of surfacing child summaries directly;
  - Task middleware injecting a hidden completion handoff into the main-agent continuation turn.
- [x] Implement a minimal batch-tracking continuation flow in the CLI controller and a thin Task middleware system-message overlay that summarizes completed child runs for the next main-agent model call.
- [x] Verify focused controller/task tests, rerun focused lint, and launch a real `bun run dev` smoke for task continuation behavior.

## Review

- The CLI controller now tracks real `task-run:<runId>` roots as a batch, waits until the whole batch is terminal, and then starts a real main-agent continuation instead of synthesizing an assistant notice from child summaries.
- Task middleware now injects a compact hidden completion handoff only for main-agent continuation turns, giving the main agent batch status, summaries, and basic stats without surfacing raw child output directly to the user.
- Focused verification passed:
  - `bun test tests/unit/agents/task-tool-delegation.test.ts tests/unit/tasks/middleware.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/capability/task/middleware.ts src/codara/types.ts src/codara/assembly/task-runs.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/tasks/middleware.test.ts`
- Real `bun run dev` smoke was launched and used to verify the running execution-block path, but PTY capture remained unreliable for the final completion frame; the completion handoff itself is locked primarily by the focused controller/task tests above.

# 2026-03-20 Task Completion Transcript Ordering + Thin Main-Agent Handoff

## Plan

- [x] Reproduce why task completion continuation currently renders the main-agent reply above the execution tree and why the reply still reads too much like child/subagent output.
- [x] Add focused failing tests for:
  - task-completion active transcript ordering (`execution tree` before the continuation reply);
  - thin handoff instructions that forbid task-by-task/raw child output and compact long child summaries.
- [x] Implement the minimal ordering/handoff fix without changing the execution-tree vs task-list contract.
- [x] Verify focused transcript/task tests and rerun the touched lint targets.

## Review

- The ordering bug was not in the task tree itself; it came from the completion continuation being treated like a normal trailing assistant turn, so the new main-agent reply was rendered before the still-active execution tree. `buildActiveItems()` now renders runtime execution items before the streaming continuation response for `task_completion` turns, and `useSolidifiedTranscript()` preserves that ordering after the continuation finishes but before the next user turn solidifies the reply.
- The “subagent content leaking into the final answer” problem came from the hidden completion handoff being too verbose. Task middleware now injects a thinner handoff: stronger instructions to avoid task-by-task/raw child sections, plus compacted one-line child summaries instead of raw long-form delegated output.
- Verification:
  - `bun test tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/tasks/middleware.test.ts`
  - `bunx eslint src/cli/app/view-state.ts src/cli/app/use-cli-controller.ts src/cli/transcript/model.ts src/cli/hooks/use-solidified-transcript.ts src/capability/task/middleware.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/tasks/middleware.test.ts`

# 2026-03-20 HIL Overlay Parity + Task Bookkeeping Suppression

## Plan

- [x] Reproduce why permission reviews still behaved differently from AskUser floating overlays and why task bookkeeping/status lines could still leak into the visible transcript/activity line.
- [x] Add focused tests for:
  - permission reviews using the same floating-overlay treatment as AskUser;
  - task panel staying visible while HIL is active;
  - suppressing `Task started` / `Delegated task running in background` runtime bookkeeping lines;
  - suppressing the bottom activity line while any task is still running or paused.
- [x] Implement the minimal shell/transcript fixes without changing the execution-tree vs task-list contract.
- [x] Verify focused shell/controller/transcript tests and rerun the touched lint targets.

## Review

- Permission approvals now follow the same floating-overlay rules as AskUser reviews: they hide the prompt, do not render inline in the transcript, and do not block the floating task panel from remaining visible above them.
- The floating task panel is now mounted before the prompt/review area, so it behaves like the separate lower-window summary the contract requires instead of feeling like transcript content appended after the chat box.
- The transcript model now suppresses bookkeeping-only task runtime events such as `Task started` and `Delegated task running in background`; visible task state should come from execution-tree blocks only, not internal launch bookkeeping.
- The bottom `ActivityLine` now suppresses task/tool progress not only when a running task block is projected, but also whenever any task is still running or paused, which prevents stray lines like `glob(vite.config.{ts,js})` from drifting outside the owning execution block.
- Verification:
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts`
  - `bunx eslint src/cli/app/shell-app.tsx src/cli/transcript/model.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx`

# 2026-03-20 Unified Execution Tree + Main-Agent-Only Output

## Plan

- [x] Unify transcript and solidified task rendering so all runId-backed task items use the same execution-block components.
- [x] Preserve completed task blocks while sibling tasks continue running, paused, or waiting for review.
- [x] Remove fake assistant follow-ups from detached task completions so only true main-agent continuations speak outward.
- [x] Verify focused transcript/controller/shell regressions and capture any new task/HIL lessons.

## Review

- `Transcript`, `ActiveTranscript`, and `SolidifiedBlock` now share the same execution-tree renderer, so runId-backed task items keep the same hierarchy shape in the live area and after they move into scrollback.
- Mixed parallel states now stay cumulative: when one sibling finishes, its execution block remains visible as `Done (...)` while the other task blocks continue updating below it.
- Detached task completions no longer queue fake assistant notices from child summaries; outward-facing completion now belongs only to the real main-agent continuation path, while child progress stays inside execution blocks.
- Core-message `Task` ToolResults no longer dump raw delegated child summaries into the transcript; they now project as compact task execution summaries, so child prose stays hidden while the execution tree remains visible.
- Verification:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/components/conversation/transcript.tsx src/cli/components/conversation/solidified-block.tsx src/capability/task/middleware.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts`
# 2026-03-20 Unified Task Tree + Approval Queue Contract

## Plan

- [x] Reproduce the current regressions from the user's real CLI smoke: early main-agent continuation during parallel batches, missing completed execution blocks while siblings still run, and approval queue handoff after the current review is submitted.
- [x] Add focused failing tests for:
  - pending-placeholder batch sizing so main-agent continuation does not start before the full parallel batch is done;
  - active transcript retention of completed task blocks even when runtime events no longer carry the finished run;
  - suppression of child-summary leakage from synthesized/missing completed blocks.
- [x] Implement the minimal runtime/UI fixes so:
  - tracked task batches count pending placeholders and only resume the main agent after the full batch completes;
  - the active execution tree projects grouped task blocks from `activeTasks`, preserving done rows while siblings still run and without leaking child prose;
  - approval queue progression remains foreground and independent of transcript/task list state.
- [x] Verify focused controller/transcript/shell tests and lint touched files, then update lessons with the new contract.

## Review

- The grouped execution tree was still runtime-event-driven, which meant completed rows could disappear as soon as the rolling runtime-event buffer moved on; the UI was grouping only running items instead of projecting the whole live batch.
- `src/cli/components/conversation/transcript.tsx` now projects active execution rows from `activeTasks` whenever the active transcript owns a task batch. This keeps parallel batches stable as one grouped block and preserves done rows while siblings remain running/paused.
- Grouped task rows now carry their own status line (`Running / Waiting for review / Done / Failed`) under the task label, which matches the user's desired `3 agents -> task 1 Done / task 2 Running` shape without swallowing completed siblings.
- Synthetic task rows created from run summaries no longer fall back to `activeTask.detail` when the task is already done/error, so child summaries do not leak back into the visible execution tree.
- `src/cli/hooks/use-active-tasks.ts` now keeps completed/error task rows visible while any sibling task in the same session is still running or paused; the old 15s linger cutoff now only applies once no live sibling tasks remain. This fixes the bottom `Tasks` panel shrinking from `3` to `2` mid-batch.
- `src/cli/app/use-cli-controller.ts` now tracks pending task placeholders as `expectedCount` for a batch, so main-agent continuation cannot begin until the full parallel batch has actually reached terminal states.
- Verification:
  - `bun test tests/unit/cli/active-tasks.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/use-cli-controller.test.tsx`
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx eslint src/cli/components/conversation/transcript.tsx src/cli/hooks/use-active-tasks.ts src/cli/app/use-cli-controller.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/solidified-transcript.test.ts`

# 2026-03-20 Live Running Task Tool Counts
# 2026-03-20 Unified Task Tree + Approval Queue Contract II

## Plan

- [x] Make approval/HIL a true floating queue: foreground one approval at a time, no empty gap after submit, no prompt input while review is active.
- [x] Keep grouped execution trees cumulative during parallel batches: completed sibling rows stay inside the grouped block as `Done (...)` while others continue `Running/Paused`.
- [x] Keep the bottom `Tasks` panel as an independent summary list that does not drop completed siblings while the batch is still active.
- [x] Ensure task/tool activity is owned exclusively by execution blocks; no duplicate bottom activity line for task tool progress.
- [x] Ensure all outward-facing final prose comes only from the main agent after batch completion handoff; no child/subagent summary leakage.
- [x] Verify with focused unit tests and a real `bun run dev` smoke covering single-task, parallel-task, and parallel-approval scenarios.

## Review

- `src/cli/app/use-cli-controller.ts` now keeps the current approval in a busy foreground state during submit/resume, then swaps directly to the next queued approval after refresh instead of clearing the HIL window first.
- `src/cli/app/shell-app.tsx` now treats permission review the same as AskUser for floating-overlay purposes, hides the prompt while HIL is active, and still keeps the floating `Tasks` summary panel visible behind the overlay.
- `src/cli/components/conversation/transcript.tsx` and `src/cli/components/conversation/solidified-block.tsx` now share the same execution-tree rendering contract, so live and solidified task blocks keep the same hierarchical shape.
- Parallel grouped execution trees are now projected from task summaries instead of only transient runtime lines, which keeps completed sibling rows visible as `Done (...)` while other rows continue `Running/Paused`.
- `src/cli/hooks/use-active-tasks.ts` preserves completed siblings in the bottom summary list for as long as the batch still has running/paused members.
- `src/cli/transcript/model.ts` continues filtering synthetic/pending task bookkeeping and child-summary leakage so only real run-backed execution blocks appear in the user-visible tree.
- Focused verification passed:
  - `bun test tests/unit/cli/active-tasks.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx`
  - `bunx eslint src/cli/components/conversation/transcript.tsx src/cli/components/conversation/solidified-block.tsx src/cli/transcript/model.ts src/cli/hooks/use-active-tasks.ts src/cli/app/use-cli-controller.ts src/cli/app/shell-app.tsx tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/conversation/hil-panel.test.tsx`
- Real `bun run dev` smoke was attempted for the complex 3-subagent prompt, but this run stayed in parent `Thinking...` and never advanced into task orchestration during capture. The current confidence for the orchestration/HIL contract is therefore backed by deterministic tests plus targeted code review, not by a full fresh live frame sequence.

# 2026-03-20 Team Focus + Unified HIL Queue

## Plan

- [x] Make runtime `teamSurface.activeTeamId` the canonical focused-team source and stop duplicating conflicting focus truth in controller-only state.
- [x] Derive focused team detail from `getTeamDetail() + runtime member activity` instead of mutating mirrored detail objects in the controller.
- [x] Give team-member approvals the same foreground fast-path semantics as delegated task approvals.
- [x] Keep team summary panel and focused team detail coexisting as separate floating surfaces, with HIL still taking foreground priority.
- [x] Verify focused controller/shell/team-runtime/approval tests and lint touched files.

## Review

- `src/cli/app/use-cli-controller.ts` now reads focused team identity from runtime `teamSurface`, mirrors only the minimal dashboard view mode locally, and derives `teamDetailState` from stable team detail plus runtime member activity instead of mutating a second controller-owned source of truth.
- The initial core-state hydrate now runs once per controller lifecycle, which removed the repeated React `Maximum update depth exceeded` loop and fixed the single-approval handoff case where HIL was being re-hydrated after submit.
- Team-member review pauses now fast-path to the same foreground HIL behavior as delegated task review pauses, so `task/team/AskUser` all share one approval queue model.
- `src/cli/app/shell-app.tsx` now allows focused team detail and the floating team summary panel to coexist instead of replacing one another, while the prompt still hides behind HIL overlays.
- Team summary/detail visibility is now global across sessions at the facade/query layer; visibility is handled in UI/runtime focus, not by session-filtering the registry.
- The `Teams` summary panel now includes paused rows explicitly, and the footer keeps member-selection hints available whenever any team remains active or paused.
- Obsolete slash-command team enter/leave action branches were removed from the command/control-plane types so runtime team focus now flows only through canonical `teamSurface` context updates.
- Verification:
  - `bun test tests/unit/cli/use-team-detail.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bun test tests/unit/middleware/team-context.test.ts tests/unit/teams/team-runtime.test.ts tests/unit/durability/approval-store.test.ts tests/unit/cli/active-teams.test.ts`
  - `bun test tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/chrome.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/core/codara-facade.test.ts tests/unit/durability/approval-store.test.ts tests/unit/middleware/team-context.test.ts tests/unit/teams/team-runtime.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/hooks/use-team-detail.ts src/cli/app/shell-app.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/use-team-detail.test.ts tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/cli/components/chrome/team-panel.tsx src/cli/app/shell-app.tsx src/cli/app/use-cli-controller.ts src/cli/hooks/use-active-teams.ts src/cli/hooks/use-team-detail.ts src/capability/command/runtime/types.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/chrome.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/core/codara-facade.test.ts tests/unit/durability/approval-store.test.ts`

# 2026-03-20 Single-Team Leader Model

## Plan

- [x] Reproduce the current mismatch where the default Team experience behaves like multiple peer teams instead of a single active team led by the main agent.
- [x] Add focused failing tests for:
  - refusing `create_team` while already leading an active team;
  - hiding the team summary panel when focused team detail is visible;
  - synthesizing the main agent as the leader row in focused team detail.
- [x] Implement the minimal runtime/UI changes so:
  - conversation tools and `/team create` both enforce one active team per session unless the leader explicitly leaves/switches first;
  - focused team detail becomes the primary floating team surface while the summary panel stays for unfocused/global situations only;
  - focused team members always include the main agent as leader even though no separate leader session is spawned.
- [x] Verify team-focused tests and lint for the touched paths.

## Review

- The user clarified that the default product mental model is not “many peer teams in one session”; it is “one active team, with the main agent as leader, plus workers underneath”.
- `src/capability/team/surface/conversation-tools.ts` now refuses `create_team` while already focused on an active team and directs the leader to use teammates inside the current team instead of spawning peer teams by default.
- `src/capability/command/builtin/team.ts` now mirrors the same guard for `/team create`, using canonical runtime context from `getAgentState()` so slash commands and conversation tools no longer diverge.
- `src/cli/app/shell-app.tsx` now hides the floating team summary panel whenever focused team detail is visible, which avoids the “multiple peer teams” visual emphasis during normal single-team work.
- `src/cli/hooks/use-team-detail.ts` now injects a synthetic `Codara` leader row into focused detail when the runtime detail only contains spawned workers, matching the intended “main agent is leader” contract.
- Focused verification passed:
  - `bun test tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/shell-app.test.ts`
  - `bun test tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/chrome.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/middleware/team-context.test.ts tests/unit/teams/team-runtime.test.ts tests/unit/core/codara-facade.test.ts -t "team|Team|focused|single peer team"`
  - `bun test tests/unit/core/codara-facade.test.ts -t "should refuse creating a second peer team while the current session is already leading one"`
  - `bunx eslint src/capability/command/builtin/team.ts src/capability/team/surface/conversation-tools.ts src/capability/team/middleware.ts src/capability/team/prompts.ts src/cli/app/shell-app.tsx src/cli/hooks/use-team-detail.ts tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/shell-app.test.ts tests/unit/core/codara-facade.test.ts`

# 2026-03-21 Leader-First Team Bootstrap And Same-Turn Context Propagation

## Plan

- [x] Reproduce the live CLI bug where `create_team` followed by `spawn_teammate` in the same turn fails because the second tool cannot see the first tool's context update.
- [x] Add focused regression coverage for same-turn `Command.update.context` visibility and one-turn `create_team -> spawn_teammate`.
- [x] Fix tool execution so later tool calls in the same parent turn read the current merged `state.context` instead of a stale runtime snapshot.
- [x] Simplify the default teams UX so `spawn_teammate` auto-reuses the only available team or bootstraps a leader-only team when no active team exists.
- [ ] Re-run real `bun run dev` smoke for leader-first team bootstrap and approval flow.

## Review

- `src/core/agent/run/tool-executor.ts` now derives `configurable.context` from the current durable `state.context` merged with `runtime.runtimeContext`, which fixes same-turn tool chaining for `Command.update.context`.
- `tests/unit/agents/tool-execution.test.ts` now locks two contracts:
  - a tool can write context and the next tool in the same AI response can read it;
  - `create_team` followed by `spawn_teammate` in the same parent response succeeds.
- `src/capability/team/surface/conversation-tools.ts` now treats `spawn_teammate` as the leader-first bootstrap path:
  - use the currently focused team if one exists;
  - otherwise reuse the only resumable/running team if there is exactly one;
  - otherwise auto-create a leader-only team and then spawn the worker;
  - if multiple teams exist without focus, still require explicit `enter_team`.
- `tests/cases/teams/local-team-lifecycle.case.test.ts` now locks the new default UX: `spawn_teammate` bootstraps a running team when no active team exists.
- Focused verification passed:
  - `bun test tests/unit/agents/tool-execution.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/components/teams/team-detail-view.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/durability/approval-store.test.ts`
  - `bunx eslint src/core/agent/run/tool-executor.ts src/core/agent/run/turn.ts src/capability/team/surface/conversation-tools.ts src/cli/hooks/use-active-teams.ts src/cli/app/shell-app.tsx src/cli/app/use-cli-controller.ts src/cli/transcript/model.ts src/cli/components/chrome/team-panel.tsx tests/unit/agents/tool-execution.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx`

# 2026-03-21 Single Active Team Surface Simplification

## Plan

- [x] Add focused regressions for the simplified default team surface:
  - without an explicit focus, a single visible active team still projects as the default current team;
  - CLI/desktop copy no longer teaches `create_team` as the normal path.
- [x] Reword team tooling so `spawn_teammate` is the default leader-first entry and multi-team commands are clearly advanced/manual.
- [x] Simplify the summary projection/UI around a single current team instead of a registry-first `teams[]` view.
- [x] Re-run focused tests and lint for touched team surface files.

## Review

- `src/cli/hooks/use-active-teams.ts` no longer hides the team surface when there is exactly one visible running/paused/completed team and no explicit focus. In the default product model, that sole visible team now projects as the current team automatically.
- `src/capability/team/surface/conversation-tools.ts` was reordered and reworded so `spawn_teammate` is the clear default entry. `create_team`, `enter_team`, `leave_team`, and `list_teams` are still available, but are now described as advanced/manual flows rather than the normal path.
- `src/capability/team/prompts.ts` now explicitly instructs the leader to default to a single active team and treat peer teams/sub-teams as rare, explicit cases.
- `src/capability/command/builtin/team.ts` now teaches the same leader-first model in slash-command copy: `/team list` and `/team jobs` no longer tell the user to start by creating a separate team.
- `src/desktop/pages/TeamsPage.tsx` now says `Saved Teams` and points users toward staffing the current leader team with `spawn_teammate` instead of teaching `create_team`.
- `src/cli/components/chrome/team-panel.tsx` now uses `Current Team` copy for the single-team default case.
- Deleted dead multi-team dashboard baggage that was no longer on the real front path:
  - `src/cli/hooks/use-team-dashboard.ts`
  - `src/cli/components/teams/team-dashboard.tsx`
  `src/cli/app/use-cli-controller.ts` now carries the tiny local team-surface view type it still needs instead of importing the old dashboard model.
- Verification:
  - `bun test tests/unit/cli/active-teams.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/agents/tool-execution.test.ts`
  - `bun test tests/unit/cli/active-teams.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx tests/unit/core/codara-facade.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/agents/tool-execution.test.ts tests/unit/durability/approval-store.test.ts`
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/active-teams.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/core/codara-facade.test.ts tests/cases/teams/local-team-lifecycle.case.test.ts`
  - `bunx eslint src/cli/hooks/use-active-teams.ts src/cli/components/chrome/team-panel.tsx src/capability/team/surface/conversation-tools.ts src/capability/team/prompts.ts src/capability/command/builtin/team.ts src/desktop/pages/TeamsPage.tsx tests/unit/cli/active-teams.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/hooks/use-active-teams.ts src/cli/components/chrome/team-panel.tsx src/capability/team/surface/conversation-tools.ts src/capability/team/prompts.ts src/capability/command/builtin/team.ts src/desktop/pages/TeamsPage.tsx tests/unit/cli/active-teams.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/core/codara-facade.test.ts`

# 2026-03-21 Current Team Workspace Final Pass

## Plan

- [x] Verify the actual input-routing contract for team focus: switching into a team must route user input to that team's leader view while the global main session/runtime stays alive in the background.
- [x] Remove remaining registry-first default UX so the CLI foreground defaults to the current team workspace rather than a separate team-summary shell.
- [x] Rework the desktop Teams page to be current-team-first, with saved/recoverable teams treated as secondary history/recovery data rather than the main page shape.
- [x] Tighten worker lifecycle semantics so workers read as ephemeral execution members under the current leader/team, and confirm whether runtime teardown or foreground hiding is the right contract.
- [x] Run focused tests, lint, and a real `bun run dev` team smoke before declaring the teams pass done.

## Review

- Team focus/input routing is now explicitly `global main session stays alive, but foreground input routes to the focused team's leader view`.
- CLI default UX is current-team-first: when only one current workspace is visible, the floating summary shell stays hidden and the current team detail becomes the primary surface.
- Desktop `TeamsPage` was reshaped around `Current Team Workspace`, with saved/recoverable teams demoted to a secondary recovery/history section.
- Worker lifecycle is now treated as ephemeral execution state under the current leader/team; completed/failed teams clear worker registry rows on shutdown/kill.
- Transcript noise was reduced for team orchestration:
  - team bookkeeping tool results (`team_status`, `plan_jobs`, `assign_job`, etc.) are suppressed from the main transcript;
  - `write_todos` bookkeeping is hidden from the main transcript;
  - leader launch/progress chatter is suppressed while the current team workspace owns the coordination flow.
- Focused verification passed:
  - `bun test tests/unit/cli/shell-app.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/teams/team-runtime.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/active-teams.test.ts`
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/durability/approval-store.test.ts`
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx eslint src/cli/app/shell-app.tsx src/capability/team/prompts.ts src/capability/team/middleware.ts src/capability/team/runtime/team-runtime.ts src/desktop/pages/TeamsPage.tsx src/cli/components/chrome/team-panel.tsx src/cli/transcript/model.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/components/chrome/team-panel.test.tsx tests/unit/teams/team-runtime.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/active-teams.test.ts`
  - `bunx eslint src/codara/assembly/collaboration.ts src/codara/facade.ts src/cli/hooks/use-team-detail.ts src/cli/components/teams/team-detail-view.tsx src/cli/components/teams/member-panel.tsx src/desktop/pages/TeamsPage.tsx tests/unit/core/codara-facade.test.ts tests/unit/cli/use-team-detail.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx tests/cases/teams/local-team-lifecycle.case.test.ts tests/unit/durability/approval-store.test.ts`

# 2026-03-21 Current Team Workspace Claude-Code Alignment Final Pass

## Plan

- [x] Remove remaining registry-first UX from the default desktop team surface.
- [x] Make current-team workspace the only default frontstage and demote recovery/switching UI to a secondary surface.
- [x] Tighten focused team detail copy/layout so it reads as leader + members workspace, not team registry detail.
- [x] Add focused tests for current-team selection and recovery/list separation.
- [x] Re-run focused team/desktop verification and record the result.

## Review

- `src/capability/command/builtin/team.ts` now frames `/team` as a current-workspace command surface first, with `create/list/enter/leave` explicitly called out as advanced recovery/switching flows. The empty-list copy now says `No recoverable teams yet`.
- `src/cli/components/teams/team-detail-view.tsx` now reads as a `Current Team Workspace`, surfaces the current leader explicitly, and reduces footer copy to leader controls rather than registry-style navigation.
- `src/cli/components/teams/member-panel.tsx` now frames the roster as `Leader & Teammates` and avoids `members/workers` wording that reads like a detached registry.
- Verification passed:
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/capability/command/builtin/team.ts src/cli/components/teams/team-detail-view.tsx src/cli/components/teams/member-panel.tsx tests/unit/core/codara-facade.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx`

- `src/capability/command/builtin/team.ts` now describes `/team` as a current workspace command surface first, with `create/list/enter/leave` explicitly labeled as advanced recovery/switching paths. The empty-list copy now says `No recoverable teams yet`.
- `src/cli/components/teams/team-detail-view.tsx` now reads as a `Current Team Workspace`, surfaces the current leader explicitly, and reduces footer copy to leader controls rather than registry-style navigation.
- `src/cli/components/teams/member-panel.tsx` now frames the roster as `Leader & Teammates` and avoids `members/workers` wording that reads like a detached registry.
- Focused verification passed:
  - `bun test tests/unit/core/codara-facade.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx tests/unit/cli/shell-app.test.ts`
  - `bunx eslint src/capability/command/builtin/team.ts src/cli/components/teams/team-detail-view.tsx src/cli/components/teams/member-panel.tsx tests/unit/core/codara-facade.test.ts tests/unit/cli/components/teams/team-detail-view.test.tsx`

- `src/desktop/pages/TeamsPage.tsx` now makes the current workspace the only default surface in the desktop `Teams` page. The page metrics are workspace-local, and saved/recoverable teams are only visible inside a secondary `Recovery / history` disclosure.
- A focused desktop unit test now locks the current-team selection and recovery-list separation: [tests/unit/desktop/teams-page.test.ts](/Users/nako/WebstormProjects/github/thefoxfairy/Codara/tests/unit/desktop/teams-page.test.ts).
- Verification passed:
  - `bun test tests/unit/desktop/teams-page.test.ts`
  - `bunx eslint src/desktop/pages/TeamsPage.tsx tests/unit/desktop/teams-page.test.ts`

# 2026-03-21 CLI Review Surface And Transport Unification

## Plan

- [x] Rename the remaining CLI `hil`-named review surface to `review`, including controller state, review input handling, floating panel, and auto-action plumbing.
- [x] Align the transcript/render layer so user-facing review items project as `review` instead of `hil`, while leaving the lower-level runtime event kind untouched.
- [x] Replace outward-facing bus/SSE `paused` review events with a unified `review_required` transport event.
- [x] Re-run focused CLI, transcript, and SSE verification and record the results.

## Review

- The CLI review control surface now reads consistently as `review`:
  - `src/cli/app/review-state.ts`
  - `src/cli/hooks/use-review-input.ts`
  - `src/cli/components/conversation/review-panel.tsx`
  - `src/cli/app/use-cli-controller.ts`
  - `src/cli/app/shell-app.tsx`
  - `src/cli/main.tsx`
- Controller and projection naming were flattened around the unified review model:
  - `CliReviewState`, `CliReviewAction`, `reviewIndex/reviewCount`, `selectPreviousReview/selectNextReview`, and `submitReviewAction` now replace the old `hil/approval`-named UI control terms.
  - Auto-review configuration is now read from `CODARA_CLI_REVIEW_AUTO_ACTIONS`.
- The transcript/render layer no longer exposes review UI as `hil`:
  - `src/cli/transcript/model.ts` maps runtime `kind: 'hil'` events to transcript role `review`.
  - `src/cli/components/conversation/transcript.tsx` and `src/cli/utils/theme.ts` now color and label that role as `review`.
- Outward transport is unified around review requests:
  - `src/bus/types.ts` now exposes `type: 'review_required'` instead of `type: 'paused'`.
  - `src/bus/bus.ts` emits `review_required` when a blocking review is active.
  - `src/server/bus-manager.ts` forwards SSE `event: 'review_required'`.
  - `src/server/channel.ts` now sends SSE `review_required` events for pause/review requests.
- Focused verification passed:
  - `bun test tests/unit/cli/review-input.test.ts tests/unit/cli/review-state.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/channel/sse-channel.test.ts`
  - `bun test tests/unit/cli/transcript-model.test.ts tests/unit/cli/chrome.test.ts tests/unit/cli/status-indicator.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/channel/sse-channel.test.ts`
  - `bunx eslint src/cli/utils/theme.ts src/cli/components/conversation/transcript.tsx src/cli/transcript/model.ts src/cli/app/view-state.ts src/cli/app/review-state.ts src/cli/app/runtime-projection.ts src/cli/app/use-cli-controller.ts src/cli/app/shell-app.tsx src/cli/hooks/use-review-input.ts src/cli/components/conversation/review-panel.tsx src/cli/main.tsx src/bus/types.ts src/bus/bus.ts src/bus/client.ts src/server/bus-manager.ts src/server/channel.ts tests/unit/cli/review-input.test.ts tests/unit/cli/review-state.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/chrome.test.ts tests/unit/cli/status-indicator.test.ts tests/unit/channel/sse-channel.test.ts`
  - `git diff --check`
  - `rg -n "event: 'paused'|type: 'paused'|\\bHilPanel\\b|useHilInput|submitHilAction|moveHil|toggleHil|hil-review|use-hil-input|hil-panel|CODARA_CLI_HIL_AUTO_ACTIONS" src/cli src/bus src/server tests/unit/cli tests/unit/channel tests/cases -g'*.ts*'`

## 2026-03-22 Runtime Dev Verification For AskUser

- [ ] Inspect dev entrypoint and launch the real app/CLI runtime.
- [ ] Reproduce the AskUser flow in the running app and compare it directly against the Claude Code screenshots/reference.
- [ ] Fix any remaining runtime-visible mismatch, then re-run tests, lint, tsc, and diff checks.

## Review

- The CLI interaction ingress is now unified around a single routed hook and surface model:
  - `src/cli/hooks/use-cli-interaction-input.ts` is now the only live keyboard ingress for prompt, review, completion, command output, and session picker surfaces.
  - `src/cli/app/view-state.ts` now exposes `focusedSurface`, `activeKind`, `pendingCount`, and `promptBlocked` instead of the older `inputTarget` split.
  - `src/cli/app/shell-app.tsx` now resolves one active interaction surface and feeds that into a single hook, instead of wiring separate prompt/review hooks.
  - `src/cli/components/chrome/footer.tsx` now derives help text from the routed surface model rather than the old prompt-vs-review split.
- The obsolete dual-input hooks were removed:
  - deleted `src/cli/hooks/use-prompt-input.ts`
  - deleted `src/cli/hooks/use-review-input.ts`
  - review key resolution now lives in `src/cli/hooks/review-input-action.ts`
- This leaves the CLI with one maintainable control-plane seam:
  - surface routing in `shell-app`
  - interaction scheduling in `use-cli-controller`
  - one keyboard ingress in `use-cli-interaction-input`
- Verification for the unified ingress refactor passed:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/chrome.test.ts`
  - `bunx eslint src/cli/app/use-cli-controller.ts src/cli/app/view-state.ts src/cli/app/shell-app.tsx src/cli/components/chrome/footer.tsx src/cli/hooks/review-input-action.ts src/cli/hooks/use-cli-interaction-input.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/chrome.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`
- Follow-up AskUser submit bug fix:
  - `src/cli/app/use-cli-controller.ts` now suppresses a just-submitted foreground review while runtime state is still settling, so the same AskUser form cannot be re-projected and visually reset after `Submit answers`.
  - Added a focused regression in `tests/unit/cli/use-cli-controller.test.tsx` that models the live path where AskUser exists as a focused review item and runtime removal lags behind the submit.
  - Verification passed:
    - `bun test tests/unit/cli/use-cli-controller.test.tsx --test-name-pattern "waits for a foreground AskUser pause to settle before submitting the final review action|keeps the completed AskUser review dismissed while runtime removal settles after Submit answers"`
    - `bunx eslint src/cli/app/use-cli-controller.ts tests/unit/cli/use-cli-controller.test.tsx`
    - `bunx tsc --noEmit --pretty false`
    - `git diff --check`
- Follow-up AskUserQuestion tool-call hardening:
  - `src/core/middleware/ask-user-question.ts` now normalizes string-like values for `summary`, `tab`, `submitLabel`, question labels/questions, and option labels instead of hard-failing on non-string model payloads.
  - Added a focused regression in `tests/unit/middleware/interaction-middleware.test.ts` covering a live-like malformed `summary` object so the middleware pauses cleanly instead of crashing the wrapToolCall chain.
  - Verification passed:
    - `bun test tests/unit/middleware/interaction-middleware.test.ts --test-name-pattern "tolerate non-string summary values instead of crashing the middleware chain|createAskUserQuestionMiddleware"`
    - `bunx eslint src/core/middleware/ask-user-question.ts tests/unit/middleware/interaction-middleware.test.ts`
    - `bunx tsc --noEmit --pretty false`
    - `git diff --check`

- AskUser review rendering is now scoped back to the review surface itself; no new `welcome` behavior is coupled to this fix.
- `src/cli/components/conversation/review-panel.tsx` now matches the Claude Code ask layout more closely:
  - neutral step strip for question tabs
  - `✔ Submit` as the dedicated final step
  - numbered options plus automatic `Type something.`
  - standalone `Next` row
- `src/cli/app/review-state.ts` now treats question pages as a unified navigation surface so arrow movement can reach `Next` from the option list and move back into the list cleanly.
- Live verification used the real prompt `我希望我们可以讨论下产品形态，ai的，你可以提供一些选项给我参考下，有单选，多选的，啥的` through `bun run dev`, waited until AskUser appeared, and confirmed:
  - a top divider instead of `Review 1/1` / `Use [ and ] to switch reviews`
  - step strip with short labels and `✔ Submit`
  - numbered options
  - `Type something.`
  - standalone `Next`
  - review footer `Enter to select  ·  Tab/Arrow keys to navigate  ·  Esc to cancel`
- Follow-up correction after another live/user review:
  - `src/cli/app/use-cli-controller.ts` no longer routes arbitrary typing on a highlighted preset option into the custom-answer path;
  - `src/cli/app/review-state.ts` now only enters draft-edit mode when the custom row is actually selected (or for true `text` tabs), which keeps the focus arrow and the selected custom answer aligned;
  - `src/cli/components/conversation/review-panel.tsx` now renders custom draft text inline on the `Type something.` row and replaces the placeholder once the user starts typing, matching the Claude Code feel more closely;
  - custom-entry mode now still accepts numeric shortcuts to switch back to preset options;
  - focused regression coverage was added in `tests/unit/cli/use-cli-controller.test.tsx`, `tests/unit/cli/components/conversation/review-panel.test.tsx`, and tightened in `tests/unit/cli/review-state.test.ts`.
- Focused verification passed:
  - `bun test tests/unit/cli/review-state.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-input.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/core/codara-commands.test.ts`
  - `bunx eslint src/cli/app/review-state.ts src/cli/app/shell-app.tsx src/cli/app/use-cli-controller.ts src/cli/components/chrome/footer.tsx src/cli/components/conversation/review-panel.tsx src/cli/hooks/use-review-input.ts src/core/middleware/ask-user-question.ts src/durability/session/session.ts tests/unit/cli/review-state.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-input.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/core/codara-commands.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

## 2026-03-22 AskUser Multiselect Custom-State Validation

### Plan

- [x] Align the multiselect AskUser regression sample with the real live labels so preset selections are not mistaken for custom values.
- [x] Add controller/render regression coverage for the exact live path: select preset -> focus `Type something.` -> switch back to another preset.
- [x] Attempt live `bun run dev` sanity checks against the multiselect AskUser flow and record whether any production-path issue remains.

### Review

- Corrected the multiselect AskUser regression sample so preset selections now use the same labels as the rendered options; this removed a false-positive path where tests were treating a preset label as a custom answer.
- Added controller and renderer regression coverage for the user-reported flow: preset selection -> custom-row focus -> switch back to another preset. The custom row now stays `Type something.` until a real custom value exists.
- Fixed a real navigation bug in `src/cli/app/review-state.ts`: when moving from a custom inline answer back onto a preset option in a single-select question, the answer now snaps back to that preset instead of leaving stale custom text behind.
- The multiselect custom row is now a real selectable item even before any custom text exists; selecting `Type something.` marks it as chosen without forcing immediate text entry, while still allowing other preset options to be toggled afterward.
- Fixed the final AskUser `Submit answers` race in `src/cli/app/use-cli-controller.ts`: foreground review submission now waits briefly for the underlying session pause to settle out of `running` before sending the resume, which prevents `Agent is currently running.` from surfacing on the final submit page.
- Verification passed:
  - `bun test tests/unit/cli/review-state.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-input.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx eslint src/cli/app/review-state.ts src/cli/components/conversation/review-panel.tsx src/cli/app/use-cli-controller.ts tests/unit/cli/review-state.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`
- Two real `bun run dev` sanity runs were attempted with AskUser-focused prompts, but the live session stayed in long-running thinking / skill selection and never emitted an AskUser review surface, so model-side live confirmation for this exact multiselect case is still blocked even though the controller/render path is now covered by focused regression tests.

## 2026-03-22 AskUser Live Runtime Failure Root Cause

### Plan

- [x] Reproduce the latest live `bun run dev` failure instead of relying on unit tests or the surfaced middleware name.
- [x] Identify the actual schema/tool causing the first-turn runtime crash and separate tool-facing schema requirements from runtime-tolerant parsing.
- [x] Re-run focused verification plus real live CLI validation until the AskUser questionnaire appears again.

### Review

- Reproduced the exact live failure with `bun run dev "我希望我们可以讨论下产品形态，ai的，你可以提供一些选项给我参考下，有单选，多选的，啥的"` and confirmed the session died in turn 1 with `Middleware "TodoListMiddleware" failed in wrapModelCall: Transforms cannot be represented in JSON Schema`.
- Traced the real root cause past the surfaced middleware name:
  - the failure was not `TodoListMiddleware`'s own state schema;
  - it was the inner `AskUserQuestion` tool schema in `src/core/middleware/ask-user-question.ts`, which still exposed transform-bearing `ZodPipe` nodes to the model binding layer.
- Refactored `src/core/middleware/ask-user-question.ts` so the tool-facing schema is now pure JSON-schema-friendly Zod:
  - removed transform-bearing `z.preprocess(...)` fields from the exported tool schema;
  - kept runtime tolerance by moving malformed/string-like payload normalization into the internal parser path (`parseAskUserInput` and helpers).
- Added a regression in `tests/unit/middleware/interaction-middleware.test.ts` that asserts the AskUser tool-facing schema no longer contains transform nodes on key fields, while preserving tolerant parsing of malformed live payloads.
- Live verification now reaches the questionnaire again instead of failing on turn 1:
  - the same `bun run dev` prompt now shows `Thinking...`, assistant lead-in text, and the AskUser review surface with the question tabs and options;
  - the previous immediate `Turn 1 failed` path is gone.
- Verification passed:
  - `bun test tests/unit/middleware/interaction-middleware.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/core/codara-commands.test.ts`
  - `bunx eslint src/core/middleware/ask-user-question.ts tests/unit/middleware/interaction-middleware.test.ts src/cli/app/use-cli-controller.ts src/cli/app/review-state.ts src/cli/components/conversation/review-panel.tsx`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`
  - real `bun run dev` reproduction with the same Chinese AskUser prompt

## 2026-03-22 AskUser Live Foreground Handoff Cleanup

### Plan

- [x] Remove visible `Skill` blocks and prevent AskUser turns from leaking assistant prose before the questionnaire takes foreground.
- [x] Make the live controller/transcript treat AskUser and Skill as internal control-plane steps, not ordinary visible assistant content.
- [x] Re-run targeted CLI tests plus real `bun run dev` to verify the questionnaire appears cleanly in the foreground.

### Review

- Tightened the live interaction model so prompt-surface assistant text is buffered until the turn outcome is known:
  - ordinary prompt text is now buffered in `CliActiveTurn.pendingResponse`;
  - if the same turn hands off to an internal interaction tool like `AskUserQuestion` or `Skill`, that buffered prose is dropped instead of being shown and then retracted;
  - if the turn remains a normal assistant reply, the buffered text is finalized at stream end.
- `src/cli/app/use-cli-controller.ts` now explicitly suppresses the foreground prompt turn when an AskUser review takes over, instead of letting the review and same-turn prose compete for the front surface.
- `src/cli/transcript/model.ts` and `src/shared/tool-display.ts` continue to keep `Skill` hidden from the user-facing transcript/runtime projection, so skill loading behaves as internal control-plane.
- Prompt contracts were tightened in `.codara/codara.md` and `.codara/skills/superworkers/brainstorming/SKILL.md`: if the model decides to call `AskUserQuestion`, that response must contain only the tool call and no assistant prose.
- Live verification with `bun run dev "我希望我们可以讨论下产品形态，ai的，你可以提供一些选项给我参考下，有单选，多选的，啥的"` now lands directly on the AskUser questionnaire surface without a visible `Skill` block and without the earlier assistant prose lingering in the final foreground state.
- Verification passed:
  - `bun test tests/unit/cli/interaction-turn.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/transcript-model.test.ts`
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/shell-app.test.ts tests/unit/cli/components/conversation/review-panel.test.tsx tests/unit/cli/review-state.test.ts tests/unit/cli/review-input.test.ts`
  - `bunx eslint src/cli/app/interaction-turn.ts src/cli/app/use-cli-controller.ts src/cli/app/view-state.ts src/cli/transcript/model.ts tests/unit/cli/interaction-turn.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/transcript-model.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

## 2026-03-22 Task Coordination vs Delegation Semantics

### Plan

- [x] Finish the in-progress `src/capability/task` rename so deleted root-level files are no longer referenced.
- [x] Reshape the directory around Claude Code semantics: shared task coordination vs delegated/background subagent runs.
- [x] Re-run task/subagent/facade verification and record whether any old-path or old-layer residue remains.

### Review

- Completed the semantic split under `src/capability/task/`:
  - `coordination/` now owns shared task graph persistence and `TaskCreate/TaskUpdate/TaskList`.
  - `delegation/` now owns subagent/background run persistence, runtime, launch prep, completion guard, and the delegated `Task` tool.
- Removed old root-level live-path references to:
  - `store.ts`
  - `run-store.ts`
  - `runtime.ts`
  - `tools.ts`
  - `task-tool.ts`
  - `task-prompting.ts`
  - `internal/*`
- Moved delegation-only prompt helpers into `src/capability/task/delegation/prompting.ts` so the task root now reads as capability entrypoints plus shared types, instead of a mixed bucket of coordination and delegation internals.
- Verified that deleted-path imports are gone from `src` and `tests`; remaining task imports now point at explicit semantic paths such as:
  - `coordination/store`
  - `coordination/tools`
  - `delegation/store`
  - `delegation/runtime`
  - `delegation/tool`
  - `delegation/agent`
- Deliberately did not extract a generic shared persistence helper between the two stores in this pass:
  - the stores share minor JSON/file scaffolding,
  - but their domain behavior is distinct enough that another abstraction layer would currently add more indirection than clarity.
- Verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/depth-limit.test.ts`
  - `bunx eslint src/capability/task/index.ts src/capability/task/middleware.ts src/capability/task/tool-types.ts src/capability/task/coordination/store.ts src/capability/task/coordination/tools.ts src/capability/task/delegation/agent.ts src/capability/task/delegation/completion-guard.ts src/capability/task/delegation/launch-preparation.ts src/capability/task/delegation/prompting.ts src/capability/task/delegation/runtime.ts src/capability/task/delegation/store.ts src/capability/task/delegation/support.ts src/capability/task/delegation/tool.ts src/codara/facade.ts src/core/agent/index.ts tests/unit/tasks/depth-limit.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `rg -n "@capability/task/(store|run-store|runtime|task-tool|tools|internal)" src tests`
  - `git diff --check`

## 2026-03-22 Task File Count Reduction

### Plan

- [x] Re-evaluate whether `completion-guard`, `prompting`, and `launch-preparation` deserve standalone files after the semantic split.
- [x] Merge single-consumer helpers back into their owning files where the split only added indirection.
- [x] Re-run task/subagent verification and confirm no deleted helper path remains in the live code path.

### Review

- Reduced `src/capability/task` further by removing three single-consumer helper files:
  - `delegation/completion-guard.ts`
  - `delegation/prompting.ts`
  - `delegation/launch-preparation.ts`
- Folded those responsibilities back into their owning files:
  - `middleware.ts` now owns task-completion prompt injection and the delegated-task completion guard.
  - `delegation/tool.ts` now owns delegated launch preparation, which is only used by the Task tool.
- Kept `delegation/support.ts` as the remaining shared helper boundary because it is still used across middleware/tool/runtime recovery paths; merging it now would create a larger mixed file without reducing indirection meaningfully.
- Confirmed that deleted helper names no longer appear in `src` or `tests`, and the task capability now sits at 11 TypeScript files instead of the previous 14-file split.
- Verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/depth-limit.test.ts`
  - `bunx eslint src/capability/task/middleware.ts src/capability/task/delegation/tool.ts src/capability/task/delegation/support.ts`
  - `bunx tsc --noEmit --pretty false`
  - `rg -n "task-prompting|internal/task-|@capability/task/(store|run-store|runtime|task-tool|tools|internal)|delegation/(completion-guard|launch-preparation|prompting)" src tests`
  - `git diff --check`
# 2026-03-22 Claude Code-Aligned Task Coordination And Subagent Delegation Split

## Plan

- [ ] Reframe capability boundaries using the Claude Code docs: `task` stays shared coordination/task-list only, `subagent` owns delegation/background runs/resume/middleware/system-message flow.
- [ ] Clean `src` live paths so codara/review/approval/observability/transcript no longer use old Task-delegation naming, ids, or user-facing labels.
- [ ] Remove dead/duplicate launch helpers and old `task_run` / `Task tool` residuals from shared paths and prompts.
- [ ] Update tests and `.codara` prompts to the new `Agent` delegation surface and `agent_run` terminology without compatibility aliases.
- [ ] Re-run focused task/subagent/review/transcript verification, plus residual scans for old names and paths.

## Notes

- `src/capability/task/coordination/store.ts` and `src/capability/subagent/store.ts` are not business-logic duplicates. The overlap is persistence scaffolding, not domain semantics.
- The real architectural bug was that delegated runs still looked like they belonged under `task/*` instead of a dedicated `subagent/*` capability root.
- The next cleanup must prioritize:
  - subagent-owned middleware and system-message behavior
  - codara/review/approval references to `agent_run`
  - removal of user-facing `Task tool` wording where the delegation surface is now `Agent`

## Review

- Kept `src/capability/task/` coordination-only and moved the remaining live delegation surface to `src/capability/subagent/`.
- Removed the final stale launch helper path by deleting `src/shared/task-run-launch.ts`; all live imports now point at `@shared/agent-run-launch`.
- Cleaned residual `task_run` / `Task tool` terminology from approval-store coverage, observability coverage, transcript/closeout tests, and the multi-profile CLI case wiring.
- Fixed a real residual in `tests/cases/helpers/cli-runtime-factory.ts` where the `multi-profile-coordination` scenario still referenced `createTaskMiddleware` without importing it after the split.
- Confirmed the current `Agent` child semantics align with the Claude Code docs for fresh subagent bootstrap:
  - built-in `Agent` no longer inherits parent-session base system prompt wording,
  - recovered child options no longer deep-clone parent `context`/`values`,
  - the prompt-manual inheritance CLI case now asserts the fresh-bootstrap behavior instead of the old inherited-prompt behavior.
- Verified both the runtime/control-plane cleanup and the docs-aligned subagent behavior:
  - `bun test tests/unit/durability/approval-store.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/middleware.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/task-closeout.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/hil-unified/hil-unified.test.ts tests/unit/agents/task-tool-delegation.test.ts`
  - `bun test tests/cases/subagents/prompt-manual-inheritance.case.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/task-skills/task-skill-coordination.case.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/task-tool-limits.test.ts tests/unit/tasks/depth-limit.test.ts`
  - `bunx eslint src/cli/task-closeout.ts src/cli/app/use-cli-controller.ts src/cli/hooks/use-active-tasks.ts src/cli/transcript/model.ts tests/unit/durability/approval-store.test.ts tests/unit/observability/events-formatters.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/middleware.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/task-closeout.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/hil-unified/hil-unified.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts src/capability/subagent/middleware.ts src/capability/subagent/support.ts src/capability/subagent/tool.ts src/context/skills/runtime-shared.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`
# 2026-03-22 Subagent Bootstrap And Persistence Alignment

## Plan

- [ ] Shrink `src/capability/subagent/run-store.ts` so it only persists run index/state, not child bootstrap snapshot fields like prompt/systemMessages/toolNames.
- [ ] Normalize `AgentRunQuerySummary` and related assembly/query consumers to use explicit `parentSessionId` / `childSessionId` only.
- [ ] Introduce a single subagent bootstrap compilation path so child middleware/system prompt/context assembly no longer happens ad hoc across `tool.ts`, `agent.ts`, and runtime assembly.
- [ ] Re-run focused subagent/task/facade regressions, eslint, typecheck, and diff-check.
# 2026-03-22 Subagent Run Index And Query Naming Cleanup

## Plan

- [ ] 收窄 `src/capability/subagent/run-store.ts`，只保留 run index 所需字段，不再持久化 child bootstrap snapshot。
- [ ] 拉直 `AgentRunQuerySummary`，移除歧义 `sessionId`，统一使用 `parentSessionId` / `childSessionId`。
- [ ] 把 subagent recovery 所需的 bootstrap 信息从 run-store 剥离，改成 subagent 自己的 recovery spec。
- [ ] 跑 focused tests、eslint、tsc、diff-check，确认没有旧 task/subagent 残留。
# 2026-03-22 Subagent Recovery And Naming Cleanup

## Plan

- [x] Remove bootstrap snapshot residue from `src/capability/subagent/run-store.ts` and keep it as a run index only.
- [x] Move delegated child recovery ownership from run-store persistence to approval/pause metadata.
- [x] Rename the remaining high-signal `task-run` test paths and parent-session controller names to `agent-run` / `parentSessionId`.
- [x] Re-run focused unit/case regressions, eslint, typecheck, and diff-check.

## Review

- `src/capability/subagent/types.ts` and `src/capability/subagent/run-store.ts` no longer persist bootstrap-only fields such as `recovery`, `toolNames`, `systemMessages`, or `maxTurns`; the store is back to being a delegated run index.
- Restart-safe resume now rebuilds child bootstrap from approval metadata written at pause time instead of reusing run-store snapshots or recompiling from ambiguous state:
  - `src/capability/subagent/runtime.ts` writes `codara.agentRecovery` metadata onto paused approvals.
  - `src/capability/subagent/tool.ts` reads that metadata to reconstruct child `tools`, `systemMessage`, and `maxTurns`.
- This keeps recovery on the control-plane path (`approval/pause`) and out of run persistence, which is closer to the Claude Code docs and easier to reason about.
- High-signal naming drift was reduced:
  - `src/codara/assembly/agent-runs.ts` now filters by `parentSessionId`.
  - `src/cli/app/use-cli-controller.ts` uses `parentSessionId` inside tracked delegated batches and completion continuations.
  - real-case and facade tests now use `.codara/agent-runs` / `.codara/case-agent-runs` instead of `task-runs`.
- Verification passed:
  - `bun test tests/unit/tasks/run-store-file.test.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/cases/task-skills/task-skill-coordination.case.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts`
  - `bunx eslint src/capability/subagent src/codara/assembly/agent-runs.ts src/cli/app/use-cli-controller.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/task-skills/task-skill-coordination.case.test.ts tests/cases/subagents/multi-profile-coordination.case.test.ts tests/cases/subagents/prompt-manual-inheritance.case.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/active-tasks.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Subagent Middleware Ownership Split

## Plan

- [x] Keep `src/capability/subagent/middleware.ts` as a thin assembly layer only.
- [x] Move child runtime middleware composition into a dedicated subagent-owned module.
- [x] Move completion handoff / replay guard policy into a dedicated subagent-owned module.
- [x] Re-run focused task/subagent/facade regressions, eslint, and typecheck.

## Review

- `src/capability/subagent/middleware.ts` is now a thin assembler again:
  - creates runtime/store
  - wires the `Agent` tool
  - injects available subagent definitions
  - delegates completion-guard policy to dedicated helpers
- Child bootstrap middleware ownership moved to:
  - `src/capability/subagent/child-middlewares.ts`
- Completion handoff and duplicate-replay blocking moved to:
  - `src/capability/subagent/completion-handoff.ts`
- This keeps subagent-owned bootstrap and subagent-owned continuation policy out of one 400+ line mixed file, which makes later Claude Code alignment work easier to maintain.
- Focused verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx eslint src/capability/subagent tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts`
  - `bunx tsc --noEmit --pretty false`

# 2026-03-22 Review Naming And Control-Plane Cleanup

## Plan

- [x] Remove remaining live `hil` naming from source/runtime/control-plane paths and keep `review` as the single public/low-level term.
- [x] Keep `task` as coordination only and `subagent` as delegated/background execution only; avoid reintroducing mixed `task`/review naming in transcript/runtime paths.
- [x] Update middleware/runtime/transcript/channel tests and validation to match the renamed review contract.
- [x] Re-run focused review/permission/cli/subagent regressions, eslint, typecheck, and diff-check.

## Review

- Low-level middleware naming is now single-track:
  - `src/core/middleware/review.ts` is the canonical module.
  - `src/core/middleware/index.ts` only exports `Review*` names.
  - `src/index.ts` and runtime consumers now import `Review*` names exclusively.
- Tool payloads and runtime context are aligned with the same contract:
  - structured tool messages use `review_pause` / `review_deny`
  - resume context uses `context.review`
  - `MIDDLEWARE_NAMES.Review` replaces the old HIL name
- Source/runtime consumers were updated together instead of leaving a mixed shell:
  - `src/core/agent/run/agent-loop.ts`
  - `src/core/agent/run/turn.ts`
  - `src/core/agent/models/agent.ts`
  - `src/capability/subagent/agent.ts`
  - `src/observability/events/controller.ts`
  - `src/cli/transcript/model.ts`
  - `src/integration/channel/review-adapter.ts`
- Focused verification passed:
  - `bun test tests/unit/middleware/review-middleware.test.ts tests/unit/middleware/review-request-metadata.test.ts tests/unit/middleware/review-resume-routing.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/permissions/middleware.test.ts tests/integration/permission-middleware.test.ts tests/unit/core/codara-middleware-stack.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/agents/runtime-input.test.ts tests/unit/agents/agent.test.ts tests/unit/agents/subagent.test.ts tests/unit/channel/review-adapter.test.ts tests/unit/channel/sse-channel.test.ts`
  - `bunx eslint src/core/middleware/review.ts src/core/middleware/index.ts src/core/middleware/ask-user-question.ts src/core/middleware/permission/middleware.ts src/core/middleware/permission/runtime.ts src/core/agent/run/agent-loop.ts src/core/agent/run/turn.ts src/core/agent/run/stream.ts src/core/agent/models/agent.ts src/capability/subagent/agent.ts src/capability/subagent/child-middlewares.ts src/codara/types.ts src/codara/assembly/middleware.ts src/observability/events/controller.ts src/cli/transcript/model.ts src/integration/channel/review-adapter.ts src/integration/channel/index.ts src/shared/contracts/channel.ts src/gateway/channel-bridge.ts src/core/pipeline/types.ts src/index.ts tests/unit/middleware/review-middleware.test.ts tests/unit/middleware/review-request-metadata.test.ts tests/unit/middleware/review-resume-routing.test.ts tests/unit/middleware/public-surface.test.ts tests/unit/core/codara-middleware-stack.test.ts tests/unit/agents/runtime-input.test.ts tests/integration/permission-middleware.test.ts tests/integration/skills/skills-review-multi-tab.e2e.test.ts tests/integration/skills/skills-review-permission-options.e2e.test.ts tests/integration/skills/skills-review-user-confirmation.e2e.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Review Contract And Interaction Scheduler Cleanup

## Plan

- [x] Rename the remaining low-level `Pause*` contracts on the live source/test path to `Review*`, including `pendingReview` state and `resumeReview*` session/runtime APIs.
- [x] Remove leftover review-control transport wording (`showPauseRequest`, `sendPausePrompt`, `onPauseResponse`) from gateway/channel paths where the product term is already `review`.
- [x] Extract the queued interaction scheduler state out of `src/cli/app/use-cli-controller.ts` into its own module without changing runtime behavior.
- [x] Re-run focused controller/review/gateway regressions, eslint, typecheck, and diff-check.

## Review

- Shared/core review contracts are now straight instead of half-renamed:
  - `src/shared/contracts/agent-types.ts` uses `ReviewRequest`, `ReviewResumePayload`, `ReviewUI*`, and `pendingReview`
  - `src/durability/session/session.ts` exposes `resumeReview` / `resumeReviewStream`
  - `src/codara/review-control.ts` returns the session `AgentResult` for foreground review resumes and keeps agent-run review resumes void
- Gateway/channel transport wording now matches the same review control-plane:
  - `showReviewRequest`
  - `sendReviewPrompt`
  - `onReviewResponse`
- CLI queue/drain state is no longer hidden in four refs inside the controller:
  - extracted to `src/cli/app/interaction-scheduler.ts`
  - `use-cli-controller.ts` now uses the scheduler for queued prompt/review/continuation ordering and keeps only the execution callbacks locally
- Transport-facing review prompt context is also straight now:
  - `src/gateway/types.ts` uses `ReviewPromptContext.review`
  - `src/gateway/channel-bridge.ts` sends `review`, not a half-renamed `pause`
  - channel/gateway tests now read the same `review` field as the live code path
- Dead legacy review naming in the CLI app path is gone; the old `hil-kind` helper is no longer part of the live source tree.
- Focused verification passed:
  - `bun test tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/runtime-projection.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/channel/review-adapter.test.ts tests/unit/gateway/review-integration.test.ts tests/unit/middleware/review-middleware.test.ts tests/unit/agents/runtime-input.test.ts`
  - `bun test tests/unit/gateway/channel-bridge.test.ts tests/unit/gateway/review-integration.test.ts tests/unit/channel/slack/plugin.test.ts tests/unit/channel/discord/plugin.test.ts tests/unit/channel/telegram/plugin.test.ts tests/unit/channel/feishu/plugin.test.ts tests/unit/channel/dingtalk/plugin.test.ts tests/unit/channel/wecom/plugin.test.ts`
  - `bun test tests/unit/middleware/review-middleware.test.ts tests/unit/middleware/review-request-metadata.test.ts tests/unit/middleware/review-resume-routing.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/permissions/middleware.test.ts tests/integration/permission-middleware.test.ts tests/unit/core/codara-middleware-stack.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/agents/runtime-input.test.ts tests/unit/agents/agent.test.ts tests/unit/agents/subagent.test.ts tests/unit/channel/review-adapter.test.ts tests/unit/channel/sse-channel.test.ts tests/unit/gateway/review-integration.test.ts`
  - `bunx eslint src/shared/contracts/agent-types.ts src/shared/contracts/channel.ts src/core/middleware/review.ts src/core/middleware/index.ts src/core/middleware/permission/runtime.ts src/codara/types.ts src/codara/review-control.ts src/cli/app/interaction-scheduler.ts src/cli/app/use-cli-controller.ts src/cli/app/runtime-projection.ts src/cli/app/view-state.ts src/cli/app/review-form-state.ts src/durability/session/session.ts`
  - `bunx eslint src/gateway/types.ts src/gateway/channel-bridge.ts src/gateway/gateway.ts src/integration/channel/contracts.ts src/integration/channel/qq/plugin.ts src/integration/channel/slack/plugin.ts src/integration/channel/discord/plugin.ts src/integration/channel/telegram/plugin.ts src/integration/channel/feishu/plugin.ts src/integration/channel/dingtalk/plugin.ts src/integration/channel/wecom/plugin.ts tests/unit/gateway/channel-bridge.test.ts tests/unit/gateway/review-integration.test.ts tests/unit/channel/slack/plugin.test.ts tests/unit/channel/discord/plugin.test.ts tests/unit/channel/telegram/plugin.test.ts tests/unit/channel/feishu/plugin.test.ts tests/unit/channel/dingtalk/plugin.test.ts tests/unit/channel/wecom/plugin.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Subagent Tool Ownership And Review Query Cleanup

## Plan

- [x] Move non-tool responsibilities out of `src/capability/subagent/tool.ts` so the file owns dispatch instead of recovery plumbing and run-reuse messaging.
- [x] Clean the remaining review query/shared-channel naming debt (`session_pause`, `pause request`) without touching low-level paused/resume runtime mechanisms.
- [x] Re-run focused task/subagent/cli/runtime regressions, lint, typecheck, and diff-check.

## Review

- `src/capability/subagent/tool.ts` now owns the public Agent tool shape and launch compilation only.
- Run reuse / duplicate-launch messaging moved to:
  - `src/capability/subagent/launch-reuse.ts`
- Recovery-only child option rebuilding moved to:
  - `src/capability/subagent/recovery.ts`
- This keeps `tool.ts` aligned with Claude Code’s dispatch mental model instead of mixing dispatch, recovery, and reuse policy in one file.
- Review query wording is now straight at the middle control-plane layer:
  - `ReviewQuerySource` uses `session_review`
  - `src/codara/assembly/reviews.ts` uses `foregroundReview`
  - `src/shared/contracts/channel.ts` documents `review request`
  - CLI review helpers no longer mention `current pause` / `permission pause metadata`
- I explicitly did **not** rename low-level runtime state like `paused` / `resume` in `core/agent` or `subagent/runtime`; those are implementation mechanics, not stale HIL/review UX names.
- Focused verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/tasks/depth-limit.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/transcript-model.test.ts tests/unit/cli/agent-runs.test.ts tests/unit/cli/solidified-transcript.test.ts`
  - `bunx eslint src/capability/subagent src/capability/task src/codara src/shared/contracts/channel.ts src/cli/app/review-form-state.ts src/cli/app/review-permission-state.ts tests/unit/cli/runtime-projection.test.ts tests/unit/cli/use-cli-controller.test.tsx`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Task And Subagent Naming/Ownership Realignment

## Plan

- [x] Flatten `src/capability/task` back to root files and remove the extra coordination subdirectory layer.
- [x] Collapse the `subagent` outward API to a single public middleware entry, and rename the rest of the capability surface so it no longer collides with `core/agent`.
- [x] Re-run focused task/subagent/facade regressions, lint, typecheck, and diff-check.

## Review

- `src/capability/task` is now the flat coordination surface again:
  - `types.ts`
  - `store.ts`
  - `tools.ts`
  - `index.ts`
- The extra public `TaskMiddleware` layer was removed; task coordination now stays as tools/stores, while the outward delegation capability lives under `subagent`.
- `subagent` naming now matches its role instead of looking like a second core-agent system:
  - `createSubagentMiddleware`
  - `createSubagentTool`
  - `createSubagentCoordinator`
  - `createSubagentRunMemoryStore`
  - `createSubagentRunFileStore`
  - `SubagentRunRecord`
  - `SubagentRunStore`
- The coordinator remains a wrapper over `core/bootstrapAgent`, so the actual execution engine is still single-owner under `src/core/agent`.
- `codara` wiring was updated to use the same vocabulary:
  - `subagentRunStore`
  - `subagentCoordinator`
- Focused verification passed:
  - `bun test tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-facade.test.ts tests/cases/review/subagent-activity-display.case.test.ts`
  - `bunx eslint src/capability/subagent/*.ts src/capability/task/*.ts src/codara/*.ts src/codara/assembly/*.ts src/index.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-facade.test.ts tests/cases/helpers/cli-runtime-factory.ts tests/cases/review/subagent-activity-display.case.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Subagent Surface Simplification And Vocabulary Cleanup

## Plan

- [x] Remove the remaining `Delegated*` / tool-centric naming from the live subagent path and replace it with `Subagent*` / child-run wording.
- [x] Rename the subagent orchestration owner from `coordinator` to `runManager` on the live source path.
- [x] Keep `task` flat and coordination-only while leaving `subagent` as the single outward capability entry.
- [x] Re-run focused subagent/task/facade/transcript verification plus residual scans.

## Review

- `subagent` now reads more directly as:
  - `bootstrap.ts`
  - `tool.ts`
  - `run-manager.ts`
  - `run-store.ts`
  - `review-metadata.ts`
  - `middleware.ts`
- The old tool-centric vocabulary is gone from the live subagent source path:
  - `DelegatedAgentResult` -> `SubagentResult`
  - `DelegatedAgentOptions` -> `SubagentOptions`
  - `DelegatedChildInput` -> `SubagentBuildInput`
  - `DelegatedParentRuntimeMetadata` -> `SubagentParentRuntimeMetadata`
  - `mergeDelegatedPauseMetadata` -> `mergeSubagentPauseMetadata`
  - `readDelegatedParentRuntimeMetadata` -> `readSubagentParentRuntimeMetadata`
- Review metadata no longer stores `parentToolName`; it now anchors subagent review state to child session/recovery data directly.
- The orchestration owner is now named for what it actually does:
  - `createSubagentRunManager`
  - `SubagentRunManager`
  - `subagentRunManager`
- `task` remains a flat coordination-only surface with no extra outward middleware shell.
- Focused verification passed:
  - `bun test tests/unit/agents/review-metadata.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/agents/task-tool-definitions.test.ts`
  - `bunx eslint src/capability/subagent/*.ts src/capability/task/*.ts src/codara/*.ts src/codara/assembly/*.ts src/shared/*.ts tests/unit/agents/review-metadata.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/agents/task-tool-definitions.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `git diff --check`

# 2026-03-22 Subagent Init And Review Contract Cleanup

## Plan

- [x] Move child instruction assembly toward a single `childInstructionContext` contract instead of scattered `childPrepareContext + childSystem*` fields.
- [x] Let context own child base-bundle loading and path-scoped instruction middleware creation.
- [x] Thin review-control so it depends on subagent review resume behavior, not the whole run manager interface.
- [x] Verify focused subagent/task/facade/review paths and residual naming scans.

## Review

- `subagent` now receives one explicit child instruction contract:
  - `childInstructionContext.loadBaseSystemMessage`
  - `childInstructionContext.prepareContext`
  - `childInstructionContext.middlewares`
- Child path-scoped instruction loading is now part of that same instruction contract, so child runs keep the normal path-instruction flow instead of relying on main-only middleware wiring.
- `subagent/bootstrap.ts` no longer owns the old `childPrepareContext + childSystemMessages + childSystemPrompt` split; child system bundle extension is built from:
  - base bundle from context
  - child-specific `systemMessages`
  - profile/tool prompts
- `SubagentBuildInput` was reduced to actual child-build inputs; it no longer carries launch-only fields that the builder did not use.
- `review-control` now depends on a thinner `SubagentReviewResumer` contract instead of the whole `SubagentRunManager`.
- `codara/assembly/middleware.ts` no longer reaches for the raw Agent tool constant or reads/writes subagent middleware option bags itself; those checks/merges moved back behind subagent-owned helpers.
- Focused verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/core/codara-facade.test.ts tests/unit/review-unified/review-unified.test.ts`
  - `bun test tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-facade.test.ts tests/unit/cli/subagent-runs.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/chrome/subagent-run-panel.test.tsx tests/unit/review-unified/review-unified.test.ts tests/cases/review/subagent-activity-display.case.test.ts`
  - `bunx tsc --noEmit --pretty false`
  - `bunx eslint src/capability/subagent/*.ts src/codara/*.ts src/codara/assembly/*.ts src/context/session-bundle/base-system-message.ts src/codara/assembly/context.ts tests/unit/tasks/middleware.test.ts tests/unit/review-unified/review-unified.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-facade.test.ts`
  - `git diff --check`
# 2026-03-22 Subagent/Task Test-Type Drift Repair

## Plan

- [x] Reconcile the child-middleware test with the current subagent middleware surface.
- [x] Update CLI and task fixtures to the current run-summary, layout, and resume contracts.
- [x] Fix the stale permission and interaction middleware test typings with the current public API.
- [x] Re-run `bun run typecheck` and the targeted tests for the touched files.

## Review

- `tests/unit/agents/child-middlewares.test.ts` now uses the current subagent child-middleware export.
- `tests/unit/cli/use-cli-controller.test.tsx`, `tests/unit/cli/solidified-transcript.test.ts`, `tests/unit/cli/ui-alignment.test.tsx`, and `tests/unit/cli/interaction-turn.test.ts` now match the current CLI/run-summary contracts.
- `tests/unit/middleware/interaction-middleware.test.ts`, `tests/unit/permissions/middleware.test.ts`, `tests/unit/commands/compact.test.ts`, `tests/unit/core/codara-agent-runtime.test.ts`, and `tests/unit/tasks/depth-limit.test.ts` were updated to the current runtime shapes.
- Verification passed:
  - `bun run typecheck`
  - `bun test tests/unit/agents/child-middlewares.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/tasks/depth-limit.test.ts tests/unit/cli/interaction-turn.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/use-cli-controller.test.tsx tests/unit/commands/compact.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/permissions/middleware.test.ts tests/unit/agents/task-tool-definitions.test.ts`

# 2026-03-22 Subagent Ownership And Init Cleanup

## Plan

- [x] Move subagent completion handoff ownership back under `src/capability/subagent`.
- [x] Keep child bootstrap on the single `core/agent` bootstrap path while making subagent build inputs explicit.
- [x] Stop leaking main-conversation skills bundle assembly into child instruction bootstrap.
- [x] Re-run broad subagent/task/review/CLI verification and residual scans before merge.

## Review

- `src/capability/subagent` now owns its own completion handoff again via `completion.ts`; the old `src/codara/subagent-completion.ts` shim is gone.
- Child initialization is clearer:
  - `subagent/tool.ts` validates and compiles launch input
  - `subagent/bootstrap.ts` builds child bootstrap options
  - `subagent/run-manager.ts` launches/resumes tracked child runs
  - `core/bootstrapAgent -> createAgent` remains the only actual agent bootstrap path
- `codara/assembly/middleware.ts` no longer forwards the main-conversation skills source into child instruction bootstrap. Child runs keep project/context bootstrap, but do not inherit the parent conversation skills prompt.
- `review-control` and assembly now depend on thinner subagent-owned contracts instead of reaching into codara-owned subagent shims.
- Broad verification passed:
  - `bun test tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/tasks/depth-limit.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/agents/review-metadata.test.ts tests/unit/agents/child-middlewares.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/cli/subagent-runs.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/chrome/subagent-run-panel.test.tsx tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/transcript-visibility.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/interaction-turn.test.ts tests/unit/commands/compact.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/permissions/middleware.test.ts tests/unit/review-unified/review-unified.test.ts tests/unit/durability/approval-store.test.ts tests/unit/observability/events-formatters.test.ts tests/cases/review/subagent-activity-display.case.test.ts`
  - `bun run typecheck`
  - `bunx eslint src/capability/subagent src/capability/task src/codara/assembly/middleware.ts src/codara/review-control.ts src/context/session-bundle/base-system-message.ts src/codara/assembly/context.ts tests/unit/tasks/middleware.test.ts tests/unit/tasks/public-surface.test.ts tests/unit/tasks/run-store.test.ts tests/unit/tasks/run-store-file.test.ts tests/unit/tasks/depth-limit.test.ts tests/unit/agents/subagent.test.ts tests/unit/agents/subagent-task.test.ts tests/unit/agents/review-metadata.test.ts tests/unit/agents/child-middlewares.test.ts tests/unit/agents/task-tool-definitions.test.ts tests/unit/agents/task-tool-delegation.test.ts tests/unit/core/codara-facade.test.ts tests/unit/core/public-api-surface.test.ts tests/unit/core/codara-agent-runtime.test.ts tests/unit/cli/subagent-runs.test.ts tests/unit/cli/use-cli-controller.test.tsx tests/unit/cli/components/chrome/subagent-run-panel.test.tsx tests/unit/cli/runtime-projection.test.ts tests/unit/cli/shell-app.test.ts tests/unit/cli/solidified-transcript.test.ts tests/unit/cli/transcript-model.test.ts tests/unit/cli/transcript-visibility.test.ts tests/unit/cli/ui-alignment.test.tsx tests/unit/cli/interaction-turn.test.ts tests/unit/commands/compact.test.ts tests/unit/middleware/interaction-middleware.test.ts tests/unit/permissions/middleware.test.ts tests/unit/review-unified/review-unified.test.ts tests/unit/durability/approval-store.test.ts tests/unit/observability/events-formatters.test.ts tests/cases/review/subagent-activity-display.case.test.ts`
  - `git diff --check`
