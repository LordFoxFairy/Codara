# Core 对外入口

## 分层

```text
createCodara(...)
  -> createSession(...)
    -> createAgent(...)
      -> guidelines/*
      -> memory/*
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
  - `<workspaceRoot>/AGENTS.md`
- 工作区根优先从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 每次模型调用都会重新读取，不做缓存
- 默认注入顺序早于 `SkillsMiddleware`

`AGENTS.md` 在当前架构中属于项目规范源，不属于：
- `skills`
- `memory`
- `checkpoint`

## MEMORY.md 记忆

- `MEMORY.md` 通过 `memory/*` 模块接入
- 当前只支持两层：
  - `~/.codara/MEMORY.md`
  - `<workspaceRoot>/MEMORY.md`
- 工作区根优先从 `cwd` 向上查找 `.codara`、`.git`、`package.json`
- 每次模型调用都会重新读取，不做缓存
- `memory/*` 同时提供 `MEMORY.md` 的正式编辑接口，用于沉淀长期稳定记忆
- 默认注入顺序位于 `AGENTS.md` 之后、`SkillsMiddleware` 之前

`MEMORY.md` 在当前架构中属于长期记忆源，不属于：
- `guidelines`
- `checkpoint`
- `session`


## Summary 中间件

- `summary/*` 提供可选的上下文压缩 middleware
- 它会在消息历史过长时：
  - 压缩较早消息
  - 将摘要写回 agent 持久上下文
  - 在后续模型调用前注入摘要系统消息
- 默认关闭，只有显式传入 `summary` 配置时才启用
- `summary` 不写入 `MEMORY.md`，也不改变 checkpoint 结构

`summary` 在当前架构中属于上下文压缩能力，不属于：
- `memory`
- `guidelines`
- `session`
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
