# TODO

- [x] 将 provider 白名单配置收成纯模型 ID 列表
- [x] 将 `contextWindow/maxOutputTokens` 拆到独立 `model-metadata.json`
- [x] 更新 loader / registry / 默认仓库配置 / 文档 / 测试
- [x] 跑完 `typecheck`、`lint`、`test` 并确认新配置合同稳定

## Review

- provider `models` 现在只保留模型 ID，仓库默认配置更轻、更接近产品心智
- 模型窗口与输出 token 元数据独立到 `.codara/model-metadata.json`
- runtime registry 现在通过统一 model metadata 构建 budget/窗口信息，不再把元数据绑在 provider 白名单里
- 已验证：`bun run typecheck`、`bun run lint`、`bun test`
