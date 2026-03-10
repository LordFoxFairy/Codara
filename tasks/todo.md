# TODO

- [x] 将 `commands` 拆成“一命令一文件”，避免 `builtins.ts` 继续膨胀
- [x] 保持现有 host command API 和 CLI 行为不变
- [x] 重新验证 `typecheck`、`lint`、`test`
- [x] 压平 `commands/commands/*` 的重复目录层级

## Review

- 当前目标：把宿主级 slash commands 进一步收成“每个命令一个文件”的可维护结构，同时保持它们继续属于 host surface，而不是 agent 内核
- 当前结果：`src/core/codara/commands/` 现已压平成 `registry.ts + help.ts + resume.ts + compact.ts + reload.ts + parser.ts + runner.ts + types.ts`；`/help`、`/resume`、`/compact`、`/reload` 各自独立，runner 和 facade 对外 API 未变
