# Lessons

## 工作方式

- 非 trivial 任务先写 plan，再实现，再验证。
- 跨层重构前先把宿主动作、执行动作、持久化动作三条语义分开，再写代码。
- 讨论 Claude Code 对齐时，先拆清 `createAgent(执行)`、`session(会话宿主)`、`session store(会话目录/索引)`，不要把三层混成一个抽象。
- 用户一旦纠正方向，先收边界，再改代码；不要边修边猜。
- 用户要求“先 copy/照搬”时，先搬核心形状，再做本地适配。
- 进入明显重构前，先告诉用户要改什么、为什么改。
- PR review 通过且用户同意后，默认继续 merge，不停在中间状态。
- 新一轮重构分支命名要带日期或版本后缀，例如 `topic-20260310` 或 `topic-v2`，方便后续管理。
- 手动 commands 子系统要按“一命令一文件”组织，避免 registry/builtins 文件持续膨胀。
- 目录分层不能为了“看起来模块化”多套一层同名目录；像 `commands/commands/*` 这种重复层级要直接压平。

## 设计原则

- 一切优先围绕 `createAgent(...)` 主线，不发明平行 runtime 概念。
- `codara` 只是 facade，`session` 只是宿主，`agent` 才是执行内核。
- 能由已有组件组合得到的能力，不要重写第二套系统。
- 没有真实消费者时，不要预留未使用类型、API、兼容层。
- 命名必须贴具体语义，不用 `project*` 这类抽象空词。
- 不要把内部路由格式或底层实现细节直接抬成对外产品 API。

## 架构边界

- `checkpoint` 只负责恢复运行态，不负责 source。
- `guidelines` 是 `AGENTS.md` 投影，不是 checkpoint。
- `summary` 属于 `messages` 压缩，不得反向污染 `checkpoint/session`。
- `todo` 属于 agent 内部状态，放 `values`，不跨 agent 共享。
- `Task` 是委派入口；`TaskCreate/TaskUpdate/TaskList` 是共享协调层。
- `main agent` 和 `subagent` 是同一种 agent，只允许身份和 definition 差异。

## Skills / Task / Subagent

- agent definitions 属于 `skills` 域，不要在 `agents/*` 再开旁路 discovery。
- `Task` 必须消费 `SkillsMiddleware` 放进 runtime 的同一份数据，不直接读 store。
- 不要硬编码 subagent profiles；优先从 `.codara/skills/*/agents/*.md` 或显式 `agents/` roots 发现。
- 不要做 profile 驱动的 model/middleware 自动切换；child 默认继承 main 的装配。
- 约束若本质属于 agent 身份，优先用 `agentType` 表达，不靠技巧性标记。

## Middleware / Runtime

- 默认 source 注入顺序要清晰且稳定。
- `logging` 只做观测，不解析其他 middleware 私有协议。
- `hil` 只做 pause/resume，不承载权限业务策略。
- 派生 runtime 数据应放 runtime context，不要混进持久 `state.context`。
- context budget 应作为独立 runtime 关注点，不埋在 summary 私逻辑里。

## 测试规则

- 一个能力一个测试文件，不把多个主题堆进同一 `.test.ts`。
- 先测对外行为，再测内部辅助，不要过度绑定实现细节。
- 默认测试必须稳定、可重复、无外部网络依赖。
- 外部 provider 验证优先改成 deterministic integration，必要时用本地 mock server 覆盖真实 provider stack。
- 每轮结束前至少跑：`bun run typecheck`、`bun run lint`、相关 `bun test`。
- 重构时不要删语义再改测试；测试应优先守住既有正确能力，再跟随更优设计收敛。
