# 第2章：Agent Loop — 让模型持续工作的闭环

## 从一次调用到持续执行

LLM 本质是个函数：给它输入，它给你输出，然后就结束了。

如果你给它一个 bash 工具，它可以执行一次命令。但执行完就停了。

```python
response = model("读取 package.json", tools=[bash])
# 模型说：我要执行 cat package.json
# 执行完了，然后呢？
```

bash 只能执行一次，然后呢？

答案是把它放进循环：

```python
while True:
    response = model(messages, tools)
    if response.stop_reason != "tool_use":
        break
    for call in response.tool_calls:
        result = execute(call)
        messages.append(result)
```

这就是 agent 的全部。学术界叫它 ReAct（Reasoning + Acting），但名字不重要。

重要的是——**循环内部没有一行 if/else 决定"下一步做什么"。**

## 三个关键点

**1. 模型控制流程**

不是代码决定"接下来读哪个文件"，是模型决定。

代码只负责：执行工具 → 结果给模型 → 模型继续。

**2. 状态在 messages**

```python
messages = [
  {role: "user", content: "任务"},
  {role: "assistant", content: "我要读文件"},
  {role: "user", content: "文件内容"},
  {role: "assistant", content: "我要修改"},
]
```

LLM 无状态，只能通过 messages 看历史。

**3. 结果必须回到 messages**

不能只存变量。模型看不到变量，只能看 messages。

---

**这个循环是整个 runtime 的心脏。后面所有机制都建立在它之上。**
