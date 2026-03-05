# Middleware 中间件系统

## 概述

Middleware 模块提供了一个灵活的中间件管道系统，用于在 Agent 执行过程中注入横切关注点（如日志、监控、权限检查等）。

## 设计模式

### 1. 责任链模式（Chain of Responsibility）

`before*` 和 `after*` hooks 按注册顺序依次执行，每个中间件处理请求的一部分：

```typescript
// 执行顺序：middleware1 -> middleware2 -> middleware3
pipeline.use(middleware1);
pipeline.use(middleware2);
pipeline.use(middleware3);
```

### 2. 洋葱模型（Onion Model）

`wrap*` hooks 采用嵌套调用模式，外层中间件包裹内层：

```
outer:start -> inner:start -> handler -> inner:end -> outer:end
```

支持短路：中间件可以不调用 `next()` 直接返回结果。

### 3. 工厂模式（Factory Pattern）

`createMiddleware` 工厂函数统一验证和规范化中间件定义。

## 生命周期

中间件提供 6 个生命周期 hooks（与 LangChain 对齐）：

```
beforeAgent → beforeModel → wrapModelCall → afterModel → wrapToolCall → afterAgent
```

### Hook 说明

| Hook | 类型 | 执行时机 | 用途示例 |
|------|------|----------|----------|
| `beforeAgent` | 简单 | 每轮开始前 | 初始化、权限检查 |
| `beforeModel` | 简单 | 模型调用前 | 请求预处理、日志 |
| `wrapModelCall` | 包裹 | 包裹模型调用 | 重试、缓存、监控 |
| `afterModel` | 简单 | 模型调用后 | 响应后处理、审计 |
| `wrapToolCall` | 包裹 | 包裹工具调用 | 工具拦截、模拟 |
| `afterAgent` | 简单 | 每轮结束后 | 清理、统计（总是执行） |

## 使用示例

### 基础用法

```typescript
import {MiddlewarePipeline, createMiddleware} from '@core/middleware';

// 创建管道
const pipeline = new MiddlewarePipeline();

// 注册中间件
pipeline.use({
  name: 'logger',
  beforeAgent: (context) => {
    console.log(`Turn ${context.turn} started`);
  },
  afterAgent: (context) => {
    console.log(`Turn ${context.turn} ended: ${context.result.reason}`);
  }
});
```

### 日志中间件

```typescript
const loggingMiddleware = createMiddleware({
  name: 'logging',

  beforeModel: (context) => {
    console.log('[Model] Calling with messages:', context.state.messages.length);
  },

  afterModel: (context) => {
    console.log('[Model] Response:', context.response.content);
  }
});

pipeline.use(loggingMiddleware);
```

### 重试中间件（洋葱模型）

```typescript
const retryMiddleware = createMiddleware({
  name: 'retry',

  wrapModelCall: async (context, next) => {
    const maxRetries = 3;
    let lastError: Error | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        return await next();
      } catch (error) {
        lastError = error as Error;
        console.log(`Retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }

    throw lastError;
  }
});

pipeline.use(retryMiddleware);
```

### 缓存中间件（短路）

```typescript
const cacheMiddleware = createMiddleware({
  name: 'cache',

  wrapModelCall: async (context, next) => {
    const cacheKey = JSON.stringify(context.state.messages);
    const cached = cache.get(cacheKey);

    if (cached) {
      console.log('Cache hit');
      return cached; // 短路，不调用 next()
    }

    const result = await next();
    cache.set(cacheKey, result);
    return result;
  }
});

pipeline.use(cacheMiddleware);
```

### 工具拦截中间件

```typescript
const toolInterceptor = createMiddleware({
  name: 'tool-interceptor',

  wrapToolCall: async (context, next) => {
    console.log(`[Tool] Calling ${context.toolCall.name}`);

    // 可以修改参数
    if (context.toolCall.name === 'dangerous_tool') {
      return new ToolMessage({
        content: 'Tool blocked by policy',
        tool_call_id: context.toolCall.id
      });
    }

    const result = await next();
    console.log(`[Tool] Result:`, result.content);
    return result;
  }
});

pipeline.use(toolInterceptor);
```

### 监控中间件

```typescript
const monitoringMiddleware = createMiddleware({
  name: 'monitoring',

  beforeAgent: (context) => {
    context.state.startTime = Date.now();
  },

  afterAgent: (context) => {
    const duration = Date.now() - context.state.startTime;
    metrics.record('agent.turn.duration', duration, {
      turn: context.turn,
      reason: context.result.reason
    });
  }
});

