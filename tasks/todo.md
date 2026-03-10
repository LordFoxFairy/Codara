# TODO

- [x] 新建单独的 `codara/commands` 目录，承载手动 slash commands
- [x] 为 host surface 增加 `/help`、`/resume`、`/compact`、`/reload` 四个内建命令
- [x] 让 `/compact` 复用现有 conversation lifecycle，而不是重写一套压缩逻辑
- [x] 将命令层接入 CLI 输入路径，但不污染 `createAgent(...)` 内核
- [x] 更新命令层测试、文档，并重新验证全量基线

## Review

- 当前目标：把宿主级 slash commands 正式接进 Codara，对齐 `/help`、`/resume`、`/compact`、`/reload` 这类手动控制面，同时保持 `createAgent(...)` 继续只负责执行
- 当前结果：slash commands 已集中落在 `src/core/codara/commands/`；`createCodara()` 返回的 host surface 现在暴露 `listCommands()` / `executeCommand(...)`
- 本轮补充：`/compact` 通过 `Agent.compactConversation()` 强制复用已有 `beforeAgent + beforeModel + conversation-context` 路径；`/resume` 复用现有 HIL `resumePause(...)`，没有发明第二套恢复协议
