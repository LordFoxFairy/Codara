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

## 为什么用消息而非共享状态

共享状态看起来方便，但会失控：

```python
# ✗ 共享状态
shared_state = {"current_file": "...", "status": "..."}
agent1.run(shared_state)  # 谁改了什么？
agent2.run(shared_state)  # 边界在哪？
```

消息模型清晰：

```python
# ✓ 消息通信
team.send("agent2", "请检查 config.ts")
# 每个 Agent 仍是独立循环
```

**关键优势：边界清晰，易于排错和恢复。**

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

## 和 s09 的关系

消息通道解决了通信，但还不够：

- 请求和响应怎么对应
- 审批和拒绝怎么表达
- 优雅关机怎么做

这就是 s09 的主题：**协作一复杂，消息之上就必须长出协议。**

---

**Agent Teams 的关键不是同时跑多个模型，而是让多个独立 Agent 具备稳定身份、持续生命周期和异步消息通道。**
