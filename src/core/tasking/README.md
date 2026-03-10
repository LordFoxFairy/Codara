# Tasking

`tasking/*` 是统一的委派执行与共享任务协调域。

它负责：
- `subagent` primitive
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
  subagent.ts          # delegated runner + primitive tool
  task-tool.ts         # formal Task tool
  shared-tools.ts      # TaskCreate/TaskUpdate/TaskList
  store.ts             # TaskStore implementations
  types.ts             # tasking domain types
  middleware/
    task.ts
    subagent.ts
    shared-tasks.ts
```

规则：

- `agents/*` 保持纯执行内核，不再承载 task/subagent 领域文件。
- `middleware/*` 只保留 lifecycle capability facade；tasking 的 middleware 放在 `tasking/middleware/*`。
- `skills` 只负责发现和解析；`Task` 通过 `runtime.shared.skills` 消费定义，不直接读 store。
