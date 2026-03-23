# s06: SubAgent

> *"上下文隔离 — 子 Agent 独立 messages[]，只返回摘要"*

## 问题

Agent 工作越久，messages 数组越胖。每次读文件、跑命令的输出都永久留在上下文里。

"这个项目用什么测试框架？" 可能要读 5 个文件，但父 Agent 只需要一个词："pytest"。

## 核心设计

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

**关键：** 子 Agent 可能跑了 30+ 次工具调用，但整个消息历史直接丢弃。父 Agent 收到的只是一段摘要文本。

## 为什么需要上下文隔离？

### 问题：噪声累积

```
Parent messages:
  User: "分析这个项目的测试框架"
  Assistant: "我要读 5 个文件"
  User: [file1 内容 1000 tokens]
  User: [file2 内容 1000 tokens]
  User: [file3 内容 1000 tokens]
  User: [file4 内容 1000 tokens]
  User: [file5 内容 1000 tokens]
  Assistant: "是 pytest"

总计: 5000+ tokens 噪声
```

### 解决方案：隔离 + 摘要

```
Parent messages:
  User: "分析这个项目的测试框架"
  Assistant: "我要派发子任务"
  User: [tool_result: "pytest"]  <- 只有摘要

总计: ~50 tokens
```

## 递归禁止

子 Agent 不能再生成子 Agent。为什么？

```
Parent
  └─ SubAgent 1
       └─ SubAgent 2
            └─ SubAgent 3
                 └─ ...  (无限嵌套)
```

**解决方案：** 子 Agent 的工具集不包含 `task` 工具。

## 伪代码

```python
def run_subagent(prompt):
    sub_messages = [{"role": "user", "content": prompt}]

    for i in range(30):  # safety limit
        response = LLM.invoke(sub_messages, tools=CHILD_TOOLS)
        if response.stop_reason != "tool_use":
            break
        # 执行工具，追加结果

    return extract_text(response)  # 只返回文本
```

7 行。独立循环 + 摘要提取。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| 上下文隔离 | 父 Agent 保持干净 | 子 Agent 无法访问父上下文 |
| 只返回摘要 | 信息压缩，节省 tokens | 可能丢失细节 |
| 递归禁止 | 防止无限嵌套 | 限制了灵活性 |
| 30 轮限制 | 防止死循环 | 可能截断长任务 |

## 关键洞察

- **上下文隔离是性能优化** — 子 Agent 的噪声不污染父 Agent
- **摘要是信息压缩** — 30 轮对话压缩成 1 段文本
- **子 Agent 是一次性的** — 没有身份，没有跨调用的记忆
- **递归禁止** — 防止无限嵌套，保持系统可控

---

**大任务拆小，每个小任务干净的上下文。**
