# TODO

- [x] 将 `/compact [instructions]` 收成正式 runtime contract
- [x] 将默认自动 compact 阈值收正到更接近 Claude Code 的 95%
- [x] 更新 summary / session / command / 文档 / 测试
- [x] 跑完 `typecheck`、`lint`、`test` 并确认 compact lifecycle 稳定

## Review

- `/compact [instructions]` 现在会把手动 compact 指令带进 summary generator，而不是停在命令层
- 默认自动 compact 阈值从 80% 收到了 95%，更接近 Claude Code 的默认心智
- session / agent / command 三层对 compact 的职责已经打通：host 触发，runtime 执行，summary 生成结果
- 已验证：`bun run typecheck`、`bun run lint`、`bun test`
