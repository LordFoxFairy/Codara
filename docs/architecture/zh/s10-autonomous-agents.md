# s10: Autonomous Agents

`s00 > s01 > s02 > s03 > s04 > s05 > s06 > s07 > s08 > s09 > [ s10 ]`

> *"Idle Polling — 空闲轮询任务看板，自动认领 unclaimed"*
>
> **Harness 层**: 自治 — 模型自己找活干，无需指派。

## 问题

s08-s09 中，队友只在被明确指派时才动。领导得给每个队友写 prompt，任务看板上 10 个未认领的任务得手动分配。这扩展不了。

真正的自治：队友自己扫描任务看板，认领没人做的任务，做完再找下一个。

一个细节：上下文压缩（s02）后 Agent 可能忘了自己是谁。身份重注入解决这个问题。

## 解决方案

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
    | stop_reason != tool_use (or idle tool called)
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

Identity re-injection after compression:
  if len(messages) <= 3:
    messages.insert(0, identity_block)
```

## 工作原理

### 1. 队友循环分两个阶段：WORK 和 IDLE

LLM 停止调用工具（或调用了 `idle`）时，进入 IDLE：

```typescript
private async teammateLoop(name: string, role: string, prompt: string) {
  while (true) {
    // -- WORK PHASE --
    const messages = [{ role: "user", content: prompt }];
    for (let i = 0; i < 50; i++) {
      const response = await model.invoke({ messages, tools: TOOLS });
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason !== "tool_use") break;

      // 执行工具...
      if (idleRequested) break;
    }

    // -- IDLE PHASE --
    this.setStatus(name, "idle");
    const resume = await this.idlePoll(name, messages);
    if (!resume) {
      this.setStatus(name, "shutdown");
      return;
    }
    this.setStatus(name, "working");
  }
}
```

### 2. 空闲阶段循环轮询收件箱和任务看板

```typescript
private async idlePoll(name: string, messages: Message[]): Promise<boolean> {
  const IDLE_TIMEOUT = 60000; // 60s
  const POLL_INTERVAL = 5000; // 5s

  for (let i = 0; i < IDLE_TIMEOUT / POLL_INTERVAL; i++) {
    await sleep(POLL_INTERVAL);

    // 检查收件箱
    const inbox = BUS.readInbox(name);
    if (inbox.length > 0) {
      messages.push({
        role: "user",
        content: `<inbox>${JSON.stringify(inbox)}</inbox>`,
      });
      return true; // resume
    }

    // 扫描未认领任务
    const unclaimed = this.scanUnclaimedTasks();
    if (unclaimed.length > 0) {
      const task = unclaimed[0];
      TASKS.update(task.id, undefined, undefined, name); // claim
      messages.push({
        role: "user",
        content: `<auto-claimed>Task #${task.id}: ${task.subject}</auto-claimed>`,
      });
      return true; // resume
    }
  }

  return false; // timeout -> shutdown
}
```

### 3. 任务看板扫描：找 pending 状态、无 owner、未被阻塞的任务

```typescript
private scanUnclaimedTasks(): Task[] {
  const unclaimed: Task[] = [];
  const files = fs.readdirSync(TASKS_DIR);

  for (const file of files.sort()) {
    const task = JSON.parse(fs.readFileSync(`${TASKS_DIR}/${file}`, "utf-8"));
    if (
      task.status === "pending" &&
      !task.owner &&
      task.blockedBy.length === 0
    ) {
      unclaimed.push(task);
    }
  }

  return unclaimed;
}
```

### 4. 身份重注入：上下文过短（说明发生了压缩）时，在开头插入身份块

```typescript
if (messages.length <= 3) {
  messages.unshift(
    {
      role: "user",
      content: `<identity>You are '${name}', role: ${role}, team: ${teamName}. Continue your work.</identity>`,
    },
    {
      role: "assistant",
      content: `I am ${name}. Continuing.`,
    }
  );
}
```

## 变更内容

| 组件           | 之前 (s09)       | 之后 (s10)                       |
|----------------|------------------|----------------------------------|
| Tools          | 18               | 20 (+idle, +claim_task)          |
| 自治性         | 领导指派         | 自组织                           |
| 空闲阶段       | 无               | 轮询收件箱 + 任务看板            |
| 任务认领       | 仅手动           | 自动认领未分配任务               |
| 身份           | System Prompt    | + 压缩后重注入                   |
| 超时           | 无               | 60 秒空闲 -> 自动关机            |

## 关键洞察

- **Idle Polling 是自治的核心** — 不是被动等待，是主动扫描
- **任务看板是协调中心** — 队友通过看板发现工作，不需要领导分配
- **身份重注入防止失忆** — 压缩后 Agent 可能忘记自己是谁
- **超时自动关机** — 60 秒没活干，自动退出，释放资源

## 使用场景

### 自组织团队

```
1. 创建 5 个任务到看板
2. Spawn 3 个队友（不指派具体任务）
3. 队友自动扫描看板，认领任务
4. 做完一个，自动找下一个
5. 所有任务完成后，队友空闲 60 秒自动关机
```

### 动态负载均衡

```
- 任务多时：spawn 更多队友
- 任务少时：队友自动关机
- 无需手动管理队友生命周期
```

---

**不需要领导分配，自己找活干。空闲轮询 + 自动认领。**
