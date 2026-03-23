# 第10章：Team Protocols — 结构化协作语义

## 从消息到协议

s08 让 Agent 可以互相发消息。但消息只解决"内容能送到"。

真正的协作需要更多：

- 这是请求还是响应
- 对方批准了还是拒绝了
- 什么时候算完成
- 什么时候算超时

这就是协议存在的原因。

**问题：** 如果只有消息，系统会退化成"聊天室"：

```typescript
// Leader 发消息
await sendMessage("worker-1", "请关机")

// 2 秒后 Worker 回复
await sendMessage("leader", "我还在工作")

// Leader 收到消息，但不知道：
// 1. 这是拒绝关机，还是普通状态汇报？
// 2. 如果是拒绝，对应哪个关机请求？（可能发了多个）
// 3. 如果 Worker 不回复，等多久算超时？
```

协议通过**结构化消息 + 状态机**解决这些问题。

## 协议的本质：有限状态机

协议不是 JSON 字段约定，而是**有限状态机（FSM）**。

```typescript
type ProtocolState =
  | { status: "pending", requestId: string, timestamp: number }
  | { status: "approved", requestId: string }
  | { status: "rejected", requestId: string, reason: string }
  | { status: "timeout", requestId: string }

function handleResponse(state: ProtocolState, response: Response) {
  if (state.status !== "pending") throw new Error("Invalid state")
  return response.approve
    ? { status: "approved", requestId: state.requestId }
    : { status: "rejected", requestId: state.requestId, reason: response.reason }
}
```

### 状态转移表

完整的 Shutdown Protocol FSM：

```
State       | Event              | Next State | Action
------------|--------------------|-----------|---------
IDLE        | send_request       | PENDING   | 生成 requestId, 发送消息, 启动超时计时器
PENDING     | receive_approve    | APPROVED  | 取消计时器, 终止 Worker
PENDING     | receive_reject     | REJECTED  | 取消计时器, 记录原因
PENDING     | timeout (30s)      | TIMEOUT   | 强制终止 Worker, 记录日志
APPROVED    | *                  | APPROVED  | 忽略（终态）
REJECTED    | *                  | REJECTED  | 忽略（终态）
TIMEOUT     | *                  | TIMEOUT   | 忽略（终态）
```

**关键约束：**

1. **单向性：** 一旦进入终态（APPROVED/REJECTED/TIMEOUT），不能再转换
2. **幂等性：** 重复收到相同 `requestId` 的响应，只处理第一次
3. **超时保证：** PENDING 状态最多持续 30 秒，之后必须转换到 TIMEOUT

### 为什么需要状态机

如果没有状态机，系统会出现这些问题：

```typescript
// ✗ 错误：没有状态管理
async function shutdownWorker(workerId: string) {
  await sendMessage(workerId, { type: "shutdown_request" })
  // 问题：
  // 1. 如果 Worker 不回复怎么办？
  // 2. 如果 Worker 回复了两次怎么办？
  // 3. 如果同时发了多个 shutdown 请求怎么办？
}

// ✓ 正确：状态机管理
class ShutdownProtocol {
  private state: ProtocolState = { status: "idle" }
  private timeoutHandle?: NodeJS.Timeout

  async request(workerId: string, reason: string) {
    if (this.state.status !== "idle") {
      throw new Error(`Already in ${this.state.status} state`)
    }

    const requestId = crypto.randomUUID()
    this.state = { status: "pending", requestId, timestamp: Date.now() }

    // 启动超时计时器
    this.timeoutHandle = setTimeout(() => {
      if (this.state.status === "pending") {
        this.state = { status: "timeout", requestId }
        this.forceTerminate(workerId)
      }
    }, 30000)

    await sendMessage(workerId, {
      type: "shutdown_request",
      requestId,
      reason
    })
  }

  handleResponse(response: ShutdownResponse) {
    if (this.state.status !== "pending") {
      console.warn(`Ignoring response in ${this.state.status} state`)
      return
    }

    if (response.requestId !== this.state.requestId) {
      console.warn(`Mismatched requestId: ${response.requestId}`)
      return
    }

    clearTimeout(this.timeoutHandle)

    this.state = response.approve
      ? { status: "approved", requestId: response.requestId }
      : { status: "rejected", requestId: response.requestId, reason: response.reason }
  }
}
```

关键是双方共享同一状态转换规则。

