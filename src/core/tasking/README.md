# Tasking

`tasking/*` 是统一的委派执行与共享任务协调域。
这里的 delegation 心智对齐 DeepAgents：它是建立在通用 agent loop 之上的 middleware-maintained capability，不是 core 自己的一套特殊 runtime。
产品语义上按 `Task -> delegated child run` 理解：`Task` 是委派入口，child run 是其执行机制。

它负责：
- `Task` 背后的 delegation capability 与底层 helper
- 正式 `Task` 委派工具
- `TaskCreate/TaskUpdate/TaskList`
- `TaskStore`
- tasking middlewares

它不负责：
- agent 执行内核
- session 宿主生命周期
- skills discovery

分层：

```text
tasking/
  delegation.ts       # delegated child runner + helpers
  task.ts              # formal Task tool (public API stays runtime-agnostic)
  shared-tasks.ts      # TaskCreate/TaskUpdate/TaskList
  store.ts             # TaskStore implementations
  types.ts             # tasking domain types
```

规则：

- `agents/*` 保持纯执行内核，不再承载 task/subagent 领域文件。
- `middleware/*` 只保留 generic lifecycle domain；tasking 的 middleware facade 与对应 primitive 放在同一 tasking 文件中，避免再拆出一层薄 wrapper 目录。
- 根入口 / `@core` 和 `@core/tasking` 应只保留 `TaskMiddleware` 作为委派主入口；低层 delegation helper 退回 `@core/tasking/delegation`，`createTaskTool(...)` 退回 `@core/tasking/task` 作为内部实现。
- `skills` 只负责发现和解析；`Task` 通过 `runtime.shared.skills` 消费定义，不直接读 store。
- 宿主装配（例如 Codara child-agent 创建）通过 product layer 接入，不继续污染 tasking 核心 API。
- child delegation 的限制优先通过能力装配表达：创建 child 时直接剔除 delegation tools，而不是在运行期依赖 `agentType` 再做一层兜底分支。
