# s01: Agent Loop

> *"while (stop_reason == tool_use) — 唯一的执行推进器"*

## 问题

LLM 是无状态的函数：输入 prompt，输出 text。它不能持续运行，不能主动调用工具，不能记住上一轮的结果。

没有循环，你就是那个循环 — 手动把工具结果粘回去，再调用一次 LLM。

## 核心设计

```
User Prompt
    ↓
┌───────────────────┐
│  while (true) {   │
│    LLM.invoke()   │ ← messages 累积历史
│    if (done) break│
│    execute tools  │
│    append results │
│  }                │
└───────────────────┘
    ↓
Final Response
```

**循环的本质：** model → tool → model 的反馈回路。

## 关键决策

### 1. 谁决定停止？

**模型决定。** 不是代码。

```
response = LLM.invoke(messages, tools)
if response.stop_reason != "tool_use":
    break  # 模型说"我不需要工具了"
```

为什么？因为只有模型知道任务是否完成。代码不知道"读 3 个文件"是否足够，模型知道。

### 2. 状态存在哪里？

**messages 数组。** 唯一的状态。

```
messages = [
  {role: "user", content: "任务描述"},
  {role: "assistant", content: "我要调用工具"},
  {role: "user", content: "工具结果"},
  {role: "assistant", content: "基于结果，我要..."},
]
```

每轮追加，永不修改历史。LLM 通过 messages 看到完整对话。

### 3. 循环是同步还是异步？

**同步。** 一次只做一件事。

```
while (true) {
  response = await LLM.invoke()  // 等待
  results = await execute_tools() // 等待
}
```

为什么？因为下一轮依赖上一轮的结果。并行化在工具层做，不在循环层。

## 伪代码

```python
def agent_loop(query):
    messages = [{"role": "user", "content": query}]

    while True:
        response = LLM.invoke(messages, tools)
        messages.append({"role": "assistant", "content": response})

        if response.stop_reason != "tool_use":
            return response.text

        results = [execute(tool) for tool in response.tool_calls]
        messages.append({"role": "user", "content": results})
```

7 行。这就是全部。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| 模型控制停止 | 灵活，模型自主决策 | 可能无限循环（需要 max_turns） |
| messages 累积 | 完整上下文，模型看到全部历史 | 无限增长（需要压缩，见 s02） |
| 同步循环 | 简单，顺序清晰 | 慢工具阻塞（需要后台执行，见 s08） |

## 关键洞察

- **循环是 Harness 的心脏** — 所有其他机制都围绕它构建
- **模型是驾驶者** — 循环只是执行模型的指令
- **messages 是记忆** — 循环通过 messages 给模型提供上下文
- **停止条件是契约** — 模型和 Harness 的唯一通信方式

---

**这是最小循环。后面 9 个章节都在这个循环上叠加机制 — 循环本身始终不变。**