## 典型协议：Shutdown Request

Leader 要关闭 Worker，不能直接杀进程，要让 Worker 有机会拒绝。

```typescript
// Leader 发起
sendMessage({
  type: "shutdown_request",
  requestId: uuid(),
  reason: "Task completed"
})

// Worker 响应
sendMessage({
  type: "shutdown_response",
  requestId: originalRequestId,
  approve: false,
  reason: "Still working on task #3"
})
```

### requestId 的设计细节

**为什么用 UUID v4？**

```typescript
const requestId = crypto.randomUUID()
// 生成格式：550e8400-e29b-41d4-a716-446655440000
```

UUID v4 是 128 位随机数，冲突概率极低：

```
生成 1 亿个 UUID，冲突概率 ≈ 0.0000000001%
生成 10 亿个 UUID，冲突概率 ≈ 0.00000001%
```

**为什么不用递增 ID？**

```typescript
// ✗ 错误：递增 ID
let nextId = 1
const requestId = `req-${nextId++}`

// 问题：
// 1. 多个 Leader 同时发请求，ID 会冲突
// 2. 需要全局状态管理，增加复杂度
// 3. 重启后 ID 重置，可能和旧请求冲突
```

**为什么不用时间戳？**

```typescript
// ✗ 错误：时间戳
const requestId = `${Date.now()}`

// 问题：
// 1. 同一毫秒内发多个请求，ID 会冲突
// 2. 时钟回拨会导致 ID 重复
// 3. 精度不够（JavaScript 时间戳是毫秒级）
```

UUID v4 的优势：

1. **无需协调：** 每个 Agent 独立生成，不需要中心化分配
2. **全局唯一：** 跨进程、跨机器、跨时间都唯一
3. **无序性：** 不泄露生成顺序和时间信息

### 超时和重试策略

**超时时间的选择：**

```typescript
const TIMEOUT_MS = 30000  // 30 秒

// 为什么是 30 秒？
// 1. LLM 推理时间：5-15 秒（P95）
// 2. 消息传输延迟：< 100ms
// 3. Worker 处理时间：< 5 秒
// 4. 缓冲时间：10 秒
// 总计：30 秒足够覆盖 P99 场景
```

**超时后的行为：**

```typescript
setTimeout(() => {
  if (this.state.status === "pending") {
    console.error(`Shutdown request ${requestId} timeout after 30s`)

    // 强制终止 Worker
    this.forceTerminate(workerId)

    // 记录到日志
    logger.warn({
      event: "shutdown_timeout",
      workerId,
      requestId,
      reason: "Worker did not respond within 30s"
    })

    this.state = { status: "timeout", requestId }
  }
}, TIMEOUT_MS)
```

**为什么不重试？**

Shutdown 协议不应该重试，因为：

1. **幂等性问题：** Worker 可能已经收到第一次请求，正在处理
2. **状态不确定：** 重试会导致多个请求同时存在，状态混乱
3. **超时即失败：** 30 秒不响应说明 Worker 已经异常，应该强制终止

**对比：Task Assignment 协议可以重试**

```typescript
// Task Assignment 可以重试，因为：
// 1. Worker 可以拒绝任务，不会产生副作用
// 2. 重试不会改变系统状态
// 3. 最终一致性：重试直到成功或放弃

async function assignTask(workerId: string, task: Task) {
  const maxRetries = 3
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await sendRequestWithTimeout(workerId, {
        type: "task_assignment",
        requestId: crypto.randomUUID(),
        task
      }, 10000)  // 10 秒超时

      if (response.accept) return true
    } catch (e) {
      if (i === maxRetries - 1) throw e
      await sleep(1000 * (i + 1))  // 指数退避
    }
  }
}
```

`requestId` 是关键：它让响应能对应到请求。

## 与分布式系统的两阶段提交对比

Team Protocols 和分布式系统的 2PC（Two-Phase Commit）有相似之处，但也有关键区别。

### 两阶段提交（2PC）

```
Phase 1: Prepare
Coordinator → Participants: "Can you commit?"
Participants → Coordinator: "Yes" or "No"

Phase 2: Commit
Coordinator → Participants: "Commit" or "Abort"
Participants: Execute and ACK
```

**2PC 的保证：**

1. **原子性：** 所有参与者要么全部提交，要么全部回滚
2. **一致性：** 所有参与者看到相同的结果
3. **持久性：** 提交后数据不会丢失

