# Core 对外入口

## 分层

```text
createCodara(...)
  -> createSession(...)
    -> createAgent(...)
      -> middleware/guidelines.ts
      -> checkpoint/*
      -> middleware/*
```

- 依赖方向固定为：`codara -> sessions -> agents -> checkpoint`
- `createAgent(...)` 是唯一通用 agent 入口
- `createSession(...)` 是实例宿主，负责 source reload、checkpoint compact 和 HIL pause 恢复
- `createCodara(...)` 是产品级 facade，负责默认模型、工具和 middleware 装配

## 当前审计

本轮按入口自上而下审计后，当前主线可以收敛成：

```text
src/index.ts
  -> core/index.ts
    -> codara/*
      -> sessions/*
        -> agents/*
          -> middleware/* / skills/* / tools/* / tasking/*
```

运行主链是：

```text
createCodara(...)
  -> createSession(...)
    -> createAgent(...)
      -> createCodaraTools(...)
      -> createCodaraMiddlewares(...)
        -> SkillsMiddleware
          -> runtime.shared.skills
      -> runtime / loop / checkpoint
      -> Task
        -> resolve definition from runtime.shared.skills
        -> spawn child agent with the same Codara assembly path
```

当前合理性：

- `codara` 负责产品 facade 与默认装配，没有侵入执行内核。
- `session` 负责实例宿主与 AGENTS source 生命周期持有，没有承接 agent 工作流状态。
- `sessions/agent-host.ts` 只承接 session 内部对 `createAgent(...)` 的执行桥接，不反向泄漏为独立公共层。
- `agentsSource` 负责 AGENTS projection 缓存与失效，避免把 `AGENTS.md` 加载逻辑揉进 agent 内核。
- `skillsSource` 负责 session-scoped skills runtime projection，避免把 skills discovery 放进每次 model call 的 middleware 初始化职责。
- `agent` 仍然是唯一执行原语，`subagent`/`Task` 是组合，不是第二套 runtime。
- `SkillsMiddleware -> runtime.shared.skills -> Task` 已经形成单一数据流，没有再开旁路 discovery。
- `skills -> command metadata -> codara/commands` 现在也是单向链路，skills 只声明，commands 只绑定宿主执行。

当前仍应持续打磨的点：

- 低层 barrel 导出仍偏宽，后续应逐步收紧公开 API 面。
- `engine/state.ts` 职责偏密，下一轮真实 feature 进入时要警惕继续膨胀。
- subagent definition 已区分“当前真的生效”的字段与 `hints` 元数据；后续仍应继续克制，不把 hints 重新做成自动 runtime 覆盖。
- shared task tools 当前返回文本结果，后续只有在出现真实消费者时再升级成结构化 payload。

## Runtime 结构

入口链继续收敛后，当前可以稳定理解成：

```text
src/index.ts
  -> @core facade exports
    -> createCodara(...)
      -> createSession(...)
        -> restore latest checkpoint when threadId is reused
        -> createAgent(...)
          -> runtime loop / checkpoint / Task / subagent
```

默认 middleware 顺序：

1. `logging`
2. `guidelines`
3. `skills`
4. caller middleware
5. `conversation-context`
6. `hil`

这里要刻意区分两层心智：

- 一等 runtime stage:
  - `logging`
  - `guidelines`
  - `skills`
  - `conversation-context`
  - `hil`
- conversation internals:
  - `conversation-input`
  - `context-budget`
  - `summary`

后者仍然存在，但它们只是 `conversation-context` 复用的子能力，不应再被看作默认主链里的并列 middleware。

状态边界：

- `messages`
  - 对话历史
  - `summary` 在这一层做压缩并通过 checkpoint 持久化
- `state.context`
  - 持久 agent context
  - 随 checkpoint 保存与恢复
  - 不承载 `todo` 这类 agent-owned 状态
- `runtime.runtimeContext`
  - 本轮 invoke/resume 的临时上下文
  - 不进入 checkpoint
- `runtime.context`
  - 当前 hook 可见的有效上下文视图
  - 由 `state.context + runtime.runtimeContext` 合成
  - `skills` 这类可重建派生数据不应写回这一层做持久化
- `runtime.shared`
  - middleware 生成、同一次运行内共享的派生数据
  - `skills` runtime 现在在这一层
  - 不进入 checkpoint，也不属于用户 invoke context
- `values`
  - agent 内部轻量状态
  - `todo` 在这里并随 checkpoint 恢复

checkpoint 边界：

