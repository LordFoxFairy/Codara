# s07: Task System

`s00 > s01 > s02 > s03 > s04 > s05 > s06 > [ s07 ] s08 > s09 > s10`

> *"DAG + 磁盘持久化 — blockedBy 解锁，跨会话存活"*
>
> **Harness 层**: 持久化任务 — 比任何一次对话都长命的目标。

## 问题

s05 的 TodoManager 只是内存中的扁平清单：没有顺序、没有依赖、状态只有做完没做完。真实目标是有结构的 — 任务 B 依赖任务 A，任务 C 和 D 可以并行，任务 E 要等 C 和 D 都完成。

没有显式的关系，Agent 分不清什么能做、什么被卡住、什么能同时跑。而且清单只活在内存里，上下文压缩（s02）一跑就没了。

## 解决方案

把扁平清单升级为持久化到磁盘的**任务图（DAG）**。每个任务是一个 JSON 文件，有状态、前置依赖（`blockedBy`）和后置依赖（`blocks`）。

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

顺序:   task 1 必须先完成，才能开始 2 和 3
并行:   task 2 和 3 可以同时执行
依赖:   task 4 要等 2 和 3 都完成
状态:   pending -> in_progress -> completed
```

任务图随时回答三个问题：
- **什么可以做？** — 状态为 `pending` 且 `blockedBy` 为空的任务
- **什么被卡住？** — 等待前置任务完成的任务
- **什么做完了？** — 状态为 `completed` 的任务，完成时自动解锁后续任务

## 工作原理

### 1. TaskManager：每个任务一个 JSON 文件

```typescript
class TaskManager {
  constructor(private tasksDir: string) {
    fs.mkdirSync(tasksDir, { recursive: true });
  }

  create(subject: string, description = ""): string {
    const id = this.nextId();
    const task = {
      id,
      subject,
      description,
      status: "pending",
      blockedBy: [],
      blocks: [],
      owner: "",
    };
    this.save(task);
    return JSON.stringify(task, null, 2);
  }

  private save(task: Task) {
    const path = `${this.tasksDir}/task_${task.id}.json`;
    fs.writeFileSync(path, JSON.stringify(task, null, 2));
  }
}
```

### 2. 依赖解除：完成任务时，自动解锁后续任务

```typescript
update(taskId: number, status?: string, addBlockedBy?: number[]) {
  const task = this.load(taskId);

  if (status) {
    task.status = status;
    if (status === "completed") {
      this.clearDependency(taskId);
    }
  }

  if (addBlockedBy) {
    task.blockedBy.push(...addBlockedBy);
  }

  this.save(task);
  return JSON.stringify(task, null, 2);
}

private clearDependency(completedId: number) {
  const files = fs.readdirSync(this.tasksDir);
  for (const file of files) {
    const task = JSON.parse(fs.readFileSync(`${this.tasksDir}/${file}`, "utf-8"));
    if (task.blockedBy.includes(completedId)) {
      task.blockedBy = task.blockedBy.filter((id: number) => id !== completedId);
      this.save(task);
    }
  }
}
```

### 3. 四个任务工具加入 dispatch map

```typescript
const TASKS = new TaskManager(".tasks");

const TOOL_HANDLERS = {
  // ...base tools...
  task_create: (args: { subject: string; description?: string }) =>
    TASKS.create(args.subject, args.description),
  task_update: (args: { task_id: number; status?: string; add_blocked_by?: number[] }) =>
    TASKS.update(args.task_id, args.status, args.add_blocked_by),
  task_list: () => TASKS.listAll(),
  task_get: (args: { task_id: number }) => TASKS.get(args.task_id),
};
```

## 使用场景

### 顺序依赖

```typescript
task_create({ subject: "Setup project" });        // task 1
task_create({ subject: "Write code" });           // task 2
task_update({ task_id: 2, add_blocked_by: [1] }); // 2 依赖 1
```

### 并行 + 汇聚

```typescript
task_create({ subject: "Parse" });                // task 1
task_create({ subject: "Transform" });            // task 2
task_create({ subject: "Emit" });                 // task 3
task_create({ subject: "Test" });                 // task 4

task_update({ task_id: 2, add_blocked_by: [1] }); // 2 依赖 1
task_update({ task_id: 3, add_blocked_by: [1] }); // 3 依赖 1
task_update({ task_id: 4, add_blocked_by: [2, 3] }); // 4 依赖 2 和 3

// 1 完成后，2 和 3 可以并行
// 2 和 3 都完成后，4 才能开始
```

## 变更内容

| 组件 | 之前 (s06) | 之后 (s07) |
|---|---|---|
| Tools | 7 | 11 (+task_create/update/list/get) |
| 规划模型 | 扁平清单（仅内存） | 带依赖关系的任务图（磁盘） |
| 关系 | 无 | `blockedBy` + `blocks` 边 |
| 状态追踪 | 做完没做完 | `pending` -> `in_progress` -> `completed` |
| 持久化 | 压缩后丢失 | 压缩和重启后存活 |

## 关键洞察

- **DAG 是协调骨架** — 后续所有多 Agent 机制都读写这个结构
- **磁盘持久化是跨会话的前提** — 内存清单活不过一次对话
- **依赖自动解锁** — 完成任务时，系统自动解锁后续任务
- **状态机 + 图结构** — 状态控制进度，图结构控制顺序

---

**目标要活得比对话长。磁盘上的任务图，跨会话不丢失。**