**2PC 的代价：**

1. **阻塞：** Coordinator 崩溃会导致参与者永久阻塞
2. **性能：** 需要两轮网络往返
3. **复杂性：** 需要持久化日志，处理各种失败场景

### Team Protocols 的简化设计

```
Phase 1: Request
Leader → Worker: "Shutdown request"
Worker → Leader: "Approve" or "Reject"

Phase 2: Execute
Leader: Terminate Worker (if approved)
```

**关键区别：**

| 特性 | 2PC | Team Protocols |
|------|-----|----------------|
| 参与者数量 | 多个（N > 2） | 两个（Leader + Worker） |
| 原子性保证 | 强保证（所有或无） | 弱保证（单个 Worker） |
| 持久化 | 必须（WAL） | 不需要（内存状态） |
| 阻塞处理 | 需要 3PC 或 Paxos | 超时强制终止 |
| 失败恢复 | 复杂（需要协调者选举） | 简单（Leader 重启即可） |

**为什么不需要 2PC 的复杂性？**

1. **单点决策：** Leader 是唯一决策者，不需要多方共识
2. **可重试：** Worker 崩溃可以重新启动，不需要恢复状态
3. **弱一致性：** Agent 协作不需要强一致性，最终一致性即可

### 实际的性能数据

**2PC 的延迟：**

```
Prepare Phase:  50ms (网络往返)
Commit Phase:   50ms (网络往返)
Log Sync:       20ms (磁盘写入)
Total:          120ms
```

**Team Protocols 的延迟：**

```
Request:        < 1ms (内存消息队列)
LLM Processing: 5-15s (模型推理)
Response:       < 1ms (内存消息队列)
Total:          5-15s (主要是 LLM 推理)
```

关键差异：Team Protocols 的瓶颈是 LLM 推理，不是网络或磁盘 I/O。

### 为什么不用简单消息

如果没有协议，系统会变成这样：

```typescript
// Leader
sendMessage("请关机")

// Worker
sendMessage("我还在工作")

// Leader 收到消息，但不知道：
// - 这是拒绝关机，还是普通状态汇报？
// - 如果是拒绝，对应哪个关机请求？
```

协议让语义明确：

```typescript
if (msg.type === "shutdown_response" && msg.requestId === myRequestId) {
  if (msg.approve) {
    terminateWorker()
  } else {
    console.log(`Worker rejected: ${msg.reason}`)
  }
}
```

## 其他协议场景

同样的模式可以用于：

### 1. Plan Approval Protocol

Worker 提交计划，Leader 审批。

```typescript
// Worker 提交计划
sendMessage({
  type: "plan_approval_request",
  requestId: crypto.randomUUID(),
  plan: {
    title: "Refactor authentication module",
    steps: [
      "Extract auth logic to separate service",
      "Add unit tests for auth service",
      "Update integration tests"
    ],
    estimatedTime: "2 hours"
  }
})

// Leader 审批
sendMessage({
  type: "plan_approval_response",
  requestId: originalRequestId,
  approve: true,
  feedback: "Looks good, proceed with implementation"
})
```

**状态转移表：**

```
State       | Event              | Next State | Action
------------|--------------------|-----------|---------
IDLE        | submit_plan        | PENDING   | 发送计划，等待审批
PENDING     | receive_approve    | APPROVED  | 开始执行计划
PENDING     | receive_reject     | REJECTED  | 修改计划，重新提交
PENDING     | timeout (60s)      | TIMEOUT   | 自动批准（假设 Leader 忙碌）
```

**关键差异：** Plan Approval 超时后自动批准，而 Shutdown 超时后强制终止。

### 2. Task Assignment Protocol

Leader 分配任务，Worker 确认接受。

```typescript
// Leader 分配任务
sendMessage({
  type: "task_assignment",
  requestId: crypto.randomUUID(),
  task: {
    id: "task-123",
    title: "Fix login bug",
    priority: "high",
    estimatedTime: "30 minutes"
  }
})

// Worker 响应
sendMessage({
  type: "task_assignment_response",
  requestId: originalRequestId,
  accept: true,
  estimatedStartTime: Date.now() + 5000  // 5 秒后开始
})
```

**状态转移表：**

