# s09: Team Protocols

> *"Request-Response FSM — pending → approved/rejected"*

## 问题

s08 中队友能干活能通信，但缺少结构化协调：

**关机：** 直接杀线程会留下写了一半的文件和过期的 config.json。需要握手 — 领导请求，队友批准（收尾退出）或拒绝（继续干）。

**计划审批：** 领导说"重构认证模块"，队友立刻开干。高风险变更应该先过审。

两者结构一样：一方发带唯一 ID 的请求，另一方引用同一 ID 响应。

## 核心设计

```
Shutdown Protocol            Plan Approval Protocol
==================           ======================

Lead             Teammate    Teammate           Lead
  |                 |           |                 |
  |--shutdown_req-->|           |--plan_req------>|
  | {req_id:"abc"}  |           | {req_id:"xyz"}  |
  |                 |           |                 |
  |<--shutdown_resp-|           |<--plan_resp-----|
  | {req_id:"abc",  |           | {req_id:"xyz",  |
  |  approve:true}  |           |  approve:true}  |

Shared FSM:
  [pending] --approve--> [approved]
  [pending] --reject---> [rejected]
```

**一个 FSM，两种用途。**

## 为什么需要协议？

### 问题：无结构通信

```
Lead: "alice, 关机吧"
Alice: "好的"  (但还在写文件)
Lead: (杀线程)
Result: 文件写了一半，状态不一致
```

### 解决方案：握手协议

```
Lead: shutdown_request(req_id="abc")
Alice: (收尾工作)
Alice: shutdown_response(req_id="abc", approve=true)
Lead: (确认后清理)
Result: 状态一致
```

## Request ID 的作用

为什么需要 request_id？

```
场景：多个请求并发

Lead: shutdown_request(req_id="abc")
Lead: plan_request(req_id="xyz")
Alice: plan_response(req_id="xyz", approve=true)
Alice: shutdown_response(req_id="abc", approve=false)

通过 req_id 关联请求和响应，防止混淆。
```

## FSM 的通用性

同样的 FSM 可以套用到任何需要确认的操作：

```
pending → approved/rejected

适用场景：
- 关机请求
- 计划审批
- 资源申请
- 权限变更
- ...
```

## 伪代码

```python
requests = {}  # {req_id: {target, status}}

def send_request(to, type):
    req_id = uuid()
    requests[req_id] = {"target": to, "status": "pending"}
    BUS.send("lead", to, type, {"request_id": req_id})
    return req_id

def handle_response(req_id, approve):
    requests[req_id]["status"] = "approved" if approve else "rejected"
```

7 行。FSM + request_id 关联。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| Request-Response | 状态一致，可追踪 | 增加交互轮次 |
| request_id 关联 | 支持并发请求 | 需要维护映射表 |
| FSM 通用化 | 一套模式多种用途 | 可能过度抽象 |
| 优雅关机 | 状态一致性 | 可能被拒绝 |

## 关键洞察

- **request_id 是协议的核心** — 关联请求和响应，防止混淆
- **FSM 是通用模式** — 任何需要确认的操作都可以用这个模式
- **优雅关机 vs 强制关机** — 握手保证状态一致性
- **计划门控是安全边界** — 高风险操作必须经过审批

---

**队友之间要有规矩。一个 FSM 驱动所有协商。**
