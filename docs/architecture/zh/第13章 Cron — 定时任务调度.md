# 第13章：Cron — 定时任务调度

> **让 agent 给自己安排未来**：从"被动响应"到"主动规划"，agent 可以创建定时任务，到点自动执行。

---

## 为什么需要 Cron

**Heartbeat 的局限**：
- 只能定期检查，无法精确到某个时间点
- 每次检查都要调用 LLM，成本高
- 无法表达"明天早上 9 点提醒我"这种需求

**Cron 的价值**：
```typescript
// Heartbeat: 每 30 秒检查一次
setInterval(() => agent.check(), 30_000);

// Cron: 精确到时间点
cron.add({
  schedule: "0 9 * * *",  // 每天 9 点
  prompt: "提醒用户今天的会议安排"
});
```

**核心差异**：
- Heartbeat 是**轮询**：定期问"有事吗？"
- Cron 是**事件驱动**：到点了就执行

---

## 核心机制

### 1. Job Store — 任务存储

Cron 任务持久化到磁盘：

```typescript
interface CronJob {
  id: string;
  schedule: string;        // cron 表达式
  prompt: string;          // 要执行的任务
  enabled: boolean;
  nextRunAt: number;       // 下次执行时间（毫秒）
  lastRunAt?: number;
  deliveryTarget?: {       // 结果发送到哪里
    channel: string;
    threadId: string;
  };
}
```

**存储位置**：
```
~/.openclaw/agents/{agentId}/cron.json
```

**为什么持久化**：
- 进程重启后任务不丢失
- 支持跨会话的长期任务
- 可以查看历史执行记录

### 2. Timer — 定时器

Cron Service 维护一个全局定时器：

```typescript
class CronService {
  private timer: NodeJS.Timeout | null = null;
  private nextDueAt: number | null = null;

  private scheduleNextRun() {
    const nextJob = this.findNextDueJob();
    if (!nextJob) return;

    const delay = nextJob.nextRunAt - Date.now();
    this.timer = setTimeout(() => {
      this.runJob(nextJob.id);
      this.scheduleNextRun();  // 递归调度
    }, delay);
  }
}
```

**单定时器设计**：
- 只维护一个 timer，指向最近的任务
- 任务执行完后，重新计算下一个任务
- 避免多个 timer 竞争，简化状态管理

**为什么不用多个 timer**：
- 任务数量可能很多（几十个），每个都开 timer 浪费资源
- 单 timer 更容易管理：取消、重新调度、优先级
- 性能瓶颈在 LLM 调用，不在调度器

### 3. Isolated Agent — 隔离执行

Cron 任务在隔离的 agent 实例中执行：

```typescript
async function runCronIsolatedAgentTurn(job: CronJob) {
  const sessionKey = resolveCronAgentSessionKey(job);
  const session = await resolveCronSession(sessionKey);

  const result = await runCliAgent({
    input: job.prompt,
    session,
    agentId: job.agentId,
  });

  return result;
}
```

**隔离的含义**：
- 每个 cron 任务有独立的 session
- 不污染主会话的上下文
- 可以并发执行多个任务（虽然当前是串行）

**Session Key 设计**：
```typescript
function resolveCronAgentSessionKey(job: CronJob): string {
  return `cron:${job.id}`;
}
```

每个 cron 任务对应一个固定的 session，保证上下文连续性。

### 4. Delivery — 结果投递

Cron 任务执行完后，结果可以投递到指定渠道：

```typescript
interface DeliveryTarget {
  channel: "telegram" | "slack" | "discord" | ...;
  threadId: string;      // 群组 ID / 频道 ID
  userId?: string;       // 可选：@某人
}

async function dispatchCronDelivery(
  result: AgentResult,
  target: DeliveryTarget
) {
  const plugin = getChannelPlugin(target.channel);
  await plugin.send({
    threadId: target.threadId,
    text: result.output,
  });
}
```

**投递策略**：
- 如果指定了 `deliveryTarget`，发送到对应渠道
- 如果没有指定，只记录到日志
- 支持"静默执行"：任务执行但不打扰用户

---

## 设计权衡

| 维度 | 选择 | 原因 |
|------|------|------|
| **调度精度** | 秒级 | 足够精确，避免毫秒级复杂度 |
| **并发模型** | 串行 | 简化状态管理，避免竞态 |
| **持久化** | JSON 文件 | 简单可靠，无需数据库 |
| **Session 隔离** | 每任务独立 | 避免污染主会话 |
| **投递模式** | 可选 | 支持静默执行和通知 |

**为什么串行执行**：
- 并发执行需要复杂的锁机制
- LLM 调用是瓶颈，并发收益不大
- 串行执行简单可靠，易于调试

**为什么用 JSON 文件**：
- 任务数量不多（通常 < 100）
- 读写频率低（每分钟几次）
- 无需复杂查询，JSON 足够
- 避免引入数据库依赖

---

## Cron 表达式

支持标准 5 字段 cron 表达式：