```
State       | Event              | Next State | Action
------------|--------------------|-----------|---------
IDLE        | assign_task        | PENDING   | 发送任务，等待确认
PENDING     | receive_accept     | ACCEPTED  | 标记任务为 in_progress
PENDING     | receive_reject     | REJECTED  | 重新分配给其他 Worker
PENDING     | timeout (10s)      | TIMEOUT   | 重试或分配给其他 Worker
```

**关键特性：** 可以重试，因为任务分配是幂等操作。

### 3. Resource Request Protocol

Worker 请求资源，Leader 批准或拒绝。

```typescript
// Worker 请求资源
sendMessage({
  type: "resource_request",
  requestId: crypto.randomUUID(),
  resource: {
    type: "file_access",
    path: "/etc/sensitive-config.json",
    operation: "read"
  }
})

// Leader 响应
sendMessage({
  type: "resource_response",
  requestId: originalRequestId,
  approve: false,
  reason: "Access to sensitive files is restricted"
})
```

**状态转移表：**

```
State       | Event              | Next State | Action
------------|--------------------|-----------|---------
IDLE        | request_resource   | PENDING   | 发送请求，等待批准
PENDING     | receive_approve    | APPROVED  | 授予资源访问权限
PENDING     | receive_reject     | REJECTED  | 拒绝访问，记录原因
PENDING     | timeout (5s)       | TIMEOUT   | 默认拒绝（安全优先）
```

**关键特性：** 超时默认拒绝，遵循"安全优先"原则。

### 协议对比

| 协议 | 超时时间 | 超时行为 | 可重试 | 幂等性 |
|------|---------|---------|--------|--------|
| Shutdown | 30s | 强制终止 | 否 | 是 |
| Plan Approval | 60s | 自动批准 | 否 | 是 |
| Task Assignment | 10s | 重试/重新分配 | 是 | 是 |
| Resource Request | 5s | 默认拒绝 | 是 | 是 |

核心都是：请求 → 等待 → 响应 → 状态转换。

## 设计原则

### 1. 请求必须有 ID

```typescript
// ✓ 好
{ type: "request", requestId: "abc-123", ... }

// ✗ 坏
{ type: "request", ... }
```

**为什么？**

没有 `requestId`，系统无法处理这些场景：

```typescript
// 场景 1：并发请求
sendMessage({ type: "shutdown_request" })  // Request A
sendMessage({ type: "shutdown_request" })  // Request B

// 收到响应：{ type: "shutdown_response", approve: true }
// 问题：这是批准 A 还是 B？

// 场景 2：延迟响应
sendMessage({ type: "task_assignment", task: "task-1" })  // 10:00:00
sendMessage({ type: "task_assignment", task: "task-2" })  // 10:00:05

// 10:00:10 收到响应：{ type: "task_assignment_response", accept: true }
// 问题：Worker 接受的是 task-1 还是 task-2？

// 场景 3：重复响应
sendMessage({ type: "plan_approval_request", plan: {...} })

// 收到两次响应（网络重传）：
// { type: "plan_approval_response", approve: true }
// { type: "plan_approval_response", approve: true }
// 问题：如何判断这是重复响应，而不是两个不同的批准？
```

**正确的实现：**

```typescript
class ProtocolManager {
  private pendingRequests = new Map<string, PendingRequest>()

  async sendRequest(type: string, payload: any): Promise<Response> {
    const requestId = crypto.randomUUID()

    const promise = new Promise<Response>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId)
        reject(new Error(`Request ${requestId} timeout`))
      }, 30000)

      this.pendingRequests.set(requestId, { resolve, reject, timeout })
    })

    await sendMessage({ type, requestId, ...payload })
    return promise
  }

  handleResponse(response: Response) {
    const pending = this.pendingRequests.get(response.requestId)
    if (!pending) {
      console.warn(`Received response for unknown request: ${response.requestId}`)
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(response.requestId)
    pending.resolve(response)
  }
}
```

### 2. 响应必须引用请求

```typescript
// ✓ 好
{ type: "response", requestId: "abc-123", approve: true }

// ✗ 坏
{ type: "response", approve: true }
```

**为什么？**

响应不引用请求，会导致：

1. **无法匹配：** 发送方不知道响应对应哪个请求
2. **内存泄漏：** 无法清理 `pendingRequests` Map
3. **超时失效：** 无法取消对应的超时计时器

**实际影响：**

