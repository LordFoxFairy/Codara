# 第8章：Task System — 任务活得比会话更久

## 从临时委托到持久化任务

s06 说了：可以把工作交给子 Agent。

但那只是"临时委托"，会话结束，任务就消失了。

真正的任务系统关心的不是某一轮对话里做了什么，而是：

- 还有什么没做
- 哪些任务相互依赖
- 哪些已经完成
- 系统中断以后如何继续

## 任务必须持久化

一旦任务比一次对话更长，内存就不再可靠。

```typescript
// ✗ 坏：任务只在内存里
const tasks = [
  { id: 1, title: "实现功能 A", status: "pending" }
]

// ✓ 好：任务写入磁盘
await fs.writeFile(
  `~/.codara/tasks/${taskId}.json`,
  JSON.stringify(task)
)
```

一旦任务进入磁盘，系统才第一次真正拥有了：

- 跨会话延续能力
- 崩溃后恢复能力
- 多 Agent 共享的稳定真相

## 核心数据结构

任务不是清单，是图：

```typescript
interface Task {
  id: string
  subject: string
  status: "pending" | "in_progress" | "completed"
  owner?: string           // 哪个 Agent 在做
  blockedBy: string[]      // 依赖哪些任务
  blocks: string[]         // 阻塞哪些任务
}
```

关键点：

**1. 依赖关系是双向的**

```typescript
// 任务 2 依赖任务 1
task2.blockedBy = ["task-1"]
task1.blocks = ["task-2"]
```

双向存储让查询更快：

- 查"我能做什么" → 找 `blockedBy` 为空的
- 查"完成后解锁什么" → 看 `blocks` 列表

**2. Owner 决定谁在做**

```typescript
// 分配任务
await updateTask(taskId, { owner: "agent-123" })

// Agent 查询自己的任务
const myTasks = tasks.filter(t => t.owner === agentId)
```

**3. Status 驱动状态机**

```
pending → in_progress → completed
```

不需要复杂状态，三个就够。

## 为什么不用 Todo

Todo 解决的是单次执行里的顺序和焦点。
Task System 解决的是跨轮次、跨会话、跨 Agent 的任务存在。

Todo 更像白板。
Task 更像控制面。

一旦任务开始涉及依赖关系，简单清单就不够了。

## 关键决策

**任务是系统对象，不是对话副产品。**

一旦接受这个判断，后面的设计就会自然清楚：

- 任务有自己的状态
- 任务有自己的依赖关系
- 任务有自己的生命周期
- Agent 只是任务的执行者之一，不是任务本身

---

**Task System 把任务从会话内临时计划升级成持久化控制面，让依赖、状态、恢复和协作都有稳定真相来源。**
