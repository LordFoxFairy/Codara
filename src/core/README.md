# Core 对外入口

## 分层

```text
createCodara(...)
  -> createSession(...)
    -> createAgent(...)
      -> middleware/guidelines.ts
      -> middleware/memory.ts
      -> checkpoint/*
      -> middleware/*
```

- 依赖方向固定为：`codara -> sessions -> agents -> checkpoint`
- `createAgent(...)` 是唯一通用 agent 入口
- `createSession(...)` 是实例宿主，只暴露 session 状态与 `agent()` 入口
- `createCodara(...)` 是产品级 facade，负责默认模型、工具和 middleware 装配

## AGENTS.md 规范

- `AGENTS.md` 通过 `middleware/guidelines.ts` 接入
- 当前只支持两层：
  - `~/.codara/AGENTS.md`
  - `<workspaceRoot>/AGENTS.md`
- 工作区根优先从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 在 session 创建阶段生成内容投影
- 后续模型调用复用同一份内容
- 默认注入顺序早于 `SkillsMiddleware`

`AGENTS.md` 在当前架构中属于项目规范源，不属于：
- `skills`
- `memory`
- `checkpoint`

## MEMORY.md 记忆

- `MEMORY.md` 通过 `middleware/memory.ts` 接入
- 当前只支持两层：
  - `~/.codara/MEMORY.md`
  - `<workspaceRoot>/.codara/MEMORY.md`
- 工作区根优先从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 在 session 创建阶段生成内容投影
- `middleware/memory.ts` 只负责 `MEMORY.md` 的加载与截断，用于投影长期稳定记忆
- 默认注入顺序位于 `AGENTS.md` 之后、`SkillsMiddleware` 之前

`MEMORY.md` 在当前架构中属于长期记忆源，不属于：
- `guidelines`
- `checkpoint`
- `session`


## Summary 中间件

- `middleware/summary.ts` 提供可选的上下文压缩 middleware
- 它会在消息历史过长时：
  - 压缩较早消息
  - 将较早消息替换为持久化的 summary message
  - 保留最近消息继续参与后续模型调用
- 默认关闭，只有显式传入 `summary` 配置时才启用
- `summary` 不写入 `MEMORY.md`，仍只通过 checkpoint 持久化 agent 运行态

`summary` 在当前架构中属于上下文压缩能力，不属于：
- `memory`
- `guidelines`
- `session`
- `checkpoint`

## Todo / Subagent / Task

- `todo`
  - agent 内部轻量执行状态
  - 当前存放在 `state.values`
  - 随 checkpoint 恢复
- `subagent`
  - 对 `createAgent(...)` 的受约束复用
  - 子代理独立上下文、独立 checkpoint 边界
  - 当前通过 `createSubagentTool(...)` 或正式的 `Task` tool 委派
- `task`
  - 共享协调层，不属于单个 agent 的内部状态
  - 通过独立 `TaskStore` 与 `TaskCreate/TaskUpdate/TaskList` tools 暴露
  - 可被主代理与子代理共同访问

三者分工不同，不应混用：
- `todo` 负责单 agent 内部进度
- `subagent` 负责委派执行
- `task` 负责跨 agent 协调

正式命名上：
- `Task` = 委派型工具，生成/运行子代理
- `TaskCreate/TaskUpdate/TaskList` = 共享协调工具

更完整的 `subagent/task` 结构、流程图、测试地图与当前不足，见 `docs/subagent-task-architecture.md`。

子代理类型本身不在 core 里硬编码。
它们应来自真实 agent definition 文件，例如：
- `.codara/skills/*/agents/*.md`
- 显式传入的 `agents/` roots（例如插件目录）

## 入口

- `createCodara(...)`
  - 产品级入口
  - 持有默认 session，并暴露 `session(...)`、`invoke(...)`、`stream(...)`、`resume(...)`
- `createCodaraModelCatalog(...)`
  - 基于 provider 配置、registry 和 factory 的模型目录
- `createCodaraChatModel(...)`
  - 按 alias 直接创建聊天模型
- `createAgent(...)`
  - 通用 agent，负责 `invoke/stream/resume` 与 checkpoint 边界
- `createCodaraAgent(...)`
  - Codara 默认装配后的高级 agent 入口

## CLI 用法

```ts
import {createCodara} from '@core';

const codara = createCodara({
  tools,
  threadId: 'terminal-thread',
});

const result = await codara.invoke('hello');
```

如果需要流式输出：

```ts
for await (const chunk of codara.stream('hello', {streamMode: 'messages'})) {
  const [messageChunk] = chunk;
  process.stdout.write(String(messageChunk.content));
}
```

如果需要显式拿到一个 session：

```ts
const session = await codara.session({
  threadId: 'terminal-thread',
});

const agent = session.agent();
```

`SessionState` 只表达宿主信息；执行态仍通过 `agent.getState()` 读取。

更完整的 CLI 用法见 `docs/codara-cli-runtime.md`。

`memory` 当前只通过 `middleware/memory.ts` 将初始化阶段生成的 `MEMORY.md` 摘要注入模型上下文。
如需查看更多细节，agent 应通过现有文件工具按路径读取真实文件。

传入固定 `threadId` 后，`session(...)` / `invoke(...)` / `stream(...)` 会优先恢复该 thread 的最新 checkpoint；不存在时再创建新实例。