```typescript
// 假设 10 秒内发送 100 个请求
for (let i = 0; i < 100; i++) {
  sendRequest({ type: "task_assignment", task: `task-${i}` })
  await sleep(100)
}

// 如果响应不带 requestId：
// 1. pendingRequests Map 会保留 100 个条目
// 2. 100 个超时计时器会同时运行
// 3. 30 秒后，100 个超时同时触发
// 4. 内存占用：100 × (Promise + Timer) ≈ 10 KB

// 如果响应带 requestId：
// 1. 每个响应会清理对应的条目
// 2. 超时计时器会被取消
// 3. 内存占用：只有未响应的请求
```

### 3. 状态转换必须明确

```typescript
// ✓ 好
pending → approved | rejected

// ✗ 坏
pending → done (done 是批准还是拒绝？)
```

**为什么？**

模糊的状态会导致：

```typescript
// 场景：模糊的 "done" 状态
if (state.status === "done") {
  // 问题：应该执行什么操作？
  // - 如果是批准，应该终止 Worker
  // - 如果是拒绝，应该保留 Worker
  // - 如果是超时，应该记录日志
  // 无法判断！
}

// 正确：明确的状态
if (state.status === "approved") {
  terminateWorker()
} else if (state.status === "rejected") {
  console.log(`Rejected: ${state.reason}`)
} else if (state.status === "timeout") {
  logger.error(`Timeout: ${state.requestId}`)
  forceTerminate()
}
```

### 4. 幂等性保证

所有协议必须是幂等的：重复执行相同请求，结果不变。

```typescript
// ✓ 幂等：Shutdown Request
sendMessage({ type: "shutdown_request", requestId: "abc-123" })
sendMessage({ type: "shutdown_request", requestId: "abc-123" })  // 重复
// 结果：Worker 只会收到一次，或者忽略重复请求

// ✗ 非幂等：递增计数器
sendMessage({ type: "increment_counter" })
sendMessage({ type: "increment_counter" })  // 重复
// 结果：计数器增加 2，而不是 1
```

**实现幂等性：**

```typescript
class Worker {
  private processedRequests = new Set<string>()

  handleRequest(request: Request) {
    // 检查是否已处理
    if (this.processedRequests.has(request.requestId)) {
      console.log(`Ignoring duplicate request: ${request.requestId}`)
      return
    }

    // 标记为已处理
    this.processedRequests.add(request.requestId)

    // 处理请求
    this.processRequest(request)

    // 定期清理旧请求（避免内存泄漏）
    if (this.processedRequests.size > 1000) {
      // 保留最近 1000 个，删除更早的
      const toDelete = Array.from(this.processedRequests).slice(0, -1000)
      toDelete.forEach(id => this.processedRequests.delete(id))
    }
  }
}
```

### 5. 超时必须可配置

不同协议的超时时间应该不同：

```typescript
const PROTOCOL_TIMEOUTS = {
  shutdown: 30000,        // 30s：需要等待 LLM 推理
  plan_approval: 60000,   // 60s：需要人工审查
  task_assignment: 10000, // 10s：快速响应
  resource_request: 5000, // 5s：安全优先，快速拒绝
  health_check: 1000      // 1s：健康检查应该很快
}

class ProtocolManager {
  async sendRequest(
    type: string,
    payload: any,
    timeout: number = PROTOCOL_TIMEOUTS[type] || 30000
  ): Promise<Response> {
    // ...
  }
}
```

### 6. 错误处理必须完整

协议必须处理所有可能的失败场景：

```typescript
enum ProtocolError {
  TIMEOUT = "timeout",
  NETWORK_ERROR = "network_error",
  INVALID_RESPONSE = "invalid_response",
  WORKER_CRASHED = "worker_crashed",
  REJECTED = "rejected"
}

async function sendRequestWithRetry(
  type: string,
  payload: any,
  maxRetries: number = 3
): Promise<Response> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await sendRequest(type, payload)
    } catch (error) {
      if (error.code === ProtocolError.TIMEOUT && i < maxRetries - 1) {
        console.log(`Request timeout, retrying (${i + 1}/${maxRetries})`)
        await sleep(1000 * (i + 1))  // 指数退避
        continue
      }
      throw error
    }
  }
}
```

---

**协议把多 Agent 协作从"能发消息"提升到"有明确状态语义的结构化协作"。**
