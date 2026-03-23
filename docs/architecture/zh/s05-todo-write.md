# s05: TodoWrite

> *"状态机 + Nag Reminder — 强制顺序聚焦，3 轮不更新就追问"*

## 问题

多步任务中，模型会丢失进度 — 重复做过的事、跳步、跑偏。

对话越长越严重：工具结果不断填满上下文，System Prompt 的影响力逐渐被稀释。一个 10 步重构可能做完 1-3 步就开始即兴发挥。

## 核心设计

```
TodoManager State:
[ ] task A
[>] task B  <- 同时只能有一个 in_progress
[x] task C

Nag Reminder:
if rounds_since_todo >= 3:
    inject "<reminder>Update your todos.</reminder>"
```

**两个机制：**
1. **状态机** — 强制顺序聚焦
2. **Nag Reminder** — 主动干预

## 为什么需要 TodoWrite？

### 问题：上下文稀释

```
Turn 1: System Prompt 影响力 100%
Turn 5: System Prompt 影响力 60%  (被工具结果挤压)
Turn 10: System Prompt 影响力 30% (模型开始偏航)
```

### 解决方案：持续注入

TodoWrite 通过 Nag Reminder 持续注入计划，对抗上下文稀释。

## 状态机设计

```
pending ──────> in_progress ──────> completed
   ^                                     |
   |                                     |
   +─────────────────────────────────────+
         (可以重新标记为 pending)
```

**关键约束：** 同时只能有一个 `in_progress`

为什么？因为并行会导致混乱。模型需要知道"现在做什么"，不是"可以做什么"。

## Nag Reminder 机制

```python
rounds_since_todo = 0

for turn in loop:
    if rounds_since_todo >= 3:
        inject_reminder()

    if tool_called == "todo":
        rounds_since_todo = 0
    else:
        rounds_since_todo += 1
```

**为什么 3 轮？** 经验值。太短会打断思考，太长会失去效果。

## 伪代码

```python
class TodoManager:
    def update(items):
        in_progress = [i for i in items if i.status == "in_progress"]
        if len(in_progress) > 1:
            raise Error("Only one task can be in_progress")
        return render(items)

TOOLS["todo"] = lambda items: TodoManager.update(items)
```

7 行。状态机 + 约束检查。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| 状态机 | 强制顺序，防止并行混乱 | 限制了灵活性 |
| 单 in_progress | 聚焦当前任务 | 不能真正并行 |
| Nag Reminder | 主动干预，对抗稀释 | 可能打断思考 |
| 3 轮阈值 | 平衡干预和自由 | 经验值，非科学 |

## 关键洞察

- **状态机强制顺序** — 同时只能有一个 in_progress，防止并行混乱
- **Nag 是主动干预** — 不是被动等待 Agent 想起来
- **Todo 是内存中的** — 会话结束就丢失，适合单次对话内的规划
- **对抗上下文稀释** — 持续注入计划，保持 Agent 不偏航

---

**没有计划的 Agent 走哪算哪。TodoWrite 让模型不偏航。**