- `agents/engine/state.ts`
  - runtime-facing projection
  - `runtime -> public AgentState`
  - `runtime -> checkpoint state/info`
  - `checkpoint record -> runtime metadata restore`
- `checkpoint/state.ts`
  - 存储层序列化 / 反序列化

能力地图：

- `guidelines`
  - source: `AGENTS.md`
  - scope: 项目规范
- `memory` command
  - product meaning: AGENTS source inspection / edit target selection
  - not a view of checkpoint history, session metadata, or durable context
- `summary`
  - scope: 对话压缩
  - layer: conversation context stage + `messages`
  - trigger: 统一输入预算或消息数量阈值
- `context-budget`
  - scope: 输入预算估算与超限判定
  - layer: conversation context stage runtime snapshot
  - output: 当前 turn 的 budget snapshot
- `session`
  - scope: 宿主生命周期
  - layer: source reload / checkpoint compact / HIL pause 恢复 / usage telemetry 聚合
- `todo`
  - scope: 单 agent 内部进度
  - layer: `values`
- `tasking`
  - scope: 委派执行与共享任务协调的统一能力域
  - includes: `subagent` primitive、`Task`、`TaskStore`、tasking middleware facades
- `subagent`
  - scope: 委派执行
  - layer: 同一 agent runtime，`agentType = subagent`
- `Task`
  - scope: 正式委派能力
  - layer: `TaskMiddleware`
  - data source: `runtime.shared.skills`
- `TaskCreate/TaskUpdate/TaskList`
  - scope: 共享协调层
  - layer: `SharedTaskMiddleware` + `tasking/store.ts`

已经确认的边界修正：

- `guards.ts` 这类生命周期前置检查更适合放在 `engine/lifecycle.ts`，因为它们表达的是 agent 生命周期约束，不是泛化的 guards。
- skills 能力属于 `skills/*` 域；如果 `@core/middleware` 需要便捷导出，应直接在 barrel 转发，而不是创建 `middleware/skills.ts` 这种错层 shim。

## AGENTS.md 规范

- `AGENTS.md` 通过 `middleware/guidelines.ts` 接入
- 当前 source stack 包含：
  - `~/.codara/AGENTS.md`
  - 从 `projectRoot` 到 `cwd` 的层级 `AGENTS.md`
- 工作区根优先从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 在 session 创建阶段生成内容投影
- 后续模型调用复用同一份内容
- 同一个 `Codara` host 可通过 `reloadSources()` 显式刷新 `AGENTS.md` source 与 skills discovery cache
- 默认注入顺序早于 `SkillsMiddleware`

`AGENTS.md` 在当前架构中属于项目规范源，不属于：
- `skills`
- `checkpoint`
- `session metadata`
- `state.context`

四个容易混淆的概念，当前应固定这样理解：

- `AGENTS.md`
  - source input
  - 通过 `/memory` 和 `/reload` 管理
- `state.context`
  - durable agent context
  - 随 checkpoint 保存与恢复
- `checkpoint`
  - conversation branch 的 runtime snapshot history
  - 保存 `messages/context/values/pendingPause`
- `session metadata`
  - host catalog summary
  - 保存 `sessionId/threadId/lastActivity/messageCount/lastMessage/usage/contextWindow`

它们是四条不同边界，不应再混叫成 “memory”。


## Summary 中间件

- `middleware/summary.ts` 提供可选的上下文压缩 middleware
- 它会在消息历史过长时：
  - 压缩较早消息
  - 将较早消息替换为持久化的 summary message
  - 保留最近消息继续参与后续模型调用
- 它现在会优先基于完整模型输入预算判断是否压缩，预算包含已注入的 `guidelines` / `skills` system sections
- 默认关闭，只有显式传入 `summary` 配置时才启用

`summary` 在当前架构中属于上下文压缩能力，不属于：
- `guidelines`
- `session`
- `checkpoint`

## Future Memory Non-Goals

如果后面再设计真正的产品级 memory，当前先明确这些非目标：

- 不是 `checkpoint` 的别名
- 不是 `state.context` 的别名
- 不是 `session metadata` 的别名
- 不是 `/memory` 命令当前展示的 `AGENTS.md` source stack

也就是说，未来若引入 memory：
- 必须有自己独立的产品语义
- 必须有独立的数据边界
- 不能再复用现有名词把 checkpoint/context/session metadata 混成一个概念

## Conversation Context

- Codara 默认装配使用 `middleware/conversation-context.ts` 统一处理：
  - 完整输入预算估算
  - 可选的 summary compact
