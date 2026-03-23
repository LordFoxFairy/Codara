# s02: Context Window

`s00 > s01 > [ s02 ] s03 > s04 > s05 > s06 > s07 > s08 > s09 > s10`

> *"System Prompt 不可变 → KV Cache 命中 → Token 成本降 90%"*
>
> **Harness 层**: 上下文管理 — 为什么不变性是正确答案。

## 问题

每次调用 LLM 都要传完整的 messages 数组。200k token 的上下文，每轮都要重新计算，成本爆炸。

但 LLM 有一个秘密武器：**KV Cache**。

## KV Cache 原理

Transformer 的注意力机制需要计算 Key 和 Value 矩阵。对于已经见过的 token 序列，这些矩阵可以缓存。

```
第一次调用:
  System Prompt (5000 tokens) → 计算 KV → 缓存
  User Message (100 tokens)   → 计算 KV
  总计算: 5100 tokens

第二次调用（System Prompt 不变）:
  System Prompt (5000 tokens) → 命中缓存 ✓
  User Message (100 tokens)   → 计算 KV
  Tool Result (200 tokens)    → 计算 KV
  总计算: 300 tokens（节省 94%）
```

**关键条件：前缀 token 序列必须完全一致。**

## 解决方案

```
+---------------------------+
| System Prompt (静态)       |  <-- 永远不变，KV Cache 命中
| - Agent 身份               |
| - 工具列表                 |
| - 技能索引                 |
+---------------------------+
           |
+---------------------------+
| Messages (动态)            |  <-- 每轮追加，只计算新增部分
| - User: query             |
| - Assistant: response     |
| - User: tool_result       |
| - ...                     |
+---------------------------+
```

**设计原则：**
- System Prompt 包含所有**静态信息** — 身份、工具定义、技能索引
- Messages 包含所有**动态信息** — 对话历史、工具结果
- **绝对不要在 System Prompt 中插入动态内容**（如当前时间、文件路径）

## 三层压缩策略

即使有 KV Cache，messages 数组也会无限增长。需要三层压缩：

### Layer 1: Micro Compact（静默，每轮）

将 3 轮以前的 tool_result 替换为占位符。

```typescript
function microCompact(messages: Message[]) {
  const toolResults = findAllToolResults(messages);
  if (toolResults.length <= KEEP_RECENT) return;

  for (const result of toolResults.slice(0, -KEEP_RECENT)) {
    if (result.content.length > 100) {
      result.content = `[Previous: used ${result.tool_name}]`;
    }
  }
}
```

### Layer 2: Auto Compact（阈值触发）

Token 超过 50k 时，保存完整对话到磁盘，让 LLM 做摘要。

```typescript
async function autoCompact(messages: Message[]) {
  // 保存 transcript 用于恢复
  await saveTranscript(messages);

  // LLM 摘要
  const summary = await model.invoke({
    messages: [
      {
        role: "user",
        content: `Summarize this conversation:\n${JSON.stringify(messages)}`,
      },
    ],
    max_tokens: 2000,
  });

  return [
    { role: "user", content: `[Compressed]\n\n${summary}` },
    { role: "assistant", content: "Understood. Continuing." },
  ];
}
```

### Layer 3: Manual Compact（工具触发）

Agent 可以主动调用 `compact` 工具，触发同样的摘要机制。

## 整合到循环

```typescript
async function agentLoop(query: string) {
  const messages = [{ role: "user", content: query }];

  while (true) {
    // Layer 1: 每轮静默压缩
    microCompact(messages);

    // Layer 2: 阈值触发
    if (estimateTokens(messages) > 50000) {
      messages.splice(0, messages.length, ...await autoCompact(messages));
    }

    const response = await model.invoke({
      system: SYSTEM_PROMPT,  // 静态，KV Cache 命中
      messages,               // 动态，只计算新增
      tools: TOOLS,
    });

    // ... 工具执行 ...
  }
}
```

## 变更内容

| 组件           | 之前 (s01)       | 之后 (s02)                     |
|----------------|------------------|--------------------------------|
| System Prompt  | 无               | 静态，包含身份 + 工具定义      |
| KV Cache       | 无               | 前缀命中，成本降 90%           |
| 压缩           | 无               | 三层（micro/auto/manual）      |
| Transcript     | 无               | 保存到磁盘，可恢复             |

## 关键洞察

- **不变性是性能的前提** — System Prompt 变一个字，KV Cache 全部失效
- **静态 vs 动态的分割是架构决策** — 不是实现细节
- **压缩不是丢失** — Transcript 保存完整历史，只是移出活跃上下文
- **三层压缩递进** — 静默 → 自动 → 手动，激进程度递增

---

**Context Window 是有限的。设计决定了你能走多远。**
