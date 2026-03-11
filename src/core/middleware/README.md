# Middleware 中间件系统

## 概述

`@core/middleware` 提供与 Agent loop 对齐的 6 个 hooks，用于注入日志、conversation context、工具拦截等横切逻辑。

生命周期顺序固定为：

`beforeAgent -> beforeModel -> wrapModelCall -> afterModel -> wrapToolCall -> afterAgent`

这里的 `beforeAgent / afterAgent` 是 agent loop 内每个 turn 的 hook，不是 `session` 级、也不是一次 `invoke()` 只触发一次的 host lifecycle hook。

## 快速开始

```typescript
import {createAgent} from '@core/agents';
import {createLoggingMiddleware} from '@core/middleware';

const loggingMiddleware = createLoggingMiddleware({
  level: 'info',
  logger: (record) => {
    // structured JSON log
    console.log(JSON.stringify(record));
  },
});

const agent = createAgent({
  model,
  tools: [],
  middleware: [loggingMiddleware]
});
```

说明：

- 推荐通过 `createMiddleware(...)` 声明中间件常量。
- 推荐通过 `middleware: [middleware1, middleware2]` 注入到 runner。

## 中间件能力

当前实现支持接近 LangChain 示例的写法：

- `wrapModelCall(request, handler)`
- `handler(request)` 传递改写后的请求
- `request.runtime.context` 读取当前 hook 可见的有效上下文视图
- `request.systemMessage` 注入系统消息
- `contextSchema` 做上下文校验

### 示例：User Context Middleware

```typescript
import {createMiddleware} from '@core/middleware';
import {z} from 'zod';

const contextSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  apiKey: z.string().optional()
});

const userContextMiddleware = createMiddleware({
  name: 'UserContextMiddleware',
  contextSchema,
  wrapModelCall: (request, handler) => {
    const {userId, tenantId} = request.runtime.context as {userId: string; tenantId: string};
    const contextText = `User ID: ${userId}, Tenant: ${tenantId}`;

    return handler({
      ...request,
      systemMessage: request.systemMessage.concat(contextText)
    });
  }
});

const result = await agent.invoke(
  {messages: [new HumanMessage('Hello')]},
  {
    context: {
      userId: 'user-123',
      tenantId: 'acme-corp'
    }
  }
);
```

## Hook 上下文字段

公共字段（多数 hooks 都可用）：

- `state.messages` / `messages`：当前消息列表
- `state.context`：持久化 agent context（随 checkpoint 保存，跨 invoke 保留）
- `runtime.context`：当前 hook 可见的有效上下文视图（`state.context + runtime.runtimeContext` 的合成结果，不直接持久化）
- `runtime.runtimeContext`：临时运行时上下文（仅本次 invoke 有效，不持久化）
- `runtime.shared`：同一次运行内由 middleware 生成并共享的派生数据，不进入 checkpoint
- `systemMessage`：可在 `beforeModel` 或 `wrapModelCall` 中追加系统消息
- `execution.runId`、`execution.turn`、`execution.maxTurns`、`execution.requestId`
- `inputBudget`：本轮调用的输入预算配置
- `budget`：当前 turn 的输入预算快照（默认由 `ConversationContextMiddleware` 维护）

特有字段：

- `afterModel`：`response`
- `wrapToolCall`：`toolCall`、`toolIndex`、`tool`
- `afterAgent`：`result`

## 默认主链

Codara 默认 runtime 只把下面几类模块当成一等 middleware stage：

- `LoggingMiddleware`
- caller middlewares
- `ConversationContextMiddleware`
- `HumanInTheLoopMiddleware`

其中：

- `conversation/*`

不再属于 middleware 子目录。它们已经提升为平级 conversation 小域；`middleware/conversation.ts` 只保留 `ConversationContextMiddleware` 这个公开 builder。

### 默认主链职责矩阵

- `LoggingMiddleware`
  - hook scope: all 6 hooks
  - role: observer only
  - should not own source loading, context compaction, or tool policy
- caller middleware
  - hook scope: user-defined
  - role: custom runtime rewrites that should still participate in later conversation budgeting/compaction
- `ConversationContextMiddleware`
  - hook scope: `beforeModel`
  - role:
    - refresh budget snapshot for the current model request
    - optionally compact old conversation messages before the current model request
