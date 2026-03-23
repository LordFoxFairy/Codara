# s06: SubAgent

`s00 > s01 > s02 > s03 > s04 > s05 > [ s06 ] s07 > s08 > s09 > s10`

> *"上下文隔离 — 子 Agent 独立 messages[]，只返回摘要"*
>
> **Harness 层**: 上下文隔离 — 守护模型的思维清晰度。

## 问题

Agent 工作越久，messages 数组越胖。每次读文件、跑命令的输出都永久留在上下文里。

"这个项目用什么测试框架？" 可能要读 5 个文件，但父 Agent 只需要一个词："pytest"。

## 解决方案

```
Parent Agent                     SubAgent
+------------------+             +------------------+
| messages=[...]   |             | messages=[]      | <-- fresh
|                  |  dispatch   |                  |
| tool: task       | ----------> | while tool_use:  |
|   prompt="..."   |             |   call tools     |
|                  |  summary    |   append results |
|   result = "..." | <---------- | return last text |
+------------------+             +------------------+

父上下文保持干净。子上下文被丢弃。
```

## 工作原理

### 1. 父 Agent 有一个 `task` 工具

子 Agent 拥有除 `task` 外的所有基础工具（禁止递归生成）。

```typescript
const PARENT_TOOLS = [
  ...CHILD_TOOLS,
  {
    name: "task",
    description: "Spawn a subagent with fresh context.",
    input_schema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Task for subagent" },
      },
      required: ["prompt"],
    },
  },
];
```

### 2. 子 Agent 以 `messages=[]` 启动，运行自己的循环

只有最终文本返回给父 Agent：

```typescript
async function runSubagent(prompt: string): Promise<string> {
  const subMessages = [{ role: "user", content: prompt }];

  for (let i = 0; i < 30; i++) {
    // safety limit
    const response = await model.invoke({
      system: SUBAGENT_SYSTEM,
      messages: subMessages,
      tools: CHILD_TOOLS,
      max_tokens: 8000,
    });

    subMessages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      break;
    }

    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const handler = TOOL_HANDLERS[block.name];
        const output = handler(block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: String(output).slice(0, 50000),
        });
      }
    }
    subMessages.push({ role: "user", content: results });
  }

  // 只返回最后的文本
  const lastResponse = subMessages[subMessages.length - 1];
  return lastResponse.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n") || "(no summary)";
}
```

子 Agent 可能跑了 30+ 次工具调用，但整个消息历史直接丢弃。父 Agent 收到的只是一段摘要文本，作为普通 `tool_result` 返回。

### 3. 父 Agent 调用 `task` 工具

```typescript
const TOOL_HANDLERS = {
  // ...base tools...
  task: (args: { prompt: string }) => runSubagent(args.prompt),
};
```

## 使用场景

### 信息收集

```
Parent: "Use a subtask to find what testing framework this project uses"
SubAgent:
  - read_file("package.json")
  - read_file("pytest.ini")
  - read_file("tests/conftest.py")
  - return "pytest"
Parent receives: "pytest"
```

### 独立验证

```
Parent: "Delegate: verify all tests pass"
SubAgent:
  - bash("npm test")
  - return "All 42 tests passed"
Parent receives: "All 42 tests passed"
```

### 并行探索

```
Parent: "Use 3 subtasks to explore backend, frontend, and database"
SubAgent 1: explores backend → summary
SubAgent 2: explores frontend → summary
SubAgent 3: explores database → summary
Parent receives: 3 summaries
```

## 变更内容

| 组件           | 之前 (s05)       | 之后 (s06)                    |
|----------------|------------------|-------------------------------|
| Tools          | 6                | 7 (+task，仅父端)             |
| 上下文         | 单一共享         | 父 + 子隔离                   |
| SubAgent       | 无               | `runSubagent()` 函数          |
| 返回值         | 不适用           | 仅摘要文本                    |

## 关键洞察

- **上下文隔离是性能优化** — 子 Agent 的噪声不污染父 Agent
- **摘要是信息压缩** — 30 轮对话压缩成 1 段文本
- **子 Agent 是一次性的** — 没有身份，没有跨调用的记忆
- **递归禁止** — 子 Agent 不能再生成子 Agent，防止无限嵌套

---

**大任务拆小，每个小任务干净的上下文。**
