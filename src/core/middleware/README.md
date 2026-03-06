# Middleware 中间件系统

## 概述

`@core/middleware` 提供与 Agent loop 对齐的 6 个 hooks，用于注入日志、重试、上下文注入、工具拦截等横切逻辑。

生命周期顺序固定为：

`beforeAgent -> beforeModel -> wrapModelCall -> afterModel -> wrapToolCall -> afterAgent`

## 快速开始

```typescript
import {createAgentRunner} from '@core/agents';
import {createLoggingMiddleware} from '@core/middleware';

const loggingMiddleware = createLoggingMiddleware({
  level: 'info',
  logger: (record) => {
    // structured JSON log
    console.log(JSON.stringify(record));
  },
});

const runner = createAgentRunner({
  model,
  tools: [],
  middlewares: [loggingMiddleware]
});
```

说明：

- 推荐通过 `createMiddleware(...)` 声明中间件常量。
- 推荐通过 `middlewares: [middleware1, middleware2]` 注入到 runner。

## LangChain 风格能力

当前实现支持接近 LangChain 示例的写法：

- `wrapModelCall(request, handler)`
- `handler(request)` 传递改写后的请求
- `request.runtime.context` 读取 invoke 上下文
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

const result = await runner.invoke(
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
- `runtime.context`：invoke 传入的业务上下文
- `systemMessage`：可在 `wrapModelCall` 中追加系统消息
- `runId`、`turn`、`maxTurns`、`requestId`

特有字段：

- `afterModel`：`response`
- `wrapToolCall`：`toolCall`、`toolIndex`、`tool`
- `afterAgent`：`result`

## 典型模式

### 内置 LoggingMiddleware

`createLoggingMiddleware(options)` 提供结构化日志能力：

- 覆盖 6 个 hooks
- `wrapModelCall` / `wrapToolCall` 输出 start/end/error 与耗时
- 统一字段：`runId`、`turn`、`requestId`、`stage`、`event`
- 支持开关与级别过滤：`enabled`、`level`

```typescript
const loggingMiddleware = createLoggingMiddleware({
  enabled: true,
  level: 'debug',
  logger: (record) => console.log(JSON.stringify(record))
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

## Pipeline 管理 API

```typescript
pipeline.use(middleware);
pipeline.has('LoggingMiddleware');
pipeline.get('LoggingMiddleware');
pipeline.list(); // 只读副本
pipeline.remove('LoggingMiddleware');
pipeline.validateContext(context); // 可选手动校验
```

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
├── logging.ts
└── README.md
```

## 相关文档

- [hooks 规范](../../../docs/04-hooks.md)
