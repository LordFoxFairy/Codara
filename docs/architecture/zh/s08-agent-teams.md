# s08: Agent Teams

> *"持久化 Agent + JSONL 邮箱 — 异步消息，drain-on-read"*

## 问题

SubAgent（s06）是一次性的：生成、干活、返回摘要、消亡。没有身份，没有跨调用的记忆。

真正的团队协作需要三样东西：
1. 能跨多轮对话存活的**持久 Agent**
2. **身份和生命周期管理**
3. Agent 之间的**通信通道**

## 核心设计

```
Teammate lifecycle:
  spawn -> WORKING -> IDLE -> WORKING -> ... -> SHUTDOWN

Communication:
  .team/
    config.json           <- team roster + statuses
    inbox/
      alice.jsonl         <- append-only, drain-on-read
      bob.jsonl
      lead.jsonl
```

**关键机制：**
- **config.json** — 团队名册，谁在线、谁在干活
- **JSONL 邮箱** — 每个 Agent 一个文件，append-only

## 为什么用 JSONL？

### 问题：Agent 之间如何通信？

**方案 A：共享内存**
- 需要锁机制
- 并发冲突
- 状态难调试

**方案 B：消息队列（Redis/RabbitMQ）**
- 需要额外服务
- 部署复杂
- 过度工程

**方案 C：JSONL 文件**
- append-only，天然无锁
- 文件系统原生支持
- 可读可调试

## Drain-on-Read 模式

```python
def read_inbox(name):
    path = f".team/inbox/{name}.jsonl"

    # 读取所有消息
    messages = [json.loads(line) for line in open(path)]

    # 清空文件（drain）
    open(path, 'w').close()

    return messages
```

**为什么 drain？** 防止重复消费。读完即清空，简单可靠。

## 持久化 vs 一次性

| 特性 | SubAgent (s06) | Teammate (s08) |
|------|----------------|----------------|
| 生命周期 | 一次性 | 持久化 |
| 身份 | 无 | 有名字、角色 |
| 记忆 | 无 | 有 messages 历史 |
| 通信 | 返回摘要 | JSONL 邮箱 |
| 状态 | 无 | working/idle/shutdown |

## 伪代码

```python
class MessageBus:
    def send(sender, to, content):
        msg = {"from": sender, "content": content, "ts": now()}
        append(f".team/inbox/{to}.jsonl", json.dumps(msg))

    def read_inbox(name):
        msgs = read_all(f".team/inbox/{name}.jsonl")
        clear(f".team/inbox/{name}.jsonl")  # drain
        return msgs
```

7 行。append + drain。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| JSONL 邮箱 | 简单，无需额外服务 | 不支持优先级队列 |
| Drain-on-read | 防止重复消费 | 消息只能读一次 |
| 文件持久化 | 崩溃后可恢复 | 文件 I/O 开销 |
| 每个 Agent 独立循环 | 真正并行 | 资源占用高 |

## 关键洞察

- **JSONL 是最简单的消息队列** — append-only，天然持久化
- **drain-on-read 防止重复消费** — 读完即清空，简单可靠
- **每个队友是独立的 agent loop** — 不是共享状态，是独立推进
- **收件箱注入是上下文扩展** — 消息通过 messages 数组传递

---

**一个 Agent 干不完，就建团队。JSONL 邮箱，异步协作。**