- `HumanInTheLoopMiddleware`
  - hook scope: `wrapToolCall`
  - role: pause/resume interception only

这条默认主链里，source stage、conversation stage、interaction stage、observer stage 各自只有一个默认 owner，不应重叠。

source-driven system layers 现在走另一条链：

- `Session`
  - preload / reload `knowledge/*`
- `Agent prepareTurnContext`
  - 读取 source snapshot
  - 组装 `systemMessage`
  - 预填 `runtime.shared` 中的 source-derived runtime data

因此：

- `GuidelinesMiddleware`
- `SkillsMiddleware`

保留为高级手动扩展，不再属于 Codara 默认产品路径。

request-preparation slice 的职责应固定理解为：

- model input assembly
  - directly owned by `agents/loop/model-step.ts`
- `middleware/conversation`
  - transient budget snapshot / heuristic
  - summary compaction helper over `messages`
  - default pre-model middleware stage

目录上现在固定分为：
- `middleware/conversation.ts`
  - 单文件 owner，包含 builder、预算和摘要逻辑

## 典型模式

### 内置 LoggingMiddleware

`createLoggingMiddleware(options)` 提供结构化日志能力：

- 覆盖 6 个 hooks
- `wrapModelCall` / `wrapToolCall` 输出 start/end/error 与耗时
- 统一字段：`runId`、`turn`、`requestId`、`stage`、`event`
- `wrapToolCall` 可额外记录协议型 middleware 提供的 `toolMetadata`
- 支持开关与级别过滤：`enabled`、`level`
- 若要记录下游中间件返回的结构化 `ToolMessage`（例如 `hil_pause`），请将 logging 放在对应中间件之前。

```typescript
const loggingMiddleware = createLoggingMiddleware({
  enabled: true,
  level: 'debug',
  logger: (record) => console.log(JSON.stringify(record))
});
```

### 内置 HIL Middleware（Human-in-the-Loop）

`createHILMiddleware(options)` 提供通用“暂停-恢复”拦截能力（不内置审批决策语义）：

- `interruptOn[toolName] = true`：命中后进入 pause，返回结构化 `hil_pause` 消息
- `interruptOn[toolName] = false` 或未配置：自动放行
- `interruptOn[toolName] = {description, channel, ui, metadata, allowedDecisions}`：附加交互与 review 元信息
- `resolveDecision`：外部可返回 `allow | ask | deny`，将策略层与协议层彻底解耦
- `resolveResume` / `handleResume`：由外部实现审批、编辑、拒绝、多页/tab 流程

LangChain/LangGraph 对齐点：
- pause request 内置 `review.actionName` 与 `review.allowedDecisions`
- `allowedDecisions` 默认是 `approve | edit | reject`
- `ui.actions` 仍是可选的展示层，不替代 review contract

推荐的 `ui.actions` 结构：
- `id`：动作标识，由上层交互模板定义
- `label`：前端显示文案
- `kind`：`primary | secondary | danger`
- `requiresConfirmation` / `requiresToolEdit`：声明交互要求

推荐的 review contract：
- `review.actionName`：当前待审核工具名
- `review.allowedDecisions`：允许的标准决策集合，推荐使用 `approve | edit | reject`

默认 `hil_pause` / `hil_deny` 消息是结构化 JSON；终端或宿主层可复用
- `parseHILToolMessagePayload(...)`
来解析默认协议，而不是各处手写 `JSON.parse`

默认 tool payload contract：

```typescript
type HILToolMessagePayload =
  | {type: 'hil_pause'; request: HILPauseRequest}
  | {
      type: 'hil_deny';
      reason: string;
      metadata: Record<string, unknown>;
      action: {toolCallId: string; toolName: string};
    };
```

推荐的 resume payload 协议：
- `decision`：可选标准 review 决策，推荐使用 `approve | edit | reject`
- `action`：选中的动作 id
- `scope`：可选范围信息，由 skills / policy 层解释
- `comment`：审批备注
- `editedToolName` / `editedToolArgs`：编辑后继续执行

默认恢复行为：
- `decision = reject`：返回结构化 `hil_deny`
- `editedToolName` / `editedToolArgs`：自动按通用 edit 语义继续执行
- 若只提供自定义 `action`，则由上层 `handleResume` 解释
- `resumes` 只解析显式自有键；不会读取原型链上的 payload

