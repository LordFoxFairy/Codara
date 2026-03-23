---
title: 第12章：Heartbeat — 定时唤醒机制
---

# 第12章：Heartbeat — 定时唤醒机制

> **从被动到主动的第一步**：让 agent 从"踹一下动一下"变成"自己隔 30 秒醒一次找活干"。

---

## 为什么需要 Heartbeat

**临时会话的局限**：
- Claude Code / Codara：用完即走，关掉终端会话就消失
- 每次重开都是全新上下文，agent 不记得之前的事
- 只能被动响应用户输入，无法主动检查待办事项

**常驻助手的需求**：
- 定期检查是否有新消息、新任务、新事件
- 即使用户不在，也能自动执行定时任务
- 保持"始终在线"的助手体验

**Heartbeat 的本质**：
```
临时会话：user input → agent loop → output → 结束
常驻助手：timer → heartbeat → agent loop → output → sleep → timer
```

Heartbeat 是 harness 层的定时器，每隔一段时间（默认 30 秒）给 agent 发一条消息，让它检查有没有事可做。

---

## 核心机制

### 1. Wake Handler — 唤醒处理器

Heartbeat 的核心是一个全局的 wake handler：

```typescript
type HeartbeatWakeHandler = (opts: {
  reason?: string;
  agentId?: string;
  sessionKey?: string;
}) => Promise<HeartbeatRunResult>;

setHeartbeatWakeHandler(handler);
requestHeartbeatNow({ reason: "interval" });
```

**设计要点**：
- **全局单例**：整个进程只有一个 wake handler
- **异步执行**：handler 返回 Promise，支持长时间运行
- **结果反馈**：返回 `ran | skipped | failed`，用于重试逻辑

### 2. Priority Queue — 优先级队列

多个唤醒请求会被合并到优先级队列：

```typescript
const REASON_PRIORITY = {
  RETRY: 0,      // 重试（最高优先级）
  INTERVAL: 1,   // 定时心跳
  DEFAULT: 2,    // 默认
  ACTION: 3,     // 用户触发（最低优先级）
};
```

**合并策略**：
- 同一个 `agentId + sessionKey` 只保留一个待处理请求
- 高优先级覆盖低优先级
- 同优先级保留最新的

**为什么需要优先级**：
- RETRY 必须尽快执行，避免丢失重要事件
- INTERVAL 是常规心跳，可以被更重要的事情打断
- ACTION 是用户主动触发，优先级最低（因为用户已经在等待）

### 3. Coalesce — 合并延迟

避免频繁唤醒，使用 coalesce 机制：

```typescript
const DEFAULT_COALESCE_MS = 250;  // 250ms 内的请求合并
const DEFAULT_RETRY_MS = 1000;    // 重试间隔 1 秒

schedule(coalesceMs, kind);
```

**合并逻辑**：
- 收到唤醒请求后，等待 250ms 再执行
- 如果 250ms 内又来了新请求，合并到同一批次
- 重试请求使用更长的延迟（1 秒），避免雪崩

**Timer 抢占**：
- 如果新请求需要更早执行，取消旧 timer，重新调度
- 如果旧 timer 更早，保持不变
- 重试 timer 不会被抢占（保证 backoff）

### 4. Execution Loop — 执行循环

```typescript
async function executeWakeBatch() {
  const batch = Array.from(pendingWakes.values());
  pendingWakes.clear();

  for (const wake of batch) {
    const result = await handler(wake);
    if (result.status === "skipped" && result.reason === "requests-in-flight") {
      // 主线程忙，稍后重试
      queuePendingWakeReason({ ...wake, reason: "retry" });
      schedule(DEFAULT_RETRY_MS, "retry");
    }
  }
}
```

**并发控制**：
- `running` 标志防止重入：如果正在执行，新请求排队
- `scheduled` 标志防止重复调度：执行完后检查是否有新请求
- 批量执行：一次处理所有待处理的唤醒请求

---

## 设计权衡

| 维度 | 选择 | 原因 |
|------|------|------|
| **唤醒间隔** | 30 秒 | 平衡响应速度和资源消耗 |
| **合并延迟** | 250ms | 避免抖动，减少无效唤醒 |
| **重试间隔** | 1 秒 | 给主线程喘息时间，避免雪崩 |
| **优先级策略** | 4 级 | 保证重试优先，避免丢失事件 |
| **并发模型** | 串行 | 简化状态管理，避免竞态 |

**为什么是 30 秒**：
- 太短（<10s）：频繁唤醒浪费资源，LLM 调用成本高
- 太长（>60s）：响应延迟明显，用户体验差
- 30 秒是经验值：既能及时响应，又不会过度消耗

**为什么串行执行**：
- 并发执行会导致多个 agent loop 同时运行
- 共享状态（session、memory）需要复杂的锁机制
- 串行执行简单可靠，性能瓶颈在 LLM 而非调度

