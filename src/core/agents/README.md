# Agents

## 分层

- `AgentRunner`
  - 低层执行内核。
  - 调用方每次显式传入 `state.messages`。
  - 负责 loop、middleware 分发、tools 与 HIL 协议处理。

- `createAgent(...)`
  - 围绕 `AgentRunner` 的状态化宿主。
  - 负责：
    - 对话消息
    - runtime context
    - pending HIL pause
    - checkpoint 边界
    - `invoke/stream/resume`
  - 默认使用 memory checkpointer。
  - 对外心智尽量贴近 LangChain：`createAgent({ model, tools, middleware })`。

## 用法

### 默认 memory-backed agent

```ts
import {createAgent} from '@core/agents';

const agent = createAgent({model, tools, middleware});

await agent.invoke('hello');
await agent.resume({action: 'allow'});

const checkpoint = await agent.saveCheckpoint();
```

### 流式执行

```ts
import {createAgent} from '@core/agents';

const agent = createAgent({model, tools, middleware});

for await (const chunk of agent.stream('hello', {streamMode: 'messages'})) {
  const [messageChunk] = chunk;
  process.stdout.write(String(messageChunk.content));
}
```

支持的 `streamMode`：

- `values`
  - 输出当前完整消息快照
- `updates`
  - 输出步骤更新：
    - `{model: {messages: [AIMessage]}}`
    - `{tools: {messages: [ToolMessage]}}`
- `messages`
  - 输出 `[AIMessageChunk, {runId, turn}]`
- `custom`
  - 输出协议型自定义事件，例如 HIL pause payload

### 文件持久化恢复

```ts
import {createAgent, loadAgent} from '@core/agents';
import {createAgentFileCheckpointer} from '@core/checkpoint';

const checkpointer = createAgentFileCheckpointer({
  rootDir: '.codara/state/threads',
});

const agent = createAgent({
  model,
  tools,
  middleware,
  threadId: 'terminal-thread',
  checkpointer,
});

await agent.invoke('hello');

const restored = await loadAgent({
  model,
  tools,
  middleware,
  threadId: 'terminal-thread',
  checkpointer,
});
```

## Checkpoint 与 Memory

- Checkpoint
  - 用 `threadId/checkpointId/state/info` 描述稳定边界
  - 默认是 memory 模式，可切文件模式
  - agent 专属持久化模型位于 `src/core/checkpoint/state.ts`
  - 文件模式落盘为 `latest.json + checkpoints/*.json`
  - 用于恢复/回放，不等于长期语义 memory
  - `stream(...)` 与 `resumeStream(...)` 使用同一套 checkpoint 边界

- Memory
  - 不在这一层实现
  - 短期上下文已由 `messages + runtime context` 覆盖
  - 长期/project memory 应保持为独立关注点
