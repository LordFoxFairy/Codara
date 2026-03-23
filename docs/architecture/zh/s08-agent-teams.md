# s08: Agent Teams

`s00 > s01 > s02 > s03 > s04 > s05 > s06 > s07 > [ s08 ] s09 > s10`

> *"持久化 Agent + JSONL 邮箱 — 异步消息，drain-on-read"*
>
> **Harness 层**: 团队邮箱 — 多个模型，通过文件协调。

## 问题

SubAgent（s06）是一次性的：生成、干活、返回摘要、消亡。没有身份，没有跨调用的记忆。

真正的团队协作需要三样东西：
1. 能跨多轮对话存活的**持久 Agent**
2. **身份和生命周期管理**
3. Agent 之间的**通信通道**

## 解决方案

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

          +--------+    send("alice","bob","...")    +--------+
          | alice  | -----------------------------> |  bob   |
          | loop   |    bob.jsonl << {json_line}    |  loop  |
          +--------+                                +--------+
               ^                                         |
               |        BUS.readInbox("alice")           |
               +---- alice.jsonl -> read + drain ---------+
```

## 工作原理

### 1. TeammateManager 通过 config.json 维护团队名册

```typescript
class TeammateManager {
  private config: TeamConfig;
  private threads: Map<string, Thread> = new Map();

  constructor(private teamDir: string) {
    fs.mkdirSync(teamDir, { recursive: true });
    this.config = this.loadConfig();
  }

  spawn(name: string, role: string, prompt: string): string {
    const member = { name, role, status: "working" };
    this.config.members.push(member);
    this.saveConfig();

    const thread = new Thread(() => this.teammateLoop(name, role, prompt));
    thread.start();
    this.threads.set(name, thread);

    return `Spawned teammate '${name}' (role: ${role})`;
  }
}
```

### 2. MessageBus：append-only 的 JSONL 收件箱

`send()` 追加一行；`readInbox()` 读取全部并清空（drain-on-read）：

```typescript
class MessageBus {
  constructor(private dir: string) {
    fs.mkdirSync(`${dir}/inbox`, { recursive: true });
  }

  send(sender: string, to: string, content: string, type = "message") {
    const msg = {
      type,
      from: sender,
      content,
      timestamp: Date.now(),
    };
    fs.appendFileSync(
      `${this.dir}/inbox/${to}.jsonl`,
      JSON.stringify(msg) + "\n"
    );
  }

  readInbox(name: string): Message[] {
    const path = `${this.dir}/inbox/${name}.jsonl`;
    if (!fs.existsSync(path)) return [];

    const msgs = fs
      .readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    fs.writeFileSync(path, ""); // drain
    return msgs;
  }
}
```

### 3. 每个队友在每次 LLM 调用前检查收件箱

```typescript
private async teammateLoop(name: string, role: string, prompt: string) {
  const messages = [{ role: "user", content: prompt }];

  for (let i = 0; i < 50; i++) {
    // 检查收件箱，注入上下文
    const inbox = BUS.readInbox(name);
    if (inbox.length > 0) {
      messages.push({
        role: "user",
        content: `<inbox>${JSON.stringify(inbox)}</inbox>`,
      });
      messages.push({
        role: "assistant",
        content: "Noted inbox messages.",
      });
    }

    const response = await model.invoke({ messages, tools: TOOLS });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") break;

    // 执行工具...
  }

  this.setStatus(name, "idle");
}
```

### 4. 三个团队工具加入 dispatch map

```typescript
const TOOL_HANDLERS = {
  // ...base tools...
  spawn: (args: { name: string; role: string; prompt: string }) =>
    TEAM.spawn(args.name, args.role, args.prompt),
  send: (args: { to: string; content: string }) =>
    BUS.send("lead", args.to, args.content),
  read_inbox: () =>
    JSON.stringify(BUS.readInbox("lead")),
};
```

## 变更内容

| 组件           | 之前 (s07)       | 之后 (s08)                         |
|----------------|------------------|------------------------------------|
| Tools          | 11               | 14 (+spawn/send/read_inbox)        |
| Agent 数量     | 单一             | 领导 + N 个队友                    |
| 持久化         | 无               | config.json + JSONL 收件箱         |
| 线程           | 无               | 每线程完整 agent loop              |
| 生命周期       | 一次性           | idle -> working -> idle            |
| 通信           | 无               | message + broadcast                |

## 关键洞察

- **JSONL 是最简单的消息队列** — append-only，天然持久化，无需数据库
- **drain-on-read 防止重复消费** — 读完即清空，简单可靠
- **每个队友是独立的 agent loop** — 不是共享状态，是独立推进
- **收件箱注入是上下文扩展** — 消息通过 messages 数组传递，不是共享内存

---

**一个 Agent 干不完，就建团队。JSONL 邮箱，异步协作。**