---

## 与 Agent Core 的关系

```
┌─────────────────────────────────────────┐
│         Harness Layer (Heartbeat)        │
│  ┌────────┐    ┌──────────┐    ┌─────┐  │
│  │ Timer  │───▶│ Wake Q   │───▶│ Run │  │
│  └────────┘    └──────────┘    └──┬──┘  │
└────────────────────────────────────┼─────┘
                                     │
┌────────────────────────────────────┼─────┐
│         Agent Core (Loop)           │     │
│  ┌────────┐    ┌──────────┐    ┌──▼──┐  │
│  │ Input  │───▶│ Pipeline │───▶│ Out │  │
│  └────────┘    └──────────┘    └─────┘  │
└─────────────────────────────────────────┘
```

**Heartbeat 只是输入源**：
- Heartbeat 生成一条特殊的 input message
- Agent core 不知道这是心跳还是用户输入
- 执行流程完全一致：Pipeline → Middleware → Tools

**Heartbeat 的 input 格式**：
```typescript
{
  role: "user",
  content: "Heartbeat check: any pending tasks or messages?"
}
```

Agent 收到后，会检查：
- 是否有新的 IM 消息
- 是否有到期的 cron 任务
- 是否有需要处理的系统事件

---

## 实现细节

### 1. Handler 注册

```typescript
export function setHeartbeatWakeHandler(
  next: HeartbeatWakeHandler | null
): () => void {
  handlerGeneration += 1;
  const generation = handlerGeneration;
  handler = next;

  // 返回 disposer，防止旧 handler 清理新 handler
  return () => {
    if (handlerGeneration !== generation) return;
    if (handler !== next) return;
    handler = null;
  };
}
```

**Generation 机制**：
- 每次注册 handler，generation 递增
- Disposer 检查 generation，防止旧 handler 清理新 handler
- 支持热重载：SIGUSR1 信号触发重启，旧 handler 自动失效

### 2. 请求合并

```typescript
function queuePendingWakeReason(params) {
  const key = `${agentId}::${sessionKey}`;
  const next = {
    reason: normalizeReason(params.reason),
    priority: resolvePriority(params.reason),
    requestedAt: Date.now(),
  };

  const prev = pendingWakes.get(key);
  if (!prev || next.priority > prev.priority) {
    pendingWakes.set(key, next);
  }
}
```

**Key 设计**：
- `agentId + sessionKey` 唯一标识一个 agent 实例
- 同一个 agent 只保留一个待处理请求
- 不同 agent 可以并发执行（虽然当前是串行）

### 3. Timer 调度

```typescript
function schedule(delay, kind) {
  const dueAt = Date.now() + delay;

  // 重试 timer 不被抢占
  if (timerKind === "retry") return;

  // 旧 timer 更早，保持不变
  if (timerDueAt && timerDueAt <= dueAt) return;

  // 新 timer 更早，抢占旧 timer
  clearTimeout(timer);
  timer = setTimeout(executeWakeBatch, delay);
  timer.unref(); // 不阻止进程退出
}
```

**unref() 的作用**：
- Node.js 的 timer 默认会阻止进程退出
- `unref()` 让 timer 不阻止退出
- 如果没有其他活动（如 HTTP server），进程可以正常退出

---

## 数学模型

### 1. 唤醒频率

假设心跳间隔为 `T`，合并延迟为 `C`，则：

```
实际唤醒频率 = 1 / (T + C)
理论唤醒频率 = 1 / T
效率 = T / (T + C)
```

当 `T = 30s, C = 0.25s` 时：
```
效率 = 30 / 30.25 ≈ 99.2%
```

合并延迟对整体频率影响很小，但能显著减少抖动。

### 2. 重试概率

假设主线程忙的概率为 `p`，重试间隔为 `R`，则：

```
期望重试次数 = p / (1 - p)
期望总延迟 = T + p * R / (1 - p)
```

当 `p = 0.1, R = 1s` 时：
```
期望重试次数 = 0.1 / 0.9 ≈ 0.11 次
期望总延迟 = 30 + 0.11 ≈ 30.11 秒
```

重试机制对延迟影响很小，但能保证可靠性。

---

## 总结

Heartbeat 是从被动会话到主动助手的第一步：

1. **定时唤醒**：每 30 秒给 agent 发一条消息
2. **优先级队列**：合并多个请求，保证重试优先
3. **合并延迟**：250ms 内的请求合并，减少抖动
4. **重试机制**：主线程忙时自动重试，保证可靠性

**关键洞察**：
- Heartbeat 不改变 agent core，只是新的输入源
- 串行执行简单可靠，性能瓶颈在 LLM 而非调度
- 30 秒间隔是经验值，平衡响应速度和资源消耗

下一章将讲解 **Cron**：如何让 agent 给自己安排未来任务。
