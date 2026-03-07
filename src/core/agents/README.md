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
- `sessions/*`：实例宿主与代理层
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

- `index.ts`：唯一对外出口
- `contract/*`：公开合同，只定义 agent 类型与流式输出
- `engine/agent.ts`：`createAgent(...)` 的内部实现
- `engine/checkpoint.ts`：checkpoint 读写与快照映射
- `engine/guards.ts`：运行状态约束
- `engine/model.ts`：模型适配
- `engine/runtime.ts`：agent 运行时依赖装配
- `engine/state.ts`：状态归一化与恢复辅助
- `engine/stream-writer.ts`：流式输出写出器
- `engine/tools.ts`：工具执行
- `loop/*`：loop 主链与按步骤拆分的执行逻辑

## 用法

### 基础调用

```ts
import {createAgent} from '@core/agents';

const agent = createAgent({model, tools, middleware});
const result = await agent.invoke('hello');
```

### 流式调用

```ts
import {createAgent} from '@core/agents';

const agent = createAgent({model, tools, middleware});

for await (const chunk of agent.stream('hello', {streamMode: 'messages'})) {
  const [messageChunk] = chunk;
  process.stdout.write(String(messageChunk.content));
}
```

支持的 `streamMode`：
- `values`：完整消息快照
- `updates`：模型与工具步骤更新
- `messages`：`AIMessageChunk` 流
- `custom`：协议型自定义事件，例如 HIL pause

## Checkpoint

`createAgent(...)` 默认使用内存 checkpointer，因此单进程内开箱即用。

如果需要跨进程恢复，可以显式提供：

```ts
import {createAgent} from '@core/agents';
import {createAgentFileCheckpointer} from '@core/checkpoint';

const checkpointer = createAgentFileCheckpointer({
  rootDir: '.codara/state/threads',
});

const agent = createAgent({
  model,
  tools,
  threadId: 'terminal-thread',
  checkpointer,
});
```

恢复时不需要另一套 `create*Agent` 名字；仍然使用 `createAgent(...)`，只是在构造参数里提供 `threadId`、`checkpointer` 和已加载的 checkpoint。
