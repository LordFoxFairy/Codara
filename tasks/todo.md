# TODO

- [ ] 从 `createAgent` 开始，逐域审计 `src/core` 下所有 TS 文件的存在理由与归属
- [ ] 给出 `agents / middleware / sessions / checkpoint / skills / tasking / codara / provider / tools` 的完整链路与职责图
- [ ] 标出多余、过宽、错位、重复的文件与抽象，并判断保留/合并/删除/重写策略
- [ ] 优先修正全局最别扭的结构问题，而不是局部修词
- [ ] 完成重构后做 self-review，再跑全量验证
- [ ] 每轮开始前先重新确认 `src/core` 顶层目录基线，防止只盯单点文件

- [x] 从入口开始做完整架构审计：`createCodara -> sessions -> agents -> middleware -> checkpoint -> skills -> tasking -> commands`
- [x] 找出重复装配、错位抽象、过宽接口、跨目录心智拼接
- [x] 给出新的全局目标结构图与保留/删除/合并策略
- [x] 完成当前这一轮结构重构，不再按局部症状修补
- [x] 审计当前工具执行路径，确认并行能力的正确归属与约束
- [x] 设计并实现显式 tool execution policy，只对纯读取工具开放安全并行
- [x] 验证并行执行不会破坏 `Task/todo/bash/edit/write` 等状态型工具语义
- [x] 继续做一轮后端全局审计：重新检查 `agents / sessions / checkpoint / middleware / skills / tasking / codara / commands / provider`
- [x] 找出一个仍然会拖累长期维护的高价值结构问题，并给出更自然的收口方案
- [x] 完成本轮重构、全量验证和自我 review，再决定是否进入下一轮
- [x] 将 `skills` 与 `commands` 收成同一条链，避免 `command-name` 变成平行触发系统
- [x] 继续自审 `session / commands / skills` 交界，确认没有引入新的 host-level 泄漏
- [x] 继续收紧 `tasking` 域目录，移除只承载薄 facade 的 `tasking/middleware/*`

## Review

- 当前轮目标不是继续局部打磨，而是做完整 file-by-file 审计，确认每个 TS 是否真的有存在理由。
- 用户明确指出不能再“为了当前任务拆小文件/加抽象”，因此本轮必须先给出整条架构链，再决定删除、合并或重写。
- 已完成一轮自上而下的 runtime 审计，并落了两处关键重构：
  - `task/subagent/shared tasks` 收成独立 `tasking/*` 顶层域
  - `AGENTS` source lifecycle 从过宽的泛化 provider 收窄成单一 `sessions/agents.ts` 模块
- `Session` 宿主层已按职责拆薄：保留会话生命周期，抽离 metadata、model selection、AGENTS 文件动作等纯辅助逻辑。
- `conversation-context`、`summary`、`context-budget` 这条主线确认是正确的，没有再被误拆。
- 顶层与域级 barrel 已从 `export *` 收成显式导出，减少内部实现持续泄漏到上层 API。
- 当前最主要的风险已从 runtime 主线转移为“历史文档残留旧设计”，已对关键旧文档补充历史说明，避免继续误导后续协作。
- 这轮新增了显式 `ToolExecutionPolicy`，并把并行调度收在 `agents/loop/tool-step.ts`，没有把并行语义散到 middleware、session 或单个 tool 实现中。
- 只读 builtin tools（`read/glob/grep/fetch/search`）现在允许安全并行；`Task/todo/bash/edit/write` 等状态型工具仍保持串行屏障。
- self-review 结论：当前工具并行策略的归属是对的，属于 agent loop 调度层，而不是 host surface 或 middleware 生命周期层。
- 继续全局审计后，发现 `sessions` 仍然反向依赖了 `codara` 的 alias/model catalog 词汇；已收正为通用 `SessionModelCatalog + modelRef`，保持 `codara` 只在产品层讲 alias。
- 继续审计发现 `AGENTS` source lifecycle 之前仍在借 `middleware/guidelines` 的加载实现；现已收回到 `sessions/agents.ts`，source 生命周期和 middleware 注入生命周期真正解耦。
- 继续审计发现 `sessions/telemetry` 不该依赖 `middleware/context-budget` 的实现类型；已收成仅依赖宿主可见的预算快照形状，进一步减少 sessions 对 middleware 内部实现的耦合。
- 继续全局审计后，确认 `skills` 和 `commands` 之前还是两条平行线；本轮已把 skills frontmatter 里的 `command-name` 收成正式命令声明，由 Codara commands registry 动态暴露，而不是再造一条旁路触发系统。
- `listCommands()` 已调整为异步，允许 command registry 正式复用技能发现结果；这是为动态 skill commands 让路，不是表面 API 变化。
- self-review 继续发现 `/reload` 之前只刷新 `AGENTS.md`，不会让 skills prompt、tasking definitions、dynamic commands 立刻同步；现已让 Codara host 在 `reloadSources()` 时同时刷新 skills discovery cache。
- 本轮继续做 file-by-file 审计后，确认 `sessions/agents-content.ts + agents-files.ts + agents-source.ts` 是一个概念被拆成三层薄文件；已合并为单一 `sessions/agents.ts` 模块。
- 本轮继续收正了 `codara/tasking.ts` 的装配路径：不再通过“先创建 middleware 再取 tool”这种拐弯方式暴露 task/subagent tool。
- 已新增 `docs/core-file-audit.md`，按 `src/core` 域给出每个 TS 文件的存在理由和当前 verdict，避免后续继续凭感觉判断目录是否混乱。
- 本轮继续收紧了顶层与域级导出面：不再从 `@core`/`@core/middleware` 顺手暴露命令内部件、AGENTS 文件动作或 skills store 这类跨层对象，避免产品便利导出反向污染目录语义。
- 本轮继续收正了 `Session` / `facade` 的宿主边界：AGENTS 文件动作（inspect/ensure）已经回收到 `Session`，`facade` 不再自行重建 source 文件逻辑。
- 本轮继续收掉了两层噪音抽象：
  - `ManagedAgentsSource + isManagedAgentsSource` 被压回可选能力接口
  - `commands/registry.ts` 并回 `commands/runner.ts`
- 本轮继续把 `reloadSources()` 的完整语义收回 `Session`：现在 AGENTS source 和 skills discovery cache 同时由 conversation host 刷新，不再由 facade 额外拼一层 reload。
- 本轮继续把 `tasking/middleware/*` 这层薄 wrapper 目录并回 `subagent.ts / task-tool.ts / shared-tools.ts`，让 tasking 域按真正概念组织，而不是靠嵌套目录凑层次。
- 本轮继续把 runtime 对外 contract 从 `middleware/middlewares` 双字段收成单一 `middleware`，避免 agent/codara/tasking/tests 再围绕同一概念保留两套入口。
