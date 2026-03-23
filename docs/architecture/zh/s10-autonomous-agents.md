# 第11章：Autonomous Agents — 带边界的自运转

## 从被动到主动

前面十章，agent 都是被动的：

- 收到消息 → 处理 → 回复
- 分配任务 → 执行 → 完成
- 有工作就干，没工作就等

这在小规模场景够用，但扩展性差。

真正的自治是：**agent 能自己找活干。**

## 自治的三个核心能力

**1. 空闲时观察**

```typescript
while (true) {
  const tasks = await taskList.getPending()
  const unassigned = tasks.filter(t => !t.owner && !t.blockedBy.length)

  if (unassigned.length > 0) {
    await claimTask(unassigned[0])
  }
}
```

不是等指令，而是主动看任务看板。

**2. 发现工作后认领**

```typescript
async function claimTask(task: Task) {
  await taskUpdate(task.id, {
    owner: agentName,
    status: "in_progress"
  })
  await executeTask(task)
}
```

看到合适的任务，直接认领并开始执行。

**3. 长时间空闲后退出**

```typescript
if (idleTime > MAX_IDLE_TIME) {
  await sendMessage("team-lead", "No work available, shutting down")
  process.exit(0)
}
```

自治不等于永远挂着。资源有限，空闲就退出。

## 为什么需要控制面

没有约束的自治只是放飞：

- 任务从哪来？→ 任务看板
- 谁能认领？→ 权限规则
- 状态怎么变？→ 状态机
- 冲突怎么办？→ 协调协议

**自治是把调度逻辑下放给 agent，但系统级约束仍然存在。**

## 关键设计决策

**为什么用轮询而不是推送？**

```typescript
// 轮询：agent 主动查
while (true) {
  const tasks = await checkTasks()
  await sleep(5000)
}

// 推送：系统通知 agent
// 需要额外的消息队列、订阅机制
```

轮询简单，推送复杂。小规模场景轮询够用。

**为什么需要空闲超时？**

agent 不是服务，是任务执行器。没任务就该退出，需要时再启动。

**为什么任务认领要原子化？**

```typescript
// ✗ 坏：先查后改，有竞态
const task = await getTask(id)
if (!task.owner) {
  await updateTask(id, { owner: "me" })
}

// ✓ 好：CAS 操作
await updateTask(id, {
  owner: "me",
  expectedOwner: null  // 只在无主时更新
})
```

多个 agent 可能同时认领同一任务。

## 如果没有这一层

团队系统会停在半自动状态：

- 协作能做，但调度成本高
- 每件事都要人工分发
- 空闲成员无法主动接活
- 扩展性遇到天花板

---

**自治不是让 agent 随便跑，而是在任务看板、状态机和协议约束下，能够主动观察、认领工作并优雅退出。**
