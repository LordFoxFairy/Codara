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
