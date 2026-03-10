# TODO

- [x] 从入口开始做完整架构审计：`createCodara -> sessions -> agents -> middleware -> checkpoint -> skills -> tasking -> commands`
- [x] 找出重复装配、错位抽象、过宽接口、跨目录心智拼接
- [x] 给出新的全局目标结构图与保留/删除/合并策略
- [x] 完成当前这一轮结构重构，不再按局部症状修补
- [x] 审计当前工具执行路径，确认并行能力的正确归属与约束
- [x] 设计并实现显式 tool execution policy，只对纯读取工具开放安全并行
- [x] 验证并行执行不会破坏 `Task/todo/bash/edit/write` 等状态型工具语义

## Review

- 已完成一轮自上而下的 runtime 审计，并落了两处关键重构：
  - `task/subagent/shared tasks` 收成独立 `tasking/*` 顶层域
  - `AGENTS` source lifecycle 从过宽的泛化 provider 收窄成 `AgentsSource` / `agents-files`
- `Session` 宿主层已按职责拆薄：保留会话生命周期，抽离 metadata、model selection、AGENTS 文件动作等纯辅助逻辑。
- `conversation-context`、`summary`、`context-budget` 这条主线确认是正确的，没有再被误拆。
- 顶层与域级 barrel 已从 `export *` 收成显式导出，减少内部实现持续泄漏到上层 API。
- 当前最主要的风险已从 runtime 主线转移为“历史文档残留旧设计”，已对关键旧文档补充历史说明，避免继续误导后续协作。
- 这轮新增了显式 `ToolExecutionPolicy`，并把并行调度收在 `agents/loop/tool-step.ts`，没有把并行语义散到 middleware、session 或单个 tool 实现中。
- 只读 builtin tools（`read/glob/grep/fetch/search`）现在允许安全并行；`Task/todo/bash/edit/write` 等状态型工具仍保持串行屏障。
- self-review 结论：当前工具并行策略的归属是对的，属于 agent loop 调度层，而不是 host surface 或 middleware 生命周期层。
