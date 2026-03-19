# Middleware 中间件系统

## 概述

`@engine/pipeline` 提供与 Agent loop 对齐的 6 个 hooks，用于注入日志、conversation context、工具拦截等横切逻辑。

生命周期顺序固定为：

`beforeAgent -> beforeModel -> wrapModelCall -> afterModel -> wrapToolCall -> afterAgent`

这里的 `beforeAgent / afterAgent` 是 agent loop 内每个 turn 的 hook，不是 `session` 级、也不是一次 `invoke()` 只触发一次的 runtime lifecycle hook。

## 快速开始

```typescript
import {createAgent} from '@engine/agent';
import {createLoggingMiddleware} from '@engine/pipeline';

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
import {createMiddleware} from '@engine/pipeline';
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
- `budget`：当前 turn 的输入预算快照（默认由 `BudgetMiddleware` 维护）

特有字段：

- `afterModel`：`response`
- `wrapToolCall`：`toolCall`、`toolIndex`、`tool`
- `afterAgent`：`result`

## 默认主链

Codara 默认 runtime 只把下面几类模块当成一等 middleware stage：

- `LoggingMiddleware`
- caller middlewares
- `BudgetMiddleware`
- `SummaryMiddleware`
- `HumanInTheLoopMiddleware`

补充说明：

- `PathInstructionsMiddleware`
  - hook scope: `wrapToolCall`
  - role: 按路径动态投影 `AGENTS.md` / `codara.md` 到当前 turn
  - owner: context bridge，不是 permission/security policy
- `SkillsMiddleware`
  - hook scope: `beforeModel`
  - role: 暴露 `Skill` 工具并读取已准备好的 skill snapshot
- `PermissionMiddleware`
  - hook scope: `wrapToolCall`
  - role: deny→ask→allow 权限策略
- `TodoListMiddleware`
  - hook scope: tool exposure / `wrapToolCall`
  - role: `write_todos` 工具支持
- `ToolHooksMiddleware`
  - hook scope: `wrapToolCall`
  - role: hook 生命周期桥接

### 默认主链职责矩阵

- `LoggingMiddleware`
  - hook scope: all 6 hooks
  - role: observer only
  - should not own source loading, context compaction, or tool policy
- caller middleware
  - hook scope: user-defined
  - role: custom runtime rewrites that should still participate in later conversation budgeting/compaction
- `BudgetMiddleware`
  - hook scope: `beforeModel`
  - role:
    - refresh budget snapshot for the current model request
    - optionally compact old conversation messages before the current model request
- `SummaryMiddleware`
  - hook scope: `beforeModel`
  - role: auto-compact when context exceeds budget
- `HumanInTheLoopMiddleware`
  - hook scope: `wrapToolCall`
  - role: pause/resume interception only

这条默认主链里，source stage、conversation stage、interaction stage、observer stage 各自只有一个默认 owner，不应重叠。

source-driven system layers 现在走另一条链：

- `Session`
  - preload / reload `instructions/*`
- `Agent prepareContext`
  - 应用当前 base instruction snapshot
  - 附加运行中新激活的 instruction messages
  - 预填 `runtime.shared` 中的 source-derived runtime data

因此：

- `PathInstructionsMiddleware` — `wrapToolCall` 阶段按需投影子目录指令文件
- `SkillsMiddleware` — `beforeModel` 阶段读取已准备好的技能快照并暴露 `Skill` 工具

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

`createHILMiddleware(options)` 提供通用"暂停-恢复"拦截能力（不内置审批决策语义）：

- `interruptOn[toolName] = true`：命中后进入 pause，返回结构化 `hil_pause` 消息
- `interruptOn[toolName] = false` 或未配置：自动放行
- `interruptOn[toolName] = {description, channel, ui, metadata, allowedDecisions}`：附加交互与 review 元信息
- `resolveDecision`：外部可返回 `allow | ask | deny`，将策略层与协议层彻底解耦
- `resolveResume` / `handleResume`：由外部实现审批、编辑、拒绝、多页/tab 流程

```typescript
import {createHILMiddleware} from '@engine/pipeline';
import {ToolMessage} from '@langchain/core/messages';

const hilMiddleware = createHILMiddleware({
  resolveDecision: async ({context}) => {
    if (context.toolCall.name === 'write_file') {
      return {
        decision: 'ask',
        config: {
          description: '写文件前需要人工介入',
        }
      };
    }
    return {decision: 'allow'};
  },
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
- 允许"顺序重试"式多次 `handler(request)` 调用。
- 禁止"并发重入"调用 `handler`，并发会抛错。

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
src/engine/pipeline/
├── index.ts
├── types.ts
├── pipeline.ts
├── path-instructions.ts
├── skills.ts
├── logging.ts
├── budget.ts
├── summary.ts
├── hil.ts
├── ask-user-question.ts
├── permission/
│   ├── evaluate.ts
│   └── ...
├── todo.ts
└── README.md
```
