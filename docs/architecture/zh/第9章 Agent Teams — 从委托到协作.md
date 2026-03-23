# 第9章：Agent Teams — 从委托到协作

## 子 Agent 的局限

s06 的子 Agent 是一次性的：

```python
result = spawn_subagent(task)
# 执行完就结束了
```

这对单次委托够用，但不支持持续协作。

真正的团队需要：

- **稳定身份**：知道谁是谁
- **持续存活**：跨多轮任务
- **消息通道**：异步通信

**问题：** 如果每次都 spawn 新 Agent，就没有状态延续：

```python
# 第1次
result1 = spawn_subagent("分析代码")
# Agent 销毁，上下文丢失

# 第2次
result2 = spawn_subagent("基于刚才的分析，重构")
# 新 Agent 不知道"刚才的分析"是什么
```

团队模型解决的是：**让多个 Agent 持续存活，通过消息协作，而非每次重新创建。**

## 团队模型的核心

```python
class Team:
    members: Dict[str, Agent]  # 成员身份
    mailboxes: Dict[str, Queue]  # 消息队列

    def send(self, to: str, msg: str):
        self.mailboxes[to].put(msg)

    def receive(self, agent_id: str) -> List[str]:
        return self.mailboxes[agent_id].get_all()
```

每个 Agent 独立循环，通过消息协作。

### 为什么是 Queue 而非 Array

消息队列的关键特性是 **drain-on-read**：

```python
# ✗ 用 Array 存消息
mailbox = ["msg1", "msg2", "msg3"]
msgs = mailbox  # 读取
# 问题：消息还在，下次会重复读取

# ✓ 用 Queue 存消息
mailbox = Queue(["msg1", "msg2", "msg3"])
msgs = mailbox.drain()  # 读取并清空
# 下次读取返回空，不会重复处理
```

**关键：** 消息被读取后就消失，避免重复处理。

### 消息的生命周期

```
发送方                队列                接收方
  |                   |                   |
  | send("msg")       |                   |
  |------------------>|                   |
  |                   | [msg]             |
  |                   |                   |
  |                   |   receive()       |
  |                   |<------------------|
  |                   | drain & return    |
  |                   |------------------>|
  |                   | []                |
```

消息在队列中的停留时间取决于接收方的轮询频率。如果接收方每 2 秒轮询一次，消息延迟最多 2 秒。

## 为什么用消息而非共享状态

共享状态看起来方便，但会失控：

```python
# ✗ 共享状态
shared_state = {"current_file": "...", "status": "..."}
agent1.run(shared_state)  # 谁改了什么？
agent2.run(shared_state)  # 边界在哪？
```

**问题 1：竞态条件**

```python
# Agent1 和 Agent2 同时运行
Agent1: status = shared_state["status"]  # 读到 "idle"
Agent2: status = shared_state["status"]  # 读到 "idle"
Agent1: shared_state["status"] = "working"
Agent2: shared_state["status"] = "working"
# 两个 Agent 都认为自己在工作，实际冲突
```

**问题 2：隐式依赖**

```python
# Agent1 修改了 shared_state["current_file"]
# Agent2 不知道，继续用旧值
# 调试时无法追踪谁改了什么
```

消息模型清晰：

```python
# ✓ 消息通信
team.send("agent2", "请检查 config.ts")
# 每个 Agent 仍是独立循环
```

**关键优势：**

1. **无竞态**：消息是不可变的，发送后不会被修改
2. **可追踪**：所有通信都有明确的发送方和接收方
3. **易恢复**：消息可以持久化，崩溃后可以重放

### Actor Model 的本质

这就是 Actor Model：

```
Actor = 独立循环 + 消息队列 + 本地状态
```

每个 Agent 是一个 Actor：

```python
class Agent:
    def __init__(self, team, agent_id):
        self.team = team
        self.id = agent_id
        self.state = {}  # 本地状态，其他 Agent 看不到

    def run(self):
        while True:
            # 1. 读取消息
            msgs = self.team.receive(self.id)

            # 2. 更新本地状态
            self.state.update(process(msgs))

            # 3. 调用模型
            response = model(self.state)

            # 4. 发送消息
            if response.send_to:
                self.team.send(response.send_to, response.msg)
```

