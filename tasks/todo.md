# TODO

- [x] 将 `/memory` 收成正式宿主动作结果，不再只返回裸路径
- [x] 把默认 model alias / input budget 收成更接近 Claude Code 的产品默认
- [x] 为多窗口/分支增加显式 `fork` 语义，避免同一 session 隐式共享 latest
- [x] 更新 conversation lifecycle 文档与测试，并重新验证 `typecheck`、`lint`、`test`

## Review

- `/memory` 现在默认只展示 scope，`project/global` 返回正式 `open_file` 宿主动作
- 默认 alias 已切到 `sonnet`，并通过模型元数据推导 conversation input budget
- `fork()` 已进入 `Session/Codara` 宿主层，用新 `sessionId + threadId` 显式分支当前会话
- 已补 conversation lifecycle 文档，并新增默认配置与 fork 相关测试
- 已验证：`bun run typecheck`、`bun run lint`、`bun test`
