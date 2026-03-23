# s05: TodoWrite

`s00 > s01 > s02 > s03 > s04 > [ s05 ] s06 > s07 > s08 > s09 > s10`

> *"状态机 + Nag Reminder — 强制顺序聚焦，3 轮不更新就追问"*
>
> **Harness 层**: 规划 — 让模型不偏航，但不替它画航线。

## 问题

多步任务中，模型会丢失进度 — 重复做过的事、跳步、跑偏。对话越长越严重：工具结果不断填满上下文，System Prompt 的影响力逐渐被稀释。

一个 10 步重构可能做完 1-3 步就开始即兴发挥，因为 4-10 步已经被挤出注意力了。

## 解决方案

```
+--------+      +-------+      +---------+
|  User  | ---> |  LLM  | ---> | Tools   |
| prompt |      |       |      | + todo  |
+--------+      +---+---+      +----+----+
                    ^                |
                    |   tool_result  |
                    +----------------+
                          |
              +-----------+-----------+
              | TodoManager state     |
              | [ ] task A            |
              | [>] task B  <- doing  |
              | [x] task C            |
              +-----------------------+
                          |
              if rounds_since_todo >= 3:
                inject <reminder> into tool_result
```

## 工作原理

### 1. TodoManager 存储带状态的项目

同一时间只允许一个 `in_progress`：

```typescript
class TodoManager {
  private items: TodoItem[] = [];

  update(items: TodoItem[]): string {
    let inProgressCount = 0;
    const validated = [];

    for (const item of items) {
      const status = item.status || "pending";
      if (status === "in_progress") {
        inProgressCount++;
      }
      validated.push({
        id: item.id,
        text: item.text,
        status,
      });
    }

    if (inProgressCount > 1) {
      throw new Error("Only one task can be in_progress");
    }

    this.items = validated;
    return this.render();
  }

  render(): string {
    return this.items
      .map((item) => {
        const icon = {
          pending: "[ ]",
          in_progress: "[>]",
          completed: "[x]",
        }[item.status];
        return `${icon} ${item.text}`;
      })
      .join("\n");
  }
}
```

### 2. `todo` 工具和其他工具一样加入 dispatch map

```typescript
const TODO = new TodoManager();

const TOOL_HANDLERS = {
  // ...base tools...
  todo: (args: { items: TodoItem[] }) => TODO.update(args.items),
};
```

### 3. Nag Reminder：模型连续 3 轮以上不调用 `todo` 时注入提醒

```typescript
let roundsSinceTodo = 0;

async function agentLoop(query: string) {
  const messages = [{ role: "user", content: query }];

  while (true) {
    // 注入 nag reminder
    if (roundsSinceTodo >= 3 && messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === "user" && Array.isArray(last.content)) {
        last.content.unshift({
          type: "text",
          text: "<reminder>Update your todos.</reminder>",
        });
      }
    }

    const response = await model.invoke({ messages, tools: TOOLS });
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") return;

    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const output = TOOL_HANDLERS[block.name](block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });

        if (block.name === "todo") {
          roundsSinceTodo = 0;
        } else {
          roundsSinceTodo++;
        }
      }
    }
    messages.push({ role: "user", content: results });
  }
}
```

**"同时只能有一个 in_progress"** 强制顺序聚焦。
**Nag reminder** 制造问责压力 — 你不更新计划，系统就追着你问。

## 状态机

```
pending ──────> in_progress ──────> completed
   ^                                     |
   |                                     |
   +─────────────────────────────────────+
         (可以重新标记为 pending)
```

## 变更内容

| 组件           | 之前 (s04)       | 之后 (s05)                     |
|----------------|------------------|--------------------------------|
| Tools          | 5                | 6 (+todo)                      |
| 规划           | 无               | 带状态的 TodoManager           |
| Nag 注入       | 无               | 3 轮后注入 `<reminder>`        |
| Agent loop     | 简单分发         | + roundsSinceTodo 计数器       |

## 关键洞察

- **状态机强制顺序** — 同时只能有一个 in_progress，防止并行混乱
- **Nag 是主动干预** — 不是被动等待 Agent 想起来
- **Todo 是内存中的** — 会话结束就丢失，适合单次对话内的规划
- **Agent 仍然自主** — Harness 提醒，但不强制执行

---

**没有计划的 Agent 走哪算哪。TodoWrite 让模型不偏航。**
