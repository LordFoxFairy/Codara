# s07: Task System

> *"DAG + 磁盘持久化 — blockedBy 解锁，跨会话存活"*

## 问题

s05 的 TodoManager 只是内存中的扁平清单：没有顺序、没有依赖、状态只有做完没做完。

真实目标是有结构的 — 任务 B 依赖任务 A，任务 C 和 D 可以并行，任务 E 要等 C 和 D 都完成。

而且清单只活在内存里，上下文压缩（s02）一跑就没了。

## 核心设计

```
.tasks/
  task_1.json  {"id":1, "status":"completed"}
  task_2.json  {"id":2, "blockedBy":[1], "status":"pending"}
  task_3.json  {"id":3, "blockedBy":[1], "status":"pending"}
  task_4.json  {"id":4, "blockedBy":[2,3], "status":"pending"}

任务图 (DAG):
                 +----------+
            +--> | task 2   | --+
            |    | pending  |   |
+----------+     +----------+    +--> +----------+
| task 1   |                          | task 4   |
| completed| --> +----------+    +--> | blocked  |
+----------+     | task 3   | --+     +----------+
                 | pending  |
                 +----------+
```

**任务图随时回答三个问题：**
- **什么可以做？** — 状态为 `pending` 且 `blockedBy` 为空
- **什么被卡住？** — 等待前置任务完成
- **什么做完了？** — 状态为 `completed`，自动解锁后续

## 为什么需要 DAG？

### 问题：扁平清单无法表达依赖

```
TodoManager:
[ ] Setup project
[ ] Write code
[ ] Write tests

问题：
- "Write code" 能在 "Setup project" 之前做吗？
- "Write tests" 能和 "Write code" 并行吗？
```

### 解决方案：显式依赖图

```
Task System:
task 1: Setup project (pending)
task 2: Write code (blocked by 1)
task 3: Write tests (blocked by 1)
task 4: Deploy (blocked by 2, 3)

清晰表达：
- 1 完成后，2 和 3 可以并行
- 2 和 3 都完成后，4 才能开始
```

## 依赖自动解锁

```python
def complete_task(task_id):
    task.status = "completed"

    # 自动解锁后续任务
    for other_task in all_tasks:
        if task_id in other_task.blockedBy:
            other_task.blockedBy.remove(task_id)
```

**关键：** 完成任务时，系统自动解锁后续任务，不需要手动管理。

## 磁盘持久化

为什么要持久化到磁盘？

```
内存清单:
- 上下文压缩后丢失
- 会话结束后丢失
- 崩溃后丢失

磁盘任务图:
- 压缩后存活
- 跨会话存活
- 崩溃后可恢复
```

## 伪代码

```python
class TaskManager:
    def create(subject):
        task = {"id": next_id(), "subject": subject,
                "status": "pending", "blockedBy": []}
        save_to_disk(task)

    def complete(task_id):
        task.status = "completed"
        clear_dependency(task_id)  # 自动解锁
```

7 行。DAG + 持久化 + 自动解锁。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| DAG 结构 | 显式依赖，支持并行 | 复杂度增加 |
| 磁盘持久化 | 跨会话存活，可恢复 | 文件 I/O 开销 |
| 自动解锁 | 无需手动管理依赖 | 可能意外解锁 |
| 每个任务一个文件 | 原子写入，易调试 | 文件数量多 |

## 关键洞察

- **DAG 是协调骨架** — 后续所有多 Agent 机制都读写这个结构
- **磁盘持久化是跨会话的前提** — 内存清单活不过一次对话
- **依赖自动解锁** — 完成任务时，系统自动解锁后续任务
- **状态机 + 图结构** — 状态控制进度，图结构控制顺序

---

**目标要活得比对话长。磁盘上的任务图，跨会话不丢失。**
