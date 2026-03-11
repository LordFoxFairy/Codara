# Agents

## 定位

`createAgent(...)` 是通用 agent 入口。

它负责：
- `invoke(...)`
- `stream(...)`
- `resume(...)`
- `resumeStream(...)`
- 运行态消息、上下文与 HIL 暂停态
- checkpoint 持久化与恢复

它不负责：
- 产品默认装配
- terminal 实例宿主
- 业务级 facade

## 分层

```text
createCodara(...)
  -> createSession(...)
    -> guidelines / skills preload
    -> createAgent(...)
      -> checkpoint/*
      -> middleware/*
```

- `createAgent(...)`：通用执行体
- `sessions/*`：实例宿主
- `codara/*`：产品入口与默认装配

## 目录

```text
agents/
  index.ts
  contract/
    agent.ts
    stream.ts
  engine/
    agent.ts
    checkpoint.ts
    runtime-input.ts
    runtime.ts
    state.ts
    stream-writer.ts
    tools.ts
  loop/
    run.ts
    model-step.ts
    tool-step.ts
```

- `contract/*`：公开合同
- `engine/*`：agent 内部实现
- `loop/*`：loop 主链与 model/tool 步骤执行

## 用法

```ts
import {createAgent} from '@core/agents';

const agent = createAgent({model, tools, middleware});
const result = await agent.invoke('hello');
```

```ts
for await (const chunk of agent.stream('hello', {streamMode: 'messages'})) {
  const [messageChunk] = chunk;
  process.stdout.write(String(messageChunk.content));
}
```

支持的 `streamMode`：
- `values`
- `updates`
- `messages`
- `custom`

## Delegation Internals

delegated child run 不是新 runtime，而是对 `createAgent(...)` 的一次受约束复用；实现现在归属 `tasking/*` 域，而不是 agent 内核本身。
它不再属于公开主入口，当前只应被视为 `Task` 背后的内部 delegation mechanism。

## Task Delegation Tool

正式的委派入口应以 `TaskMiddleware` 暴露，它在内部注册 `Task` 工具；底层复用 delegated child run 作为执行机制。owner 心智对齐 DeepAgents: 这条能力属于 tasking/middleware 域，不是 agent 内核自己维护的另一套执行系统。

```ts
import {createAgent} from '@core/agents';
import {createTaskMiddleware} from '@core/tasking';

const taskMiddleware = createTaskMiddleware({
  model,
  tools: [readTool, grepTool],
});

const agent = createAgent({
  model,
  middleware: [taskMiddleware],
});
```

当前 `Task` tool 的 MVP 边界：
- 内部仍复用 `createAgent(...)`
- 子代理定义来自真实 markdown files，而不是代码硬编码
- 默认会从 `.codara/skills/*/agents/*.md` 发现 subagent definitions
- 也支持通过显式 `subagentRoots` 提供定义，例如插件目录下的 `agents/*.md`
- 不负责共享 task 协调；共享协调由 `TaskCreate/TaskUpdate/TaskList` 负责

公开心智保持克制：
- 根入口 / `@core` 只应把 `createTaskMiddleware(...)` 讲成委派主入口
- `@core/tasking` 只保留 tasking 域公开能力；低层 delegation helper 退回 `@core/tasking/delegation`，`createTaskTool(...)` 退回 `@core/tasking/task`
- `agents/*` 回到纯执行内核，不再承载 task/subagent 领域文件
- `Task` 的公共选项保持中性；宿主侧的 child-agent/runtime 绑定通过 tasking host adapter 接入，不继续暴露在主 API 选项里

## 文件数量

`agents/*` 现在文件数看起来不少，但主因是它按三层拆开了：
- `contract/*`：公开合同
- `engine/*`：状态、runtime 装配、checkpoint 边界
- `loop/*`：run / model / tool 主链

这里的目标不是“多文件”，而是避免把执行内核重新揉回一个 800 行 owner。当前保留下来的文件需要能直接回答“它保护的是哪一段边界”。已经确认没有 owner 价值的薄文件，例如 `engine/lifecycle.ts`、`engine/model.ts`，已经并回主 owner 文件，避免继续增加跳转成本。
