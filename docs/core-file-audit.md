# Core File Audit

This audit records why each `src/core` TypeScript file exists and whether its current role is justified.
The goal is to keep the runtime centered on `createAgent(...)`, prevent domain leakage, and avoid thin files that only add naming noise.

## Top-level directory baseline

Every architecture review should start from this map instead of from a single file:

- `agents/` — execution kernel
- `sessions/` — conversation host
- `checkpoint/` — runtime snapshots
- `middleware/` — generic lifecycle stages
- `skills/` — skill discovery/runtime data
- `tasking/` — task/subagent domain
- `codara/` — product facade and default assembly
- `provider/` — model/provider runtime
- `tools/` — builtin tools and scheduling policy
- `workspace.ts` — workspace/root discovery helper

If a change does not clearly belong to one of these domains, stop and re-evaluate the design before adding files.

Verdict tags:
- `keep`: role is clear and justified
- `watch`: acceptable now, but likely to need future consolidation or split by real pressure
- `tightened`: recently refactored to remove prior structural drift

## `agents/`

- `agents/index.ts` — public execution-kernel surface for agent contracts and `createAgent`; `keep`
- `agents/input-budget.ts` — shared derivation of runtime input budget from model metadata; `keep`
- `agents/command.ts` — `Command(update)` contract and state-update application; `keep`
- `agents/contract/agent.ts` — canonical agent runtime/public contract; `keep`
- `agents/contract/stream.ts` — stream surface contract; `keep`
- `agents/engine/agent.ts` — concrete `createAgent(...)` implementation and host loop orchestration; `keep`
- `agents/engine/checkpoint.ts` — checkpoint persistence glue for runtime state; `keep`
- `agents/engine/lifecycle.ts` — invoke/resume guardrails for runtime state; `keep`
- `agents/engine/model.ts` — model binding and message/chunk normalization; `keep`
- `agents/engine/runtime-input.ts` — input normalization, runtime context merge, pause resume injection; `keep`
- `agents/engine/runtime.ts` — runtime dependency assembly (`model/tools/pipeline`); `keep`
- `agents/engine/state.ts` — mutable runtime-state shape and snapshot helpers; `keep`
- `agents/engine/stream-writer.ts` — stream envelope writer; `keep`
- `agents/engine/tools.ts` — tool-call execution glue and command artifact handling; `keep`
- `agents/loop/model-step.ts` — model-call stage using shared conversation-input assembly; `keep`
- `agents/loop/run.ts` — run-level orchestration and hook handling; `keep`
- `agents/loop/tool-step.ts` — tool scheduling and execution policy batching; `keep`
- `agents/loop/turn.ts` — per-turn stage orchestration; `keep`

## `sessions/`

- `sessions/index.ts` — narrowed session host export surface; `tightened`
- `sessions/agents.ts` — single AGENTS source lifecycle module (discovery, content load, file targets, cached source) and session-owned AGENTS file actions; `tightened`
- `sessions/metadata.ts` — session metadata shaping and agent-state projection; `keep`
- `sessions/model-selection.ts` — host-level model resolution and input-budget derivation bridge; `keep`
- `sessions/session.ts` — conversation host implementation (`hydrate/reload/fork/compact/invoke`); `watch`
- `sessions/store.ts` — session catalog persistence, distinct from checkpoint history; `keep`
- `sessions/telemetry.ts` — host-visible usage/context telemetry aggregation, not checkpoint state; `keep`
- `sessions/types.ts` — session contracts and host-level options/state; `keep`

## `checkpoint/`

- `checkpoint/index.ts` — checkpoint public surface; `keep`
- `checkpoint/file.ts` — file-backed checkpoint store and history compaction; `keep`
- `checkpoint/in-memory.ts` — in-memory checkpoint store; `keep`
- `checkpoint/state.ts` — checkpoint contract and snapshot conversion helpers; `keep`
- `checkpoint/types.ts` — store option types such as compact policy; `keep`

## `middleware/`

- `middleware/index.ts` — generic middleware surface plus curated convenience re-exports; `watch`
- `middleware/types.ts` — middleware lifecycle contracts and runtime shared/context boundaries; `keep`
- `middleware/pipeline.ts` — middleware registration, state normalization, hook dispatch; `keep`
- `middleware/execution.ts` — wrapped/simple stage execution internals; `keep`
- `middleware/guidelines.ts` — injects AGENTS content only; `tightened`
- `middleware/conversation-input.ts` — canonical model input assembly helper; `keep`
- `middleware/context-budget.ts` — derived budget snapshot estimation; `keep`
- `middleware/conversation-context.ts` — unified budget + summary stage; `keep`
- `middleware/summary.ts` — conversation compaction via summary message persistence; `keep`
- `middleware/todo.ts` — LangChain-style todo state + tool + prompt injection; `keep`
- `middleware/hil.ts` — human-in-the-loop interception, pause, resume protocol; `keep`
- `middleware/logging.ts` — structured middleware observability; `keep`

## `skills/`

