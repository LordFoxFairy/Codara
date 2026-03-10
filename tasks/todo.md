# TODO

- [x] 审计 `memory` 在 runtime/codara/source-provider/tests/docs 的所有引用
- [x] 从内部运行主线中彻底移除 `memory`
- [x] 清理相关测试、导出面和文档
- [x] 跑通 `bun run typecheck`、`bun run lint`、`bun test`
- [x] 把 `guidelines + skills + caller prompts + budget + summary` 收成更明确的 conversation lifecycle
- [x] 降低 `ContextBudgetMiddleware` / `SummaryMiddleware` 在 Codara 默认装配里的隐式顺序依赖
- [x] 更新文档与测试，重新验证全量基线
- [x] 让 reopened session 在无新 invoke 前也能显式 hydrate 已恢复的 runtime state
- [x] 验证 `Session / SessionStore / checkpoint` 的 host 语义更接近 first-class conversation

## Review

- 当前目标：去掉内部 runtime 里的 `memory`，只保留 `guidelines / summary / checkpoint / todo / task / subagent` 这些真实需要的层
- 当前结果：`memory` 已从 runtime/codara/source-provider/middleware/export/tests/docs 主链移除；`source stack` 只保留 `AGENTS.md`；默认内部语义继续收敛为 `guidelines + skills + budget + summary + checkpoint`
- 本轮补充：Codara 默认装配中的 `context-budget + summary` 已收成单一 `conversation-context` stage，默认 runtime 不再依赖两个独立 middleware 的隐式排序
- 本轮补充：`openCodaraSession(...)` / `openLatestCodaraSession(...)` 现在会在返回前 hydrate 已恢复的 runtime state，reopened conversation 无需先发新消息就能读取恢复结果；`Session` 也会在 hydrate 时同步 metadata/store
