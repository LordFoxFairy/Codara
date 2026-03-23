# s10: Autonomous Agents

> *"Idle Polling — 空闲轮询任务看板，自动认领 unclaimed"*

## 问题

s08-s09 中，队友只在被明确指派时才动。领导得给每个队友写 prompt，任务看板上 10 个未认领的任务得手动分配。

这扩展不了。

真正的自治：队友自己扫描任务看板，认领没人做的任务，做完再找下一个。

## 核心设计

```
Teammate lifecycle with idle cycle:

+-------+
| spawn |
+---+---+
    |
    v
+-------+   tool_use     +-------+
| WORK  | <------------- |  LLM  |
+---+---+                +-------+
    |
    | stop_reason != tool_use
    v
+--------+
|  IDLE  |  poll every 5s for up to 60s
+---+----+
    |
    +---> check inbox --> message? ----------> WORK
    |
    +---> scan .tasks/ --> unclaimed? -------> claim -> WORK
    |
    +---> 60s timeout ----------------------> SHUTDOWN
```

**关键：** IDLE 阶段主动轮询，不是被动等待。

## 为什么需要 Idle Polling？

### 问题：被动等待

```
传统模式:
Lead: "alice, 做任务 1"
Alice: (做完)
Alice: (等待)  <- 被动
Lead: "alice, 做任务 2"
```

### 解决方案：主动扫描

```
自治模式:
Lead: (创建 10 个任务到看板)
Alice: (spawn)
Alice: (扫描看板，认领任务 1)
Alice: (做完)
Alice: (扫描看板，认领任务 2)
Alice: (做完)
...
Alice: (看板空了，60s 后自动关机)
```

## 任务看板扫描

什么任务可以认领？

```python
def scan_unclaimed_tasks():
    unclaimed = []
    for task in all_tasks:
        if (task.status == "pending" and
            not task.owner and
            len(task.blockedBy) == 0):
            unclaimed.append(task)
    return unclaimed
```

**三个条件：**
1. 状态为 `pending`
2. 无 owner（未被认领）
3. `blockedBy` 为空（不被阻塞）

## 身份重注入

为什么需要？

```
问题：上下文压缩后，Agent 可能忘记自己是谁

压缩前:
  System Prompt: "You are alice, role: coder"
  Messages: [100 条对话]

压缩后:
  Messages: [摘要]  <- 身份信息丢失
```

**解决方案：** 检测到压缩后，重新注入身份。

```python
if len(messages) <= 3:  # 说明发生了压缩
    messages.insert(0, {
        "role": "user",
        "content": f"<identity>You are '{name}', role: {role}</identity>"
    })
```

## 伪代码

```python
def idle_poll(name):
    for i in range(12):  # 60s / 5s = 12
        sleep(5)

        if BUS.read_inbox(name):
            return True  # resume

        unclaimed = scan_unclaimed_tasks()
        if unclaimed:
            TASKS.claim(unclaimed[0].id, name)
            return True  # resume

    return False  # timeout -> shutdown
```

7 行。轮询 + 超时。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| Idle Polling | 自组织，无需指派 | 轮询开销 |
| 5s 间隔 | 响应及时 | 频繁检查 |
| 60s 超时 | 自动释放资源 | 可能过早关机 |
| 身份重注入 | 防止失忆 | 增加 tokens |

## 关键洞察

- **Idle Polling 是自治的核心** — 不是被动等待，是主动扫描
- **任务看板是协调中心** — 队友通过看板发现工作，不需要领导分配
- **身份重注入防止失忆** — 压缩后 Agent 可能忘记自己是谁
- **超时自动关机** — 60 秒没活干，自动退出，释放资源

---

**不需要领导分配，自己找活干。空闲轮询 + 自动认领。**
