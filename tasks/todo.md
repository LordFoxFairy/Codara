# Codara Refactor Todo

## Usage

- `tasks/todo.md`: 只放任务、顺序、验收、进度
- `tasks/plan.md`: 放架构目标和整体方案
- 当前分支没有 `tasks/architecture-audit*.md`，所以本轮以 `tasks/plan.md` + `tasks/todo.md` 为执行基线

## Frozen Constraints

- [x] 冻结底层合同:
  - `BaseMiddleware` 6-hook surface
  - `MiddlewarePipeline`
  - tools/provider base abstractions
- [x] 冻结生命周期 owner:
  - `session` 只拥有 host lifecycle
  - `agent loop` 只拥有 execution lifecycle
- [x] 冻结已定稿边界:
  - `AGENTS.md` = source input
  - `state.context` = durable agent context
  - `checkpoint` = runtime snapshot history
  - `session metadata` = host catalog summary
- [x] 冻结默认 middleware 主链职责:
  - `logging` = observer
  - `guidelines` / `skills` / `conversation-context` = pre-model request shaping
  - `hil` = tool interception
- [x] 冻结 subagent 基线:
  - child 不自动继承 parent messages/context/values/runtime.shared/checkpoints

## Current Round Goal

- [x] 彻底收口当前仍然开放的 6 个架构切片:
  - lifecycle semantics
  - request-preparation slice
  - delegated-agent pause/resume
  - parallel tool state safety
  - shared task graph normalization
  - runtime assembly contract cleanup

## Execution Order

### Slice A: Lifecycle And Request Preparation

- [x] A1. 冻结 lifecycle semantics, 但不修改 middleware public contract
  - Layer:
    - `agent loop`
    - `middleware docs/comments/tests`
  - Goal:
    - 明确 `beforeAgent / afterAgent` 的真实触发时机
    - 文档、注释、测试不要再讲错 lifecycle story
  - Inspect first:
    - `src/core/agents/loop/run.ts`
    - `src/core/agents/loop/turn.ts`
    - `src/core/middleware/types.ts`
    - `src/core/README.md`
  - Accept when:
    - 新人不用翻实现两遍，也能回答 6 个 hooks 何时执行
    - touched docs/tests 与真实执行顺序一致

- [x] A2. 将 request-preparation slice 收成一个明确的 pre-model 领域
  - Layer:
    - `context-budget`
    - `conversation-context`
    - `summary`
  - Goal:
    - model input assembly 直接留在 `agents/loop/model-step.ts`
    - `context-budget` = transient heuristic snapshot
    - `summary` = compaction helper over messages
    - `conversation-context` = pre-model orchestration entry
  - Inspect first:
    - `src/core/middleware/context-budget.ts`
    - `src/core/middleware/conversation-context.ts`
    - `src/core/middleware/summary.ts`
    - `src/core/agents/loop/model-step.ts`
  - Accept when:
    - 这个 slice 不再被描述成 host owner、checkpoint owner、或假 durable conversation manager
    - 团队能清楚区分“每次 model call 重建的数据”和“进 checkpoint 的数据”

### Slice B: Delegation And Tool State Safety

- [x] B1. 收敛 delegated-agent pause/resume 语义
  - Layer:
    - `task/subagent`
    - `HIL`
    - `agent loop`
  - Goal:
    - 不再允许 child pause 但 parent 没有明确控制语义
    - delegated child 的 HIL 必须回到 parent/main 的控制链
    - 形成明确的 delegated pause/resume protocol，而不是 silent pause 或 child-local pause
  - Inspect first:
    - `src/core/tasking/subagent.ts`
    - `src/core/tasking/task.ts`
    - `src/core/codara/tasking.ts`
    - `src/core/middleware/hil.ts`
    - `src/core/agents/loop/turn.ts`
  - Accept when:
    - 不存在 silent paused child / complete parent 的中间态
    - 对应协议有直接测试证明

