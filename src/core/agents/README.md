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
    guards.ts
    model.ts
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

`subagent` 的最小实现不是新 runtime，而是对 `createAgent(...)` 的一次受约束复用。

```ts
import {createAgent, createSubagentTool} from '@core/agents';

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

正式的委派入口是 `Task` 工具，它是 `subagent` 原语的高层包装，不是另一套执行系统。

```ts
import {createAgent, createTaskTool} from '@core/agents';

const taskTool = createTaskTool({
  model,
  tools: [readTool, grepTool],
});

const agent = createAgent({
  model,
  tools: [taskTool],
});
```

当前 `Task` tool 的 MVP 边界：
- 内部仍复用 `createAgent(...)`
- 子代理定义来自真实 agent files，而不是代码硬编码
- 默认会从 `.codara/skills/*/agents/*.md` 发现 agent definitions
- 也支持通过显式 `agents/` roots 提供定义，例如插件目录下的 `agents/*.md`
- 不负责共享 task 协调；共享协调由 `TaskCreate/TaskUpdate/TaskList` 负责

公开心智保持克制：
- `@core/agents` 只暴露主入口与常量，例如 `createAgent(...)`、`createSubagentTool(...)`、`createTaskTool(...)`
- `Task` 的高级 runtime 扩展钩子只服务内部装配；默认使用时不需要了解它们
