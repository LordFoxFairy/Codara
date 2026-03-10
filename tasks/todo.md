# TODO

- [x] 将 `task/subagent` 收成统一的 middleware 域，而不是散落的 tool factory + codara wrapper
- [x] 保留 `createAgent(...)` 为唯一执行内核，复用共享 delegated runner，不引入第二套 runtime
- [x] 将 `Task`、`delegate_to_subagent`、`TaskCreate/TaskUpdate/TaskList` 分成职责清晰的 middleware
- [x] 更新 codara 装配、导出和测试结构
- [x] 跑完 `typecheck`、`lint`、`test`

## Review

- `Task/subagent` 现在优先通过 middleware 暴露，工具注册和能力归属回到了同一层
- `createTaskMiddleware(...)`、`createSubagentMiddleware(...)`、`createSharedTaskMiddleware(...)` 分别承载委派、原始子代理和共享任务协调
- Codara 层新增 `createCodaraTaskMiddleware(...)` / `createCodaraSubagentMiddleware(...)`，不再只剩一个 `task-tool` wrapper
- 低层 `createTaskTool(...)` / `createSubagentTool(...)` 仍保留为 runtime primitive，但不再是推荐的主心智
- 已验证：`bun run typecheck`、`bun run lint`、`bun test`
