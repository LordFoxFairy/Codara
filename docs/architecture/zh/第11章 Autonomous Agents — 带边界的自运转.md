# 第11章：Autonomous Agents — 带边界的自运转

## 从被动到主动

前面十章，agent 都是被动的：

- 收到消息 → 处理 → 回复
- 分配任务 → 执行 → 完成
- 有工作就干，没工作就等

这在小规模场景够用，但扩展性差。想象一个 10 人团队，leader 要手动给每个成员分配任务，成员完成后等待下一次分配。这种中心化调度在人类团队中已经是瓶颈，在 agent 系统中更是灾难。

真正的自治是：**agent 能自己找活干。**

就像操作系统的进程调度器：进程不是等 CPU 主动分配时间片，而是自己进入就绪队列，调度器只负责选择和切换。

## 自治的三个核心能力

**1. 空闲时观察**

```typescript
while (true) {
  const tasks = await taskList.getPending()
  const unassigned = tasks.filter(t => !t.owner && !t.blockedBy.length)

  if (unassigned.length > 0) {
    await claimTask(unassigned[0])
  }

  await sleep(POLL_INTERVAL)
}
```

不是等指令，而是主动看任务看板。

但 `POLL_INTERVAL` 该设多少？这是个经典的延迟 vs 成本权衡：

```typescript
// 轮询间隔 100ms
// - 延迟：任务发布后 100ms 内被认领
// - 成本：每小时 36,000 次查询
const AGGRESSIVE = 100

// 轮询间隔 5s
// - 延迟：任务发布后 5s 内被认领
// - 成本：每小时 720 次查询
const BALANCED = 5000

// 轮询间隔 30s
// - 延迟：任务发布后 30s 内被认领
// - 成本：每小时 120 次查询
const CONSERVATIVE = 30000
```

**关键：** 对于 LLM agent，每次推理成本是 $0.01-0.1，轮询间隔太短会让空转成本超过实际工作成本。

实际选择取决于场景：

- **交互式场景**（用户等待）：1-2s，延迟敏感
- **批处理场景**（夜间构建）：30-60s，成本敏感
- **混合场景**（团队协作）：5-10s，平衡点

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

但这里有个隐藏的竞态条件：如果两个 agent 同时看到同一个任务，都会尝试认领。这就需要原子化操作，后面会详细讲。

**3. 长时间空闲后退出**

```typescript
const MAX_IDLE_TIME = 5 * 60 * 1000  // 5 分钟

if (idleTime > MAX_IDLE_TIME) {
  await sendMessage("team-lead", "No work available, shutting down")
  process.exit(0)
}
```

自治不等于永远挂着。资源有限，空闲就退出。

为什么是 5 分钟？这是基于 Claude API 的 Prompt Caching 机制：

```
Prompt Cache 有效期：5 分钟
Agent 空闲超时：5 分钟

如果 agent 在 5 分钟内重启，System Prompt 的 KV Cache 还在，
重启成本只是一次 API 调用（~$0.01）。

如果超过 5 分钟，缓存失效，重启成本是完整的 System Prompt 计算（~$0.05）。
```

所以 5 分钟是个甜蜜点：既不会让 agent 无限挂着浪费资源，也不会让缓存失效导致重启成本过高。

## 为什么需要控制面

没有约束的自治只是放飞：

- 任务从哪来？→ 任务看板
- 谁能认领？→ 权限规则
- 状态怎么变？→ 状态机
- 冲突怎么办？→ 协调协议

**自治是把调度逻辑下放给 agent，但系统级约束仍然存在。**

这和操作系统的设计哲学一致：

```
用户态进程：自主调度，抢占式执行
内核态：资源管理，权限控制，冲突仲裁

Agent 自治：主动认领，并发执行
控制面：任务看板，状态机，原子操作
```

进程不能直接访问硬件，必须通过系统调用。Agent 不能直接修改任务状态，必须通过原子化的 API。这不是限制自由，而是保证系统的正确性。

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

轮询简单，推送复杂。但这不是偷懒，而是基于实际成本分析：

**推送方案的隐藏成本：**

```typescript
// 需要维护订阅关系
const subscriptions = new Map<AgentId, WebSocket>()

// 需要处理连接断开
ws.on('close', () => {
  subscriptions.delete(agentId)
  // 任务怎么办？重新分配？
})

// 需要处理消息丢失
// 如果 agent 在推送时正在处理其他任务，消息可能丢失
// 需要 ACK 机制、重试队列、死信队列...
```

**轮询方案的优势：**

```typescript
// 无状态：不需要维护连接
// 幂等：重复查询不会有副作用
// 简单：agent 挂了就挂了，重启后继续轮询
```

对于 LLM agent，每次推理成本是 $0.01-0.1，轮询的网络成本（~$0.0001）可以忽略不计。

**何时需要推送？**

当 agent 数量 > 100，且任务频率 > 10/s 时，轮询的总成本才会超过推送的基础设施成本。在此之前，轮询是更优解。

**为什么需要空闲超时？**

agent 不是服务，是任务执行器。没任务就该退出，需要时再启动。

这和操作系统的进程管理类似：

```
短期进程（agent）：
- 按需启动，完成任务后退出
- 启动成本低（5 分钟内缓存有效）
- 资源占用小（只在工作时消耗）

长期服务（daemon）：
- 持续运行，等待请求
- 启动成本高（需要预热、加载状态）
- 资源占用大（即使空闲也占用内存）
```

