# Core 对外入口

## 分层

```text
createCodara(...)
  -> createSession(...)
    -> createAgent(...)
      -> guidelines/*
      -> checkpoint/*
      -> middleware/*
```

- 依赖方向固定为：`codara -> sessions -> agents -> checkpoint`
- `createAgent(...)` 是唯一通用 agent 入口
- `createSession(...)` 是实例宿主，只暴露 session 状态与 `agent()` 入口
- `createCodara(...)` 是产品级 facade，负责默认模型、工具和 middleware 装配

## AGENTS.md 规范

- `AGENTS.md` 通过 `guidelines/*` 模块接入
- 当前只支持两层：
  - `~/.codara/AGENTS.md`
  - `<projectRoot>/AGENTS.md`
- 每次模型调用都会重新读取，不做缓存
- 默认注入顺序早于 `SkillsMiddleware`

`AGENTS.md` 在当前架构中属于项目规范源，不属于：
- `skills`
- `memory`
- `checkpoint`

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

传入固定 `threadId` 后，`session(...)` / `invoke(...)` / `stream(...)` 会优先恢复该 thread 的最新 checkpoint；不存在时再创建新实例。