```
┌───────────── 分钟 (0 - 59)
│ ┌─────────── 小时 (0 - 23)
│ │ ┌───────── 日期 (1 - 31)
│ │ │ ┌─────── 月份 (1 - 12)
│ │ │ │ ┌───── 星期 (0 - 6, 0 = 周日)
│ │ │ │ │
* * * * *
```

**常用示例**：
```typescript
"0 9 * * *"      // 每天 9:00
"*/30 * * * *"   // 每 30 分钟
"0 9 * * 1-5"    // 工作日 9:00
"0 0 1 * *"      // 每月 1 号 0:00
```

**特殊语法**：
- `*/N`：每 N 个单位
- `M-N`：范围
- `M,N,O`：枚举

---

## 与 Heartbeat 的协作

```
┌─────────────────────────────────────────┐
│         Cron Service                     │
│  ┌────────┐    ┌──────────┐    ┌─────┐  │
│  │ Timer  │───▶│ Job Store│───▶│ Run │  │
│  └────────┘    └──────────┘    └──┬──┘  │
└────────────────────────────────────┼─────┘
                                     │
┌────────────────────────────────────┼─────┐
│         Heartbeat                   │     │
│  ┌────────┐    ┌──────────┐    ┌──▼──┐  │
│  │ Timer  │───▶│ Wake Q   │───▶│ Run │  │
│  └────────┘    └──────────┘    └──┬──┘  │
└────────────────────────────────────┼─────┘
                                     │
┌────────────────────────────────────┼─────┐
│         Agent Core                  │     │
│  ┌────────┐    ┌──────────┐    ┌──▼──┐  │
│  │ Input  │───▶│ Pipeline │───▶│ Out │  │
│  └────────┘    └──────────┘    └─────┘  │
└─────────────────────────────────────────┘
```

**两者的分工**：
- **Heartbeat**：定期检查，处理实时事件
- **Cron**：精确调度，处理计划任务

**协作场景**：
1. Heartbeat 检查到有 cron 任务到期
2. 触发 cron 任务执行
3. Cron 任务完成后，通过 heartbeat 投递结果

---

## 实现细节

### 1. 下次执行时间计算

```typescript
function calculateNextRunAt(
  schedule: string,
  after: number = Date.now()
): number {
  const cron = parseCronExpression(schedule);
  let candidate = after + 60_000;  // 从下一分钟开始

  while (true) {
    if (cron.matches(candidate)) {
      return candidate;
    }
    candidate += 60_000;  // 每次增加 1 分钟
    if (candidate > after + 365 * 24 * 60 * 60 * 1000) {
      throw new Error("No valid next run time in next year");
    }
  }
}
```

**为什么从下一分钟开始**：
- Cron 精度是分钟级，秒级没有意义
- 避免"刚创建就执行"的边界情况

### 2. 任务执行日志

```typescript
interface CronRunLog {
  jobId: string;
  startedAt: number;
  finishedAt: number;
  status: "success" | "failed";
  output?: string;
  error?: string;
}

// 存储位置
~/.openclaw/agents/{agentId}/cron-logs/{jobId}/{timestamp}.json
```

**日志用途**：
- 调试任务执行问题
- 统计任务成功率
- 审计任务历史

### 3. 失败重试

```typescript
async function runJobWithRetry(job: CronJob) {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      return await runCronIsolatedAgentTurn(job);
    } catch (error) {
      attempt++;
      if (attempt >= maxAttempts) throw error;
      await sleep(1000 * attempt);  // 指数退避
    }
  }
}
```

**重试策略**：
- 最多重试 3 次
- 指数退避：1s, 2s, 3s
- 失败后记录日志，不阻塞其他任务

---

## 使用场景

### 1. 定时提醒

```typescript
cron.add({
  schedule: "0 9 * * 1-5",  // 工作日 9:00
  prompt: "检查今天的日程，提醒我重要会议",
  deliveryTarget: {
    channel: "telegram",
    threadId: "my-chat-id",
  },
});
```

### 2. 定期报告

```typescript
cron.add({
  schedule: "0 18 * * 5",  // 每周五 18:00
  prompt: "总结本周工作进展，生成周报",
  deliveryTarget: {
    channel: "slack",
    threadId: "team-channel",
  },
});
```

### 3. 后台任务

```typescript
cron.add({
  schedule: "0 2 * * *",  // 每天凌晨 2:00
  prompt: "清理过期的临时文件",
  // 不指定 deliveryTarget，静默执行
});
```

---

## 总结

Cron 让 agent 从"被动响应"变成"主动规划"：

1. **精确调度**：支持标准 cron 表达式，精确到分钟
2. **持久化**：任务存储到磁盘，进程重启不丢失
3. **隔离执行**：每个任务独立 session，不污染主会话
4. **灵活投递**：支持多渠道投递，也支持静默执行

**关键洞察**：
- Cron 是 Heartbeat 的补充，不是替代
- 单定时器设计简单可靠，性能瓶颈在 LLM
- Session 隔离保证上下文连续性

下一章将讲解 **IM Channels**：如何统一接入 13+ 消息平台。
