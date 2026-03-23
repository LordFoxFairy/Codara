# s01: Agent Loop

`s00 > [ s01 ] s02 > s03 > s04 > s05 > s06 > s07 > s08 > s09 > s10`

> *"while (stop_reason == tool_use) — 唯一的执行推进器"*
>
> **Harness 层**: 循环 — 模型与真实世界的第一道连接。

## 问题

语言模型能推理代码，但碰不到真实世界 — 不能读文件、跑测试、看报错。没有循环，每次工具调用你都得手动把结果粘回去。你自己就是那个循环。

## 解决方案

```
+--------+      +-------+      +---------+
|  User  | ---> |  LLM  | ---> |  Tool   |
| prompt |      |       |      | execute |
+--------+      +---+---+      +----+----+
                    ^                |
                    |   tool_result  |
                    +----------------+
                    (loop until stop_reason != "tool_use")
```

一个退出条件控制整个流程。循环持续运行，直到模型不再调用工具。

## 工作原理

1. 用户 prompt 作为第一条消息。

```typescript
messages.push({ role: "user", content: query });
```

2. 将消息和工具定义一起发给 LLM。

```typescript
const response = await model.invoke({
  messages,
  tools: TOOLS,
  max_tokens: 8000,
});
```

3. 追加助手响应。检查 `stop_reason` — 如果模型没有调用工具，结束。

```typescript
messages.push({ role: "assistant", content: response.content });
if (response.stop_reason !== "tool_use") {
  return;
}
```

4. 执行每个工具调用，收集结果，作为 user 消息追加。回到第 2 步。

```typescript
const results = [];
for (const block of response.content) {
  if (block.type === "tool_use") {
    const output = await runTool(block.name, block.input);
    results.push({
      type: "tool_result",
      tool_use_id: block.id,
      content: output,
    });
  }
}
messages.push({ role: "user", content: results });
```

组装为一个完整函数：

```typescript
async function agentLoop(query: string) {
  const messages = [{ role: "user", content: query }];

  while (true) {
    const response = await model.invoke({
      messages,
      tools: TOOLS,
      max_tokens: 8000,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      return;
    }

    const results = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const output = await runTool(block.name, block.input);
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: output,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }
}
```

不到 30 行，这就是整个 Agent。后面 9 个章节都在这个循环上叠加机制 — 循环本身始终不变。

## 变更内容

| 组件          | 之前       | 之后                           |
|---------------|------------|--------------------------------|
| Agent loop    | (无)       | `while (true)` + stop_reason   |
| Tools         | (无)       | `runTool()` 分发               |
| Messages      | (无)       | 累积式消息列表                 |
| Control flow  | (无)       | `stop_reason !== "tool_use"`   |

## 关键洞察

- **模型决定何时调用工具、何时停止** — 代码只是执行模型的要求
- **messages 数组是唯一的状态** — 每轮追加，永不修改历史
- **循环是同步的** — 一次只做一件事，顺序清晰
- **工具执行是黑盒** — 循环不关心工具内部逻辑，只关心输入输出

---

**这是最小循环。每个 AI Agent 都需要这个循环。**