- `skills/index.ts` — skills domain public surface; `keep`
- `skills/types.ts` — canonical skill metadata and command metadata contract; `keep`
- `skills/metadata.ts` — metadata normalization plus prompt formatting helpers; `watch`
- `skills/loading.ts` — frontmatter parsing and validation; `keep`
- `skills/store.ts` — filesystem discovery and TTL caching; `keep`
- `skills/agents.ts` — agent definition discovery and runtime-shared definitions; `keep`
- `skills/middleware.ts` — skills prompt injection and `runtime.shared.skills` population; `keep`

## `tasking/`

- `tasking/index.ts` — tasking domain public surface; `keep`
- `tasking/types.ts` — shared task record/store contracts; `keep`
- `tasking/store.ts` — shared task persistence (memory/file); `keep`
- `tasking/shared-tools.ts` — `TaskCreate/TaskUpdate/TaskList` coordination tools plus shared-task middleware facade; `tightened`
- `tasking/subagent.ts` — delegated agent primitive, raw delegation tool, and subagent middleware facade; `tightened`
- `tasking/task-tool.ts` — profile-aware `Task` delegation tool plus `Task` middleware facade; `tightened`

## Current architectural notes

- Runtime middleware injection is now intentionally a single contract: `middleware`. The previous `middleware/middlewares` dual-entry shape was removed because it added no semantics and kept the host/runtime API split-brained.

## `codara/`

- `codara/index.ts` — product-layer public surface; `keep`
- `codara/types.ts` — Codara facade/config contracts; `keep`
- `codara/models.ts` — product alias/model catalog assembly; `keep`
- `codara/tools.ts` — default tool assembly; `keep`
- `codara/skills.ts` — product-level skill discovery defaults; `keep`
- `codara/middleware.ts` — default middleware chain assembly and ordering; `keep`
- `codara/runtime.ts` — single source of truth for Codara runtime assembly; `keep`
- `codara/facade.ts` — top-level product facade and host command wiring; keep watching to ensure it delegates host concerns to `Session` rather than reassembling them; `watch`
- `codara/tasking.ts` — product wrappers for task/subagent tooling using resolved runtime defaults; `tightened`

## `codara/commands/`

- `codara/commands/index.ts` — command subsystem public surface; `keep`
- `codara/commands/types.ts` — host command contract, result, and action model; `keep`
- `codara/commands/parser.ts` — slash-command parser; `keep`
- `codara/commands/runner.ts` — built-in + dynamic command registry merge and execution dispatch; `tightened`
- `codara/commands/help.ts` — built-in `/help`; `keep`
- `codara/commands/memory.ts` — built-in `/memory` over AGENTS file actions; `keep`
- `codara/commands/reload.ts` — built-in `/reload`; `keep`
- `codara/commands/resume.ts` — built-in pause resume host command; `keep`
- `codara/commands/compact.ts` — built-in conversation/checkpoint compact host command; `keep`
- `codara/commands/skills.ts` — dynamic command bridge from skill metadata into command registry; `keep`

## `provider/`

- `provider/index.ts` — provider/model public surface; `keep`
- `provider/model.ts` — provider/model contracts; `keep`
- `provider/config/schema.ts` — routing config validation schema; `keep`
- `provider/config/loader.ts` — provider routing config load path; `keep`
- `provider/config/path.ts` — config path resolution; `keep`
- `provider/runtime/api-key.ts` — env/api key expansion; `keep`
- `provider/runtime/factory.ts` — concrete model construction; `keep`
- `provider/runtime/registry.ts` — alias/model registry runtime; `keep`

## `tools/`

- `tools/index.ts` — tool domain public surface; `keep`
- `tools/execution-policy.ts` — explicit tool scheduling policy contract; `keep`
- `tools/names.ts` — tool reference/name normalization helpers; `keep`
- `tools/utils.ts` — shared tool-level helpers; `keep`
- `tools/builtin/index.ts` — builtin tool export surface and assembly; `keep`
- `tools/builtin/read.ts` — read-only file tool; `keep`
- `tools/builtin/glob.ts` — glob tool; `keep`
- `tools/builtin/grep.ts` — grep/search-in-files tool; `keep`
- `tools/builtin/fetch.ts` — generic HTTP fetch tool; `keep`
- `tools/builtin/search.ts` — web search tool; `keep`
- `tools/builtin/bash.ts` — shell execution tool; `keep`
- `tools/builtin/edit.ts` — patch/edit tool; `keep`
- `tools/builtin/write.ts` — write-file tool; `keep`

## Cross-cutting notes

- The strongest remaining `watch` area is `sessions/session.ts`: it is the correct orchestration home, but it should only grow when responsibilities are still genuinely host-level.
- `middleware/index.ts` is intentionally still a convenience surface. It is acceptable now, but if it keeps absorbing domain exports, it should be tightened further.
- `skills/metadata.ts` is functionally fine, but it currently mixes schema/reducer logic with prompt formatting helpers; keep watching for pressure to split by responsibility, not by naming taste.
- `reloadSources()` belongs to `Session`: AGENTS source invalidation and skills discovery cache refresh are both conversation-host responsibilities, not facade-local glue.
