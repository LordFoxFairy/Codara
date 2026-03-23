# 第10章：Team Protocols — 结构化协作语义

## 从消息到协议

s08 让 Agent 可以互相发消息。但消息只解决"内容能送到"。

真正的协作需要更多：

- 这是请求还是响应
- 对方批准了还是拒绝了
- 什么时候算完成
- 什么时候算超时

这就是协议存在的原因。

## 协议的本质

协议不是 JSON 字段约定，而是状态机。

```typescript
type ProtocolState =
  | { status: "pending", requestId: string }
  | { status: "approved", requestId: string }
  | { status: "rejected", requestId: string, reason: string }

function handleResponse(state: ProtocolState, response: Response) {
  if (state.status !== "pending") throw new Error("Invalid state")
  return response.approve
    ? { status: "approved", requestId: state.requestId }
    : { status: "rejected", requestId: state.requestId, reason: response.reason }
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

`requestId` 是关键：它让响应能对应到请求。

## 为什么不用简单消息

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

- **Plan Approval**: Worker 提交计划，Leader 审批
- **Task Assignment**: Leader 分配任务，Worker 确认接受
- **Resource Request**: Worker 请求资源，Leader 批准或拒绝

核心都是：请求 → 等待 → 响应 → 状态转换。

## 设计原则

**1. 请求必须有 ID**

```typescript
// ✓ 好
{ type: "request", requestId: "abc-123", ... }

// ✗ 坏
{ type: "request", ... }
```

**2. 响应必须引用请求**

```typescript
// ✓ 好
{ type: "response", requestId: "abc-123", approve: true }

// ✗ 坏
{ type: "response", approve: true }
```

**3. 状态转换必须明确**

```typescript
// ✓ 好
pending → approved | rejected

// ✗ 坏
pending → done (done 是批准还是拒绝？)
```

---

**协议把多 Agent 协作从"能发消息"提升到"有明确状态语义的结构化协作"。**
