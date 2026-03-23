# s02: Context Window

> *"System Prompt 不可变 → KV Cache 命中 → Token 成本降 90%"*

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

## 核心设计

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
+---------------------------+
```

**设计原则：**
- System Prompt 包含所有**静态信息**
- Messages 包含所有**动态信息**
- **绝对不要在 System Prompt 中插入动态内容**

## 三层压缩策略

即使有 KV Cache，messages 数组也会无限增长。需要三层压缩：

### Layer 1: Micro Compact（静默，每轮）

将 3 轮以前的 tool_result 替换为占位符。

```python
# 旧结果 (1000 tokens)
{"type": "tool_result", "content": "...大量输出..."}

# 压缩后 (20 tokens)
{"type": "tool_result", "content": "[Previous: used read_file]"}
```

### Layer 2: Auto Compact（阈值触发）

Token 超过 50k 时，保存完整对话到磁盘，让 LLM 做摘要。

```python
if tokens > 50000:
    save_transcript(messages)  # 保存完整历史
    summary = LLM.summarize(messages)
    messages = [
        {"role": "user", "content": f"[Compressed]\n{summary}"},
        {"role": "assistant", "content": "Understood."}
    ]
```

### Layer 3: Manual Compact（工具触发）

Agent 可以主动调用 `compact` 工具，触发同样的摘要机制。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| 静态 System Prompt | KV Cache 命中，成本降 90% | 不能动态调整身份 |
| Micro Compact | 静默，无感知 | 丢失旧工具结果细节 |
| Auto Compact | 自动触发，无需干预 | 摘要可能丢失信息 |
| Transcript 保存 | 完整历史可恢复 | 磁盘占用 |

## 关键洞察

- **不变性是性能的前提** — System Prompt 变一个字，KV Cache 全部失效
- **静态 vs 动态的分割是架构决策** — 不是实现细节
- **压缩不是丢失** — Transcript 保存完整历史，只是移出活跃上下文
- **三层压缩递进** — 静默 → 自动 → 手动，激进程度递增

---

**Context Window 是有限的。设计决定了你能走多远。**
