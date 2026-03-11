# Core

## 主链

```text
public API
  -> product/*
    -> sources/*
    -> sessions/*
      -> agents/*
        -> middleware/*
        -> tasking/*
        -> checkpoint/*
```

一句话：

`product 负责装配，sources 负责 source projection，session 负责 host lifecycle，agent 负责执行，middleware 负责运行时拦截，tasking 负责委派。`

## 关键边界

- `product/*`
  - 只装配默认模型、工具、middleware、commands
  - 不负责 host lifecycle，不负责 loop
- `sources/*`
  - 单独负责 `AGENTS.md` 与 skills runtime 的发现、加载、inspect、ensure、cache
  - session 只 preload/reload 它们，agent turn preparation 只消费 snapshot
- `sessions/*`
  - 只负责 lazy bootstrap、restore、reloadSources、metadata、fork、dispose
  - 不拥有 middleware 语义，也不负责每次 model call 的 prompt 拼装
- `agents/*`
  - 只负责 invoke/stream/resume、turn loop、tool loop、checkpoint projection、turn-level prompt assembly
- `middleware/*`
  - 只负责 runtime interception
  - 默认栈不再承载 source preload 或默认 source prompt 注入
- `tasking/*`
  - `Task` 是唯一公开委派入口
  - subagent 是它背后的执行机制

## 初始化路径

```text
createCodara(...)
  -> createCodaraSessionAssembly(...)
    -> createCodaraGuidelinesSource(...)
    -> createCodaraSkillsSource(...)
    -> createCodaraTools(...)
    -> createCodaraMiddlewares(...)
    -> createSourceTurnContextPreparer(...)
  -> createSession(...)
    -> first hydrate/invoke/stream/resume
      -> preload guidelines + skills
      -> resolve model
      -> restore checkpoint
      -> createAgent(...)
  -> each model turn
    -> prepareTurnContext(...)
      -> read cached source snapshots
      -> assemble system layers
    -> runtime middleware stages
```

这里的重点是：

- `init` 在 session host 完成
- middleware 不做 source discovery
- tools 不做 session bootstrap
- `guidelines` 和 `skills` 先形成 projection，再由 agent turn preparation 注入给 loop

## 维护原则

- 不让 `middleware` 反向依赖 `sessions/*` 的 owner 语义
- 不让 `agents/*` 吸收 product/source/host 职责
- 不为了减少文件数把不同 owner 再揉成一个大文件
- 只有“没有独立 owner 价值”的小文件才继续合并


## Summary 中间件

- `middleware/conversation/summary.ts` 提供可选的上下文压缩算法
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

- Codara 默认装配使用 `middleware/conversation/context.ts` 统一处理：
  - 完整输入预算估算
  - 可选的 summary compact
- 这样默认 runtime 的公开心智只保留一个 conversation middleware，不再把 `context-budget` 与 `summary` 视为两个并列 middleware。
- `middleware/conversation/budget.ts` 与 `middleware/conversation/summary.ts` 属于 conversation internals；model input assembly 直接留在 `agents/loop/model-step.ts`，不再单独保留 `conversation-input.ts` 这种薄 helper 文件。
- `middleware/conversation/budget.ts` 只保留预算快照/估算工具；`middleware/conversation/summary.ts` 只保留摘要压缩算法与记录解析工具。
- 这个 slice 属于 pre-model request preparation，不拥有 `session` lifecycle，也不拥有 checkpoint ownership。

## Todo / Subagent / Task

- `todo`
  - agent 内部轻量执行状态
  - 当前存放在 `state.values`
  - 随 checkpoint 恢复
- `subagent`
  - 对 `createAgent(...)` 的受约束复用
  - 子代理独立上下文、独立 checkpoint 边界
  - 当前以正式的 `TaskMiddleware` 委派为主
  - owner 心智对齐 DeepAgents：由 tasking/middleware 域维护，不是 core loop 的特权路径
- `task`
  - 共享协调层，不属于单个 agent 的内部状态
  - 通过 `tasking/*` 域中的 `TaskStore` 与 `SharedTaskMiddleware` 暴露
  - 可被主代理与子代理共同访问

三者分工不同，不应混用：
- `todo` 负责单 agent 内部进度
- `subagent` 负责委派执行
- `task` 负责跨 agent 协调

正式命名上：
- `TaskMiddleware` = 注册正式 `Task` 委派工具，是产品主入口
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

- slash commands 归属 `src/core/product/commands/`
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
