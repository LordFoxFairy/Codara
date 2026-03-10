# TODO

- [x] 从入口开始做完整架构审计：`createCodara -> sessions -> agents -> middleware -> checkpoint -> skills -> tasking -> commands`
- [x] 找出重复装配、错位抽象、过宽接口、跨目录心智拼接
- [x] 给出新的全局目标结构图与保留/删除/合并策略
- [x] 完成当前这一轮结构重构，不再按局部症状修补

## Review

- 已完成一轮自上而下的 runtime 审计，并落了两处关键重构：
  - `task/subagent/shared tasks` 收成独立 `tasking/*` 顶层域
  - `AGENTS` source lifecycle 从过宽的泛化 provider 收窄成 `AgentsSource` / `agents-files`
- `Session` 宿主层已按职责拆薄：保留会话生命周期，抽离 metadata、model selection、AGENTS 文件动作等纯辅助逻辑。
- `conversation-context`、`summary`、`context-budget` 这条主线确认是正确的，没有再被误拆。
- 顶层与域级 barrel 已从 `export *` 收成显式导出，减少内部实现持续泄漏到上层 API。
- 当前最主要的风险已从 runtime 主线转移为“历史文档残留旧设计”，已对关键旧文档补充历史说明，避免继续误导后续协作。
