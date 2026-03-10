# TODO

- [x] 审计 Claude Code 的 `memory / compact / resume` 内部语义，并与当前 Codara 对比
- [x] 统一 `AGENTS.md + context budget + summary + checkpoint + session reopen` 的 conversation lifecycle
- [x] 为自动 compact 增加明确阈值策略，并保留手动 `/compact`
- [x] 让 `/memory` 围绕全局/项目 `AGENTS.md` 形成更完整闭环
- [x] 明确 checkpoint compact 与 conversation compact 的边界，不混语义
- [x] 更新测试与文档，并重新验证 `typecheck`、`lint`、`test`

## Review

- `AGENTS.md` 现在是唯一长期 source，`/memory` 默认展示 scope 并要求显式选择 `project/global`
- `ConversationContextMiddleware` 负责默认 budget + summary compact 生命周期，自动 compact 阈值为可用输入预算的 80%
- `/compact` 只处理 conversation context，`/compact checkpoints [keepLast]` 只处理 checkpoint 存储历史
- `SessionStore` 保持会话目录索引，`checkpoint` 保持运行态历史，二者边界没有再混
- 已验证：`bun run typecheck`、`bun run lint`、`bun test`
