# TODO

- [x] 为 session metadata 补 usage/context window telemetry
- [x] 让 reopen session 保留既有 metadata，而不是重新丢失宿主态信息
- [x] 修正 telemetry 聚合为“本次新增 AI 响应总和”，而不是只吃最后一轮 model call
- [x] 更新文档并跑完 `typecheck`、`lint`、`test`

## Review

- session metadata 现在会累计 token usage，并记录最近一次 context window 占用百分比
- telemetry 归属在 `Session metadata`，不进 checkpoint，不污染 agent runtime state
- reopen session 现在会把持久化 session state 带回 host，保留既有 metadata
- multi-turn agent run 的 telemetry 已按本次新增 AI 响应聚合，避免只统计最后一轮模型调用
- 已验证：`bun run typecheck`、`bun run lint`、`bun test`