**关键：** 状态是本地的，通信是消息的。

## 身份和生命周期

团队成员需要持久化身份：

```typescript
interface TeamMember {
  id: string
  name: string
  role: string
  status: "idle" | "busy" | "shutdown"
}
```

系统才能知道：

- 这个成员是谁
- 它当前状态如何
- 它是否还能被调度

### 为什么需要持久化身份

对比一次性 Agent 和团队成员：

```python
# ✗ 一次性 Agent
def task1():
    agent = spawn_subagent("分析代码")
    result = agent.run()
    # agent 销毁，id 失效

def task2():
    agent = spawn_subagent("重构代码")
    # 新 agent，新 id，无法引用之前的结果

# ✓ 团队成员
team = Team()
researcher = team.add_member("researcher", role="code-analysis")
# researcher.id 持续有效

team.send("researcher", "分析 auth.ts")
# 等待...
team.send("researcher", "基于刚才的分析，重构")
# researcher 记得之前的上下文
```

**关键：** 持久化身份让 Agent 可以跨多轮任务保持上下文。

### 生命周期管理

```python
# 创建
agent = team.add_member("researcher")
# status = "idle"

# 分配任务
team.send("researcher", "分析代码")
# status = "busy"

# 完成任务
agent.finish_task()
# status = "idle"

# 关闭
team.shutdown("researcher")
# status = "shutdown"
```

状态机：

```
idle ──[收到消息]──> busy ──[完成任务]──> idle
  │                                        │
  └────────────[shutdown]──────────────────┘
                    ↓
                shutdown
```

## 实现要点

**1. 消息队列**

每个 Agent 有独立收件箱：

```python
mailboxes[agent_id] = Queue()
```

**2. 异步投递**

发送不阻塞：

```python
def send(to, msg):
    mailboxes[to].put(msg)
    # 立即返回
```

**3. 轮询接收**

Agent 在循环中检查消息：

```python
while True:
    msgs = team.receive(self.id)
    if msgs:
        messages.append(msgs)
    response = model(messages, tools)
```

### 为什么用 JSONL 而非数据库

消息持久化有两种选择：

```python
# ✗ 数据库
db.execute("INSERT INTO messages (to, from, content) VALUES (?, ?, ?)")
# 需要 schema、索引、事务

# ✓ JSONL（JSON Lines）
with open(f"mailbox/{agent_id}.jsonl", "a") as f:
    f.write(json.dumps(msg) + "\n")
# append-only，无需 schema
```

**JSONL 的优势：**

1. **Append-only**：只追加，不修改，天然支持并发写入
2. **无 schema**：消息格式可以演化，不需要迁移
3. **易调试**：直接 `cat mailbox/agent1.jsonl` 就能看到所有消息
4. **易恢复**：崩溃后重放 JSONL 即可恢复状态

**实际实现：**

```python
# 发送消息
def send(to: str, msg: dict):
    path = f"~/.codara/teams/{team_id}/mailbox/{to}.jsonl"
    with open(path, "a") as f:
        f.write(json.dumps({
            "from": self.id,
            "to": to,
            "content": msg,
            "timestamp": time.time()
        }) + "\n")

# 接收消息
def receive(agent_id: str) -> List[dict]:
    path = f"~/.codara/teams/{team_id}/mailbox/{agent_id}.jsonl"
    msgs = []
    with open(path, "r") as f:
        for line in f:
            msgs.append(json.loads(line))

    # drain-on-read：读取后清空
    os.remove(path)
    return msgs
```

**关键：** JSONL 是 append-only 的，读取后删除文件实现 drain-on-read。

### 延迟和吞吐量

消息延迟取决于轮询频率：

```python
# Agent 循环
while True:
    msgs = team.receive(self.id)  # 轮询
    # 处理消息...
    response = model(messages, tools)
    # 平均每轮 5 秒
```

