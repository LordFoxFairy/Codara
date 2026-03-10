# TODO

- [x] 基于 `AGENTS.md` 增加 `/memory` 宿主命令，不恢复旧 `MEMORY.md`
- [x] 让 `/memory` 能展示当前 memory stack，并定位/创建可编辑的 `AGENTS.md`
- [x] 保持 `createAgent(...)`、`Session`、`SourceProvider` 主线不变
- [x] 更新测试和文档，并重新验证 `typecheck`、`lint`、`test`

## Review

- 当前目标：把 `AGENTS.md` 作为唯一长期 memory source，并通过 `/memory` 命令形成 host-level 手动编辑闭环
- 当前结果：`/memory` 已接进 `codara/commands/`，默认 `show` 当前 AGENTS stack，支持 `project/global` 两个目标文件准备；命令复用现有 `guidelines/sourceProvider/reloadSources()` 链，没有复活旧 `MEMORY.md`
