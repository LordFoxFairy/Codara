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
    lifecycle.ts
    model.ts
    runtime-input.ts
    runtime.ts
    state.ts
    stream-writer.ts
    tools.ts
  loop/
    model-step.ts
    run.ts
    tool-step.ts
    turn.ts
```

- `contract/*`：公开合同
- `engine/*`：agent 内部实现
- `loop/*`：loop 主链与步骤执行

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

## Subagent MVP

`subagent` 的最小实现不是新 runtime，而是对 `createAgent(...)` 的一次受约束复用；实现现在归属 `tasking/*` 域，而不是 agent 内核本身。

```ts
import {createAgent} from '@core/agents';
import {createSubagentTool} from '@core/tasking';

const delegateToSubagent = createSubagentTool({
  model,
  tools: [readTool, grepTool],
  systemPrompt: 'You are a focused research subagent.',
});

const agent = createAgent({
  model,
  tools: [delegateToSubagent],
});
```

当前 MVP 约束：
- 子代理独立上下文，不继承父代理历史消息
- 默认排除同名 subagent tool，禁止嵌套委派
- 只把执行摘要回传给父代理，不回传完整子代理历史

## Task Delegation Tool

正式的委派入口现在优先以 `TaskMiddleware` 暴露，它在内部注册 `Task` 工具；底层仍复用 `subagent` 原语，不是另一套执行系统。

```ts
import {createAgent} from '@core/agents';
import {createTaskMiddleware} from '@core/middleware';

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
- 子代理定义来自真实 agent files，而不是代码硬编码
- 默认会从 `.codara/skills/*/agents/*.md` 发现 agent definitions
- 也支持通过显式 `agents/` roots 提供定义，例如插件目录下的 `agents/*.md`
- 不负责共享 task 协调；共享协调由 `TaskCreate/TaskUpdate/TaskList` 负责

公开心智保持克制：
- `@core/middleware` 暴露 `createTaskMiddleware(...)`、`createSubagentMiddleware(...)`、`createSharedTaskMiddleware(...)`
- `@core/tasking` 暴露低层 `createSubagentTool(...)`、`createTaskTool(...)`，作为 runtime primitive
- `agents/*` 回到纯执行内核，不再承载 task/subagent 领域文件
- `Task` 的公共选项保持中性；宿主侧的 child-agent/runtime 绑定通过 tasking host adapter 接入，不继续暴露在主 API 选项里