**延迟分析：**

- 最坏情况：消息刚错过轮询，等待 5 秒
- 平均延迟：2.5 秒
- 最好情况：消息刚好在轮询前到达，0 秒

**吞吐量分析：**

假设团队有 3 个 Agent，每个 Agent 每轮 5 秒：

```
Agent1: [处理 5s] [处理 5s] [处理 5s] ...
Agent2: [处理 5s] [处理 5s] [处理 5s] ...
Agent3: [处理 5s] [处理 5s] [处理 5s] ...
```

并发吞吐量：3 个 Agent × (1 轮 / 5 秒) = 0.6 轮/秒

**关键：** 吞吐量随 Agent 数量线性增长，但单个 Agent 的延迟不变。

### 消息顺序保证

JSONL 的 append-only 特性保证了消息顺序：

```python
# Agent1 发送
send("agent2", "msg1")  # 写入第1行
send("agent2", "msg2")  # 写入第2行

# Agent2 接收
msgs = receive("agent2")
# msgs = ["msg1", "msg2"]，顺序保证
```

**但跨 Agent 的顺序不保证：**

```python
# Agent1 和 Agent3 同时发送给 Agent2
Agent1: send("agent2", "msg1")
Agent3: send("agent2", "msg3")

# Agent2 接收
msgs = receive("agent2")
# msgs 可能是 ["msg1", "msg3"] 或 ["msg3", "msg1"]
```

**关键：** 单个发送方的消息顺序保证，但多个发送方的消息顺序不保证。

## 和 s09 的关系

消息通道解决了通信，但还不够：

- 请求和响应怎么对应
- 审批和拒绝怎么表达
- 优雅关机怎么做

这就是 s09 的主题：**协作一复杂，消息之上就必须长出协议。**

### 从消息到协议

纯消息通信的问题：

```python
# Agent1 发送
team.send("agent2", "请分析 auth.ts")

# Agent2 回复
team.send("agent1", "分析完成")

# 问题：Agent1 怎么知道这条"分析完成"是回复哪个请求的？
```

如果有多个并发请求：

```python
team.send("agent2", "请分析 auth.ts")
team.send("agent2", "请分析 config.ts")

# Agent2 回复
team.send("agent1", "分析完成")
# 这是回复哪个请求？
```

**解决方案：** 消息需要携带 `request_id`：

```python
# Agent1 发送
team.send("agent2", {
    "type": "task_request",
    "request_id": "req-123",
    "content": "请分析 auth.ts"
})

# Agent2 回复
team.send("agent1", {
    "type": "task_response",
    "request_id": "req-123",  # 对应请求
    "content": "分析完成"
})
```

这就是协议的开始：**消息之上的结构化约定。**

### 性能边界

团队规模的限制：

```
3 个 Agent：可行
- 消息量：3×2 = 6 条/轮（每个 Agent 可能给其他 2 个发消息）
- 延迟：2.5 秒平均

10 个 Agent：开始吃力
- 消息量：10×9 = 90 条/轮
- 延迟：2.5 秒平均
- 问题：消息处理成本增加

100 个 Agent：不可行
- 消息量：100×99 = 9900 条/轮
- 延迟：消息队列会爆炸
```

**关键：** Agent Teams 适合小规模协作（3-10 个 Agent），不适合大规模并发。

## 三个关键点

**1. 消息队列是 drain-on-read 的**

读取后消息消失，避免重复处理。JSONL 的 append-only 特性天然支持这一点。

**2. Actor Model 保证了隔离性**

每个 Agent 有本地状态，通过消息通信，避免共享状态的竞态条件。

**3. 延迟和吞吐量的权衡**

- 延迟取决于轮询频率（平均 2.5 秒）
- 吞吐量随 Agent 数量线性增长
- 适合小规模协作，不适合大规模并发

---

**Agent Teams 的关键不是同时跑多个模型，而是让多个独立 Agent 具备稳定身份、持续生命周期和异步消息通道。消息队列的 drain-on-read 特性和 JSONL 的 append-only 特性是实现的基础。**