- 这样默认 runtime 不再依赖 `context-budget` 与 `summary` 两个独立 middleware 的隐式排序。
- `conversation-input.ts`、`context-budget.ts`、`summary.ts` 都属于 conversation internals。
- `createContextBudgetMiddleware(...)` 与 `createSummaryMiddleware(...)` 仍保留在各自子路径下，主要用于底层测试和兼容场景；默认主路径不再把它们当成对等 middleware 心智公开。

## Todo / Subagent / Task

- `todo`
  - agent 内部轻量执行状态
  - 当前存放在 `state.values`
  - 随 checkpoint 恢复
- `subagent`
  - 对 `createAgent(...)` 的受约束复用
  - 子代理独立上下文、独立 checkpoint 边界
  - 当前优先通过 `SubagentMiddleware` 或正式的 `TaskMiddleware` 委派
- `task`
  - 共享协调层，不属于单个 agent 的内部状态
  - 通过 `tasking/*` 域中的 `TaskStore` 与 `SharedTaskMiddleware` 暴露
  - 可被主代理与子代理共同访问

三者分工不同，不应混用：
- `todo` 负责单 agent 内部进度
- `subagent` 负责委派执行
- `task` 负责跨 agent 协调

正式命名上：
- `TaskMiddleware` = 注册正式 `Task` 委派工具
- `SubagentMiddleware` = 注册原始 `delegate_to_subagent` 工具
- `SharedTaskMiddleware` = 注册 `TaskCreate/TaskUpdate/TaskList`

更完整的 `subagent/task` 结构、流程图、测试地图与当前不足，见 `docs/subagent-task-architecture.md`。

子代理类型本身不在 core 里硬编码。
它们应来自真实 agent definition 文件，例如：
- `.codara/skills/*/agents/*.md`
- 显式传入的 `agents/` roots（例如插件目录）

## 入口

- `createCodara(...)`
  - 产品级入口
  - 持有默认 session，并暴露 `invoke(...)`、`stream(...)`、`resumePause(...)`、`compactCheckpoints(...)`
  - 同时暴露宿主级命令面：`await listCommands()`、`executeCommand(...)`
- `openCodaraSession(...)` / `openLatestCodaraSession(...)`
  - 显式打开历史 session
  - 返回前会 hydrate 已恢复的 runtime state
  - `openLatestCodaraSession(...)` 默认优先选择最新的非 `closed` stored session；若都已关闭，才回退到最新存档
  - 不与 HIL pause 恢复混用
- `createCodaraModelCatalog(...)`
  - 基于 provider 配置、registry 和 factory 的模型目录
- `createCodaraChatModel(...)`
  - 按 alias 直接创建聊天模型
- `createAgent(...)`
  - 通用 agent，负责 `invoke/stream/resume` 与 checkpoint 边界

## Slash Commands

- slash commands 归属 `src/core/codara/commands/`
- 当前内建命令：
  - `/help`
  - `/memory`
  - `/resume`
  - `/compact`
- `/reload`
  - 刷新 `AGENTS.md` source 与 skills discovery cache
- skills 还可以通过 `command-name` 显式声明动态 slash commands
- 命令来源会被正式区分为：
  - `builtin`：宿主内建命令
  - `skill`：由 skills discovery 暴露的命令入口
- 这些命令属于 host surface，不属于 `createAgent(...)` 内核
- `/memory` 直接围绕 `AGENTS.md` 工作，不恢复旧 `MEMORY.md` 机制
- `/memory` 默认展示当前 AGENTS source stack 与可编辑 target，显式使用 `show / project / global`
- `/memory project|global` 返回宿主 `open_file` 动作，供 UI/CLI 打开目标 `AGENTS.md`
- `/compact` 通过 `Agent.compactConversation()` 复用现有 `beforeAgent + beforeModel + conversation-context` 路径
- `/compact checkpoints [keepLast]` 只整理 checkpoint store，不混入 conversation summary 语义

## Conversation Compact

- `summary` 负责 conversation context compact
- `checkpoint compact` 负责历史存储裁剪
- 两者是不同层次，不能混用
- 默认 compact 触发：
  - 默认 alias 为 `sonnet`
  - 优先使用 model metadata 的 `contextWindow`
  - 默认阈值为可用输入预算的 95%
  - 手动 `/compact` 可强制触发
  - 多窗口若要分支，优先调用 `fork()`，不要共享同一条 `threadId`

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

传入固定 `threadId` 后，`invoke(...)` / `stream(...)` 会优先恢复该 thread 的最新 checkpoint；不存在时再创建新实例。