pipeline.use(monitoringMiddleware);
```

### 必需中间件

```typescript
const securityMiddleware = createMiddleware({
  name: 'security',
  required: true, // 防止被移除

  beforeAgent: (context) => {
    if (!hasPermission(context)) {
      throw new Error('Permission denied');
    }
  }
});

pipeline.use(securityMiddleware);

// 尝试移除会抛出错误
pipeline.remove('security'); // Error: Cannot remove required middleware
```

## 管道管理

### 注册中间件

```typescript
pipeline.use(middleware);
```

### 移除中间件

```typescript
pipeline.remove('middleware-name');
```

### 列出中间件

```typescript
const middlewares = pipeline.list();
console.log(middlewares.map(m => m.name));
```

## 错误处理

### 错误包装

中间件抛出的错误会被自动包装，包含中间件名称和阶段信息：

```typescript
// 原始错误：Error: Database connection failed
// 包装后：Error: Middleware "logger" failed in beforeAgent: Database connection failed
```

错误对象包含 `cause` 属性，保留原始错误链：

```typescript
try {
  await pipeline.beforeAgent(context);
} catch (error) {
  console.log(error.message); // Middleware "logger" failed in beforeAgent: ...
  console.log(error.cause);   // 原始错误对象
}
```

### 防止重入

洋葱模型中，`next()` 只能调用一次：

```typescript
const invalidMiddleware = createMiddleware({
  name: 'invalid',
  wrapModelCall: async (context, next) => {
    await next();
    await next(); // Error: next() called multiple times
  }
});
```

## 最佳实践

### 1. 命名规范

使用清晰的中间件名称，避免重复：

```typescript
// 好
{ name: 'logging' }
{ name: 'retry-with-backoff' }
{ name: 'cache-redis' }

// 不好
{ name: 'mw1' }
{ name: 'middleware' }
```

### 2. 单一职责

每个中间件只做一件事：

```typescript
// 好：分离关注点
const loggingMiddleware = { name: 'logging', ... };
const retryMiddleware = { name: 'retry', ... };

// 不好：混合职责
const everythingMiddleware = {
  name: 'everything',
  beforeAgent: () => { /* logging + retry + cache */ }
};
```

### 3. 注册顺序

考虑中间件的执行顺序：

```typescript
// 日志应该在最外层，捕获所有操作
pipeline.use(loggingMiddleware);

// 重试在缓存之前，避免缓存失败的结果
pipeline.use(retryMiddleware);
pipeline.use(cacheMiddleware);
```

### 4. 错误处理

在中间件中妥善处理错误：

```typescript
const safeMiddleware = createMiddleware({
  name: 'safe',

  afterAgent: (context) => {
    try {
      // 可能失败的操作
      sendMetrics(context);
    } catch (error) {
      // 记录但不抛出，避免影响主流程
      console.error('Failed to send metrics:', error);
    }
  }
});
```

### 5. 性能考虑

避免在 hooks 中执行耗时操作：

```typescript
// 好：异步但不阻塞
const asyncMiddleware = createMiddleware({
  name: 'async',

  afterAgent: (context) => {
    // 不等待，立即返回
    sendMetricsAsync(context).catch(console.error);
  }
});

// 不好：阻塞执行
const blockingMiddleware = createMiddleware({
  name: 'blocking',

  afterAgent: async (context) => {
    // 等待 5 秒
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
});
```

## 架构决策

### 为什么选择这些设计模式？

1. **责任链模式**：允许多个中间件按顺序处理请求，易于扩展和组合
2. **洋葱模型**：提供强大的包裹能力，支持前后处理和短路
3. **工厂模式**：统一验证和规范化，减少错误

### 与 LangChain 的对齐

生命周期 hooks 与 LangChain 的 Runnable 接口对齐，便于迁移和集成。

### 为什么不使用 AOP？

AOP（面向切面编程）过于复杂，中间件模式更简单直观，足以满足需求。

## 文件结构

```
src/core/middleware/
├── index.ts          # 导出入口
├── types.ts          # 类型定义和工厂函数
├── pipeline.ts       # 管道类（门面）
├── execution.ts      # 执行算法（责任链 + 洋葱模型）
└── README.md         # 本文档
```

## 相关文档

- [Agent Runtime 架构](../agents/runtime/README.md)
- [Events 事件系统](../agents/events/README.md)
- [LangChain Runnable 接口](https://js.langchain.com/docs/expression_language/)