- [x] B2. 让 parallel tool execution 对 runtime state mutation 具备确定性
  - Layer:
    - `tool-step`
    - `Command`
    - tool execution policy
  - Goal:
    - `parallel_safe` 不只代表 IO 安全, 也要保证 runtime state 语义安全
    - 明确并固定一种策略:
      - parallel-safe tools 只读且不可发 runtime mutation
  - Inspect first:
    - `src/core/agents/loop/tool-step.ts`
    - `src/core/agents/engine/tools.ts`
    - `src/core/agents/command.ts`
    - `src/core/tools/execution-policy.ts`
  - Accept when:
    - 支持的 parallel case 下, tool batch 顺序不影响最终 runtime state

### Slice C: Coordination And Assembly

- [x] C1. 把 shared task graph 收成真实数据结构
  - Layer:
    - shared task coordination
  - Goal:
    - `blocks / blockedBy` 不再弱维护、可漂移
    - 建立 canonical relationship write path
    - 校验 task id、拒绝 self-dependency、拒绝明显 cycle
  - Inspect first:
    - `src/core/tasking/shared-tasks.ts`
    - `src/core/tasking/store.ts`
    - `src/core/tasking/types.ts`
  - Accept when:
    - dependency 查询、写入、状态流转都基于同一套 graph 规则

- [x] C2. 收紧 runtime assembly contract
  - Layer:
    - `codara runtime/facade/tasking`
    - public assembly API
  - Goal:
    - `runtime plan`、`resolved runtime`、`public assembly API` 不再轻微漂移
    - 去掉 dead fields / misleading fields
  - Inspect first:
    - `src/core/codara/runtime.ts`
    - `src/core/codara/facade.ts`
    - `src/core/codara/tasking.ts`
    - `src/core/index.ts`
  - Accept when:
    - 调用方看到的 runtime contract 与实际获得的能力一致
    - assembly layer 不再保留无效字段

## Cross-Cutting Verification

- [x] V1. 每个 slice 都有 focused tests 或更新的直接行为测试
- [x] V2. touched docs/comments 与实际控制流一致
- [x] V3. 除非任务明确要求, checkpoint 边界不变化
- [x] V4. `AGENTS.md` 和 skills 仍然不进入 persisted `messages`
- [x] V5. `/compact`、`/reload`、`/resume`、delegated tasking、normal invoke 仍然各有单一 owner
- [x] V6. 任何改动一旦引入第三个 lifecycle owner, 立即回滚设计并重做

## Delivery Plan

- [x] Round 1:
  - A1
  - A2
- [x] Round 2:
  - B1
  - B2
- [x] Round 3:
  - C1
  - C2
- [x] Round 4:
  - cross-cutting review
  - final verification
  - PR / review / merge

## Review Checklist

- [x] todo 只保留任务树, 没有长篇架构正文
- [x] 所有 open task 都能映射回 `plan.md`
- [x] 没有把已定稿边界重新列为 open work
- [x] 每个 task 都标明 layer、目标、验收

## Done Review

- A1/A2 已收成单一 request-preparation 主链:
  - `conversation-context` = 唯一公开 stage
  - `context-budget` = 内部 budget helper
  - `summary` = 内部 compaction algorithm
- B1 已闭环:
  - delegated child pause 会提升到 parent/main
  - `Task` 与 `Subagent` 两条入口都支持 child checkpoint resume
  - 对应协议已由 `subagent.test.ts` 与 `task-tool-delegation.test.ts` 直证
- B2 已闭环:
  - `parallel_safe` 只允许只读工具并发
  - `Command` 与 `artifact Command` 都不能再通过 parallel batch 改写 runtime state
  - 对应边界已由 `tool-scheduler.test.ts` 直证
- C1 已闭环:
  - `blocks / blockedBy` 通过单一 graph write path 双向维护
  - 拒绝 self-dependency、缺失 task id、明显 cycle
  - 内存与文件 task store 都会持久化 canonical dependency graph
- C2 已闭环:
  - `ResolvedCodaraRuntime` 与实际返回值重新对齐
  - runtime plan / resolved runtime / tasking wrappers 的 source 与 middleware 语义已由直接测试锁定
  - alias/catalog 路径与显式 model 路径的 inputBudget 语义已由直接测试锁定
- Final verification:
  - `bun run typecheck`
  - `bun run lint`
  - `bun test`
  - 结果: `333 pass / 0 fail`
