# Core 对外入口

## 分层

- `createCodara(...)`
  - 完整的 Codara 对外入口。
  - 持有默认 session，并暴露 `query(...)`、`stream(...)`、`openSession(...)`、`createSession(...)`、`loadSession(...)`。
  - 默认装配模型 alias、内置工具和 middleware 栈，调用方只在需要时覆盖。
  - 如果只是做 provider smoke 或最小宿主接入，可以显式关闭 `builtinTools`、`skills`、`hil`，把入口收成纯模型 facade。

- `createCodaraModelRuntime(...)`
  - 基于 provider 配置、registry 和 factory 的模型运行时。
  - 支持按 `default`、`sonnet`、`deepseek` 这类别名取模型。

- `createCodaraChatModel(...)`
  - 直接按路由别名创建聊天模型。
  - 默认使用 `default`。

- `createAgentRunner(...)`
  - 低层 agent 执行内核。
  - 最接近 LangChain `createAgent` 的内部执行形态。

- `createAgent(...)`
  - 带状态的 agent 宿主。
  - 负责 messages、runtime context、HIL pause 状态、checkpoint 边界与 stream 输出。

- `createCodaraAgent(...)`
  - 面向 CLI / code terminal 的高级 agent 入口。
  - 支持直接传 `model`，也支持只传 `alias` / runtime 配置。
  - 默认集成：
    - 默认启用 `SkillsMiddleware`
    - 默认启用 `HumanInTheLoopMiddleware`
    - `LoggingMiddleware` 按需开启
    - 调用方 middleware 插在 HIL 之前

## CLI 用法

```ts
import {createCodara} from '@core';

const codara = createCodara({
  tools,
  threadId: 'terminal-thread',
});

const result = await codara.query('hello');
```

如果传了固定 `threadId`，`codara.query(...)` / `codara.stream(...)` 默认会优先恢复已有 checkpoint，
不存在时再创建新 session。

如果 CLI 需要流式输出：

```ts
import {createCodara} from '@core';

const codara = createCodara({
  tools,
  threadId: 'terminal-thread',
});

for await (const chunk of codara.stream('hello', {streamMode: 'messages'})) {
  const [messageChunk] = chunk;
  process.stdout.write(String(messageChunk.content));
}
```

Codara 默认 middleware 顺序：

1. 开启时的 `LoggingMiddleware`
2. `SkillsMiddleware`
3. 调用方自定义 middlewares
4. `HumanInTheLoopMiddleware`

这样可以保证：
- logging 在最外层观测下游结果
- 调用方工具 middleware 能先于 HIL 短路
- HIL 仍然是最终交互闸门

如果 CLI 需要持久化：

```ts
import {createAgentFileCheckpointer, createCodara} from '@core';

const checkpointer = createAgentFileCheckpointer({
  rootDir: '.codara/state/threads',
});

const codara = createCodara({
  tools,
  checkpointer,
});

const session = await codara.createSession({
  threadId: 'terminal-thread',
});
```

如果宿主希望按 thread 语义“有则恢复、无则创建”，应使用：

```ts
const session = await codara.openSession({
  threadId: 'terminal-thread',
});
```

当宿主需要直接拿到底层 checkpoint-backed `Agent` 时，
仍然可以使用 `createCodaraAgent(...)`。