LLM agent 的特点是：

- **启动成本低**：如果 Prompt Cache 有效（5 分钟内），重启只需 1 次 API 调用
- **运行成本高**：每次推理 $0.01-0.1，空转 1 小时可能花费 $5-10
- **无状态**：任务状态在外部存储，agent 重启不丢失信息

所以正确的策略是：**有活就干，没活就退，需要时再启动。**

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

多个 agent 可能同时认领同一任务。这是经典的 Check-Then-Act 竞态条件：

```
时间线：
T0: Agent A 查询 task-1，发现 owner = null
T1: Agent B 查询 task-1，发现 owner = null
T2: Agent A 更新 task-1，设置 owner = "A"
T3: Agent B 更新 task-1，设置 owner = "B"  // 覆盖了 A！
T4: Agent A 和 B 都认为自己拥有 task-1，开始执行
T5: 两个 agent 同时修改同一文件，产生冲突
```

**CAS（Compare-And-Swap）如何解决：**

```typescript
// 文件系统实现（基于文件锁）
async function claimTask(taskId: string, agentName: string): Promise<boolean> {
  const lockFile = `${taskDir}/${taskId}.lock`

  try {
    // O_CREAT | O_EXCL：只在文件不存在时创建
    // 这是原子操作，由操作系统保证
    await fs.open(lockFile, 'wx')

    // 成功创建锁文件，说明认领成功
    await updateTask(taskId, { owner: agentName })
    return true
  } catch (err) {
    if (err.code === 'EEXIST') {
      // 锁文件已存在，说明被其他 agent 认领了
      return false
    }
    throw err
  }
}
```

**数据库实现（基于乐观锁）：**

```sql
-- 使用版本号实现 CAS
UPDATE tasks
SET owner = 'agent-A', version = version + 1
WHERE id = 'task-1'
  AND owner IS NULL
  AND version = 5;  -- 只在版本号匹配时更新

-- 如果返回 affected_rows = 0，说明认领失败
-- 可能是 owner 已被占用，或版本号已变化
```

**为什么不用分布式锁？**

```typescript
// Redis 分布式锁
const lock = await redis.set('task-1', 'agent-A', 'NX', 'EX', 30)
if (!lock) {
  // 认领失败
}
```

分布式锁可以工作，但引入了额外的依赖和复杂度：

- 需要 Redis/etcd 等外部服务
- 需要处理锁超时、续期、死锁
- 需要处理网络分区

对于文件系统任务看板，文件锁已经足够。对于数据库任务看板，乐观锁已经足够。**不要为了用分布式锁而用分布式锁。**

## 如果没有这一层

团队系统会停在半自动状态：

- 协作能做，但调度成本高
- 每件事都要人工分发
- 空闲成员无法主动接活
- 扩展性遇到天花板

具体来说：

**没有自治的团队（中心化调度）：**

```
Leader 的工作量 = O(n × m)
n = agent 数量
m = 任务数量

10 个 agent，100 个任务 = 1000 次调度操作
每次调度需要 1 次 LLM 推理（$0.01）
总成本：$10
```

**有自治的团队（去中心化调度）：**

```
Leader 的工作量 = O(m)  // 只需要创建任务
Agent 的工作量 = O(轮询次数)

10 个 agent，100 个任务：
- Leader 创建 100 个任务：100 次操作
- Agent 轮询认领：假设每个任务平均被轮询 3 次才被认领
  10 个 agent × 5s 轮询间隔 × 平均 15s 任务完成时间 = 30 次轮询
  轮询成本：30 × $0.0001 = $0.003
总成本：$1 + $0.003 ≈ $1

成本降低 10 倍。
```

更重要的是，自治让系统可以水平扩展：

```
中心化调度：
- 10 个 agent → Leader 处理 10 个调度
- 100 个 agent → Leader 处理 100 个调度（瓶颈）

去中心化调度：
- 10 个 agent → 各自轮询，无瓶颈
- 100 个 agent → 各自轮询，无瓶颈
```

## 与操作系统调度器的类比

自治 agent 系统和操作系统的进程调度器有惊人的相似性：

| 概念 | 操作系统 | Agent 系统 |
|------|----------|------------|
| 执行单元 | 进程/线程 | Agent |
| 任务队列 | 就绪队列 | 任务看板 |
| 调度策略 | 优先级、时间片 | 任务优先级、依赖关系 |
| 状态转换 | 就绪→运行→阻塞 | pending→in_progress→completed |
| 资源竞争 | 互斥锁、信号量 | CAS 操作、文件锁 |
| 空闲处理 | 进程休眠、唤醒 | Agent 退出、重启 |

**关键区别：**

```
操作系统调度器：
- 调度延迟：微秒级（1-100μs）
- 上下文切换成本：纳秒级（100-1000ns）
- 进程数量：数千个
- 调度频率：每秒数百万次

Agent 调度器：
- 调度延迟：秒级（1-10s）
- 上下文切换成本：秒级（1-5s，如果缓存有效）
- Agent 数量：数十个
- 调度频率：每秒数次
```

所以 agent 系统可以用更简单的机制（轮询、文件锁），而不需要操作系统级别的复杂度（中断、信号、内核态切换）。

---

**自治不是让 agent 随便跑，而是在任务看板、状态机和协议约束下，能够主动观察、认领工作并优雅退出。这是从中心化调度到去中心化调度的关键一步，让系统可以水平扩展到数十个 agent。**