边界建议：
- 权限模板、按钮文案、持久化范围等业务语义优先放在 skills 或外部审批服务中维护。
- HIL middleware 只负责 pause/resume 协议，不内置权限动作集合或 scope 语义。

```typescript
import {createHILMiddleware} from '@core/middleware';
import {ToolMessage} from '@langchain/core/messages';

const approvalUiTemplate = {
  tab: 'security',
  actions: [
    {id: 'primary', label: 'Primary action', kind: 'primary'},
    {id: 'edit', label: 'Edit and continue', requiresToolEdit: true},
    {id: 'reject', label: 'Reject', kind: 'danger', requiresConfirmation: true}
  ]
};

const hilMiddleware = createHILMiddleware({
  // 也可只配置 interruptOn；这里演示外部决策模式
  resolveDecision: async ({context}) => {
    if (context.toolCall.name === 'write_file') {
      return {
        decision: 'ask',
        config: {
          description: '写文件前需要人工介入',
          channel: 'ops-review',
          ui: approvalUiTemplate
        }
      };
    }
    return {decision: 'allow'};
  },
  // 由外部注入恢复数据（可来自 skills、审批服务、UI 状态机）
  resolveResume: (pauseRequest, ctx) => {
    return (ctx.runtime.context as any).hil?.resumes?.[pauseRequest.id];
  },
  // 外部可覆盖默认恢复行为；默认实现已支持 reject 和通用 edit 语义
  handleResume: async (pauseRequest, resumePayload, ctx, next) => {
    const payload = parseHILResumeActionPayload(resumePayload);
    if (payload.decision === 'reject') {
      return new ToolMessage({
        content: 'Denied by external policy',
        tool_call_id: pauseRequest.action.toolCallId
      });
    }
    return next(applyHILResumeToolEdits(ctx, payload));
  }
});
```

### 重试（Retry）

```typescript
const retryMiddleware = createMiddleware({
  name: 'RetryMiddleware',
  wrapModelCall: async (request, handler) => {
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        return await handler(request);
      } catch (error) {
        if (attempt === maxRetries - 1) {
          throw error;
        }
        console.log(`Retry ${attempt + 1}/${maxRetries} after error: ${String(error)}`);
      }
    }

    throw new Error('Unreachable');
  }
});
```

### 工具拦截（Tool Interceptor）

```typescript
const toolInterceptor = createMiddleware({
  name: 'ToolInterceptor',
  wrapToolCall: async (request, handler) => {
    if (request.toolCall.name === 'dangerous_tool') {
      return new ToolMessage({
        content: 'Tool blocked by policy',
        tool_call_id: request.toolCall.id ?? 'blocked'
      });
    }

    return handler(request);
  }
});
```

## 执行语义（重要）

- `before* / after*`：按注册顺序执行。
- `wrap*`：洋葱模型，外层包裹内层。
- 允许“顺序重试”式多次 `handler(request)` 调用。
- 禁止“并发重入”调用 `handler`，并发会抛错。

## Context 校验

如果 middleware 配置了 `contextSchema`，runner 会在 invoke 开始前统一校验。

- 校验通过：进入正常执行链路
- 校验失败：返回 `reason = error`

## Pipeline 执行器

```typescript
pipeline.has('LoggingMiddleware');
pipeline.get('LoggingMiddleware');
pipeline.list(); // 只读副本
pipeline.validateContext(context); // 可选手动校验
```

说明：

- `MiddlewarePipeline` 现在是内部执行器，不再从主 middleware barrel 暴露。
- 运行时只在 agent 构造时注入 middleware 数组，不支持对已创建 runtime 做可变注册/删除。

## 错误处理

中间件错误会自动包装为阶段错误，包含 middleware 名称和阶段信息，便于定位。

例如：

`Middleware "RetryMiddleware" failed in wrapModelCall: ...`

## 文件结构

```
src/core/middleware/
├── index.ts
├── types.ts
├── pipeline.ts
├── execution.ts
├── skills.ts
├── logging.ts
├── hil.ts
└── README.md
```

## 相关文档

- [hooks 规范](../../../docs/04-hooks.md)
