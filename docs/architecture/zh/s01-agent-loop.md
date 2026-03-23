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

## stop_reason：循环的终止条件

模型每次返回都会带一个 `stop_reason`，告诉你为什么停下来：

```python
response = model(messages, tools)
print(response.stop_reason)
# 可能的值：
# - "end_turn": 模型认为任务完成，主动结束
# - "tool_use": 模型要调用工具，需要继续
# - "max_tokens": 输出超过长度限制，被截断
# - "stop_sequence": 遇到停止符（如 </response>）
```

**end_turn** 是正常结束：

```python
# 用户：读取 package.json 的 name 字段
# 模型：执行 cat package.json
# 工具：返回文件内容
# 模型：name 是 "codara"
# stop_reason = "end_turn"  # 任务完成
```

**tool_use** 是需要继续：

```python
# 模型：我要读文件
# stop_reason = "tool_use"
# tool_calls = [{name: "read", args: {path: "package.json"}}]
```

**max_tokens** 是被截断：

```python
# 模型输出了 4096 个 token，还没说完
# stop_reason = "max_tokens"
# 这时要么扩大限制，要么让模型总结
```

**关键：** 只有 `tool_use` 才继续循环，其他都应该停止。

```python
while True:
    response = model(messages, tools)
    
    if response.stop_reason == "end_turn":
        break  # 正常结束
    
    if response.stop_reason == "max_tokens":
        # 警告：输出被截断
        break
    
    if response.stop_reason != "tool_use":
        break  # 其他情况也停止
    
    # 只有 tool_use 才执行工具
    for call in response.tool_calls:
        result = execute(call)
        messages.append(result)
```

## 为什么是 while True 而不是递归

你可能会想：为什么不用递归？

```python
def agent(messages):
    response = model(messages)
    if response.stop_reason == "tool_use":
        for call in response.tool_calls:
            result = execute(call)
            messages.append(result)
        return agent(messages)  # 递归
    return response
```

**问题 1：栈溢出**

```python
# 假设 agent 执行了 100 轮
agent(messages)
  → agent(messages)
    → agent(messages)
      → ... (100 层调用栈)
        → RecursionError: maximum recursion depth exceeded
```

Python 默认递归深度是 1000，但 agent 可能跑几百轮。

**问题 2：无法中断**

```python
# 用户按 Ctrl+C
# 递归调用栈很深，异常传播很慢
# 可能要等几秒才能真正停下来
```

**问题 3：无法插入逻辑**

```python
while True:
    response = model(messages)
    
    # 可以在这里插入任何逻辑
    if len(messages) > 100:
        compress(messages)  # 压缩历史
    
    if time.time() - start > 300:
        break  # 超时保护
    
    if response.stop_reason != "tool_use":
        break
```

递归做不到这些。

**while True 是唯一正确的选择。**

## messages 数组的内存管理

每轮循环，messages 都在增长：

```python
messages = [
    {role: "user", content: "读取 package.json"},
    {role: "assistant", content: "我要执行 cat"},
    {role: "user", content: "文件内容 3000 行..."},  # +3000 tokens
    {role: "assistant", content: "我要修改..."},
    {role: "user", content: "修改结果 3000 行..."},  # +3000 tokens
]
```

**问题：** 10 轮后可能就是 50k tokens，成本线性增长。

**解决方案 1：滑动窗口**

```python
MAX_HISTORY = 20  # 只保留最近 20 条消息

while True:
    response = model(messages[-MAX_HISTORY:], tools)
    # 只传最近 20 条，但完整历史还在 messages 里
```

**解决方案 2：摘要压缩**

```python
if len(messages) > 30:
    # 把前 10 条压缩成摘要
    summary = model.summarize(messages[:10])
    messages = [summary] + messages[10:]
```

**解决方案 3：分层存储**

```python
# 内存：只保留最近的
working_memory = messages[-20:]

# 磁盘：完整历史
save_to_disk(messages)

# 推理时只用 working_memory
response = model(working_memory, tools)
```

**关键：** 压缩是为了推理效率，但完整历史必须保留（调试、恢复、审计）。

## 流式输出 vs 批量输出

模型有两种返回方式：

**批量输出（Blocking）：**

```python
response = model(messages)  # 等待完整响应
print(response.content)     # 一次性显示
```

- 优点：简单，容易处理
- 缺点：用户要等很久才看到第一个字

**流式输出（Streaming）：**

```python
stream = model.stream(messages)
for chunk in stream:
    print(chunk.content, end="")  # 逐字显示
```

- 优点：用户立即看到输出，体验好
- 缺点：实现复杂

**agent loop 必须用流式输出。** 为什么？

```python
# 批量输出
response = model(messages)  # 等待 10 秒
print(response.content)     # 用户等了 10 秒才看到

# 流式输出
stream = model.stream(messages)
for chunk in stream:
    print(chunk.content, end="")  # 0.1 秒就开始显示
```

**但流式输出有个问题：tool_calls 在最后才知道。**

```python
stream = model.stream(messages)
for chunk in stream:
    print(chunk.content, end="")
    # 这时还不知道有没有 tool_calls

# 流结束后才知道
if stream.stop_reason == "tool_use":
    for call in stream.tool_calls:
        execute(call)
```

**正确的实现：**

```python
while True:
    stream = model.stream(messages)
    
    # 边流式显示，边收集完整响应
    full_content = ""
    for chunk in stream:
        print(chunk.content, end="")
        full_content += chunk.content
    
    # 流结束后，检查 stop_reason
    if stream.stop_reason != "tool_use":
        break
    
    # 执行工具
    for call in stream.tool_calls:
        result = execute(call)
        messages.append({
            role: "assistant",
            content: full_content,
            tool_calls: stream.tool_calls
        })
        messages.append({
            role: "user",
            content: result
        })
```

## 错误处理和重试机制

agent loop 会遇到各种错误：

**1. API 错误（429, 500, 503）**

```python
while True:
    try:
        response = model(messages)
    except APIError as e:
        if e.status_code == 429:  # Rate limit
            time.sleep(60)  # 等 1 分钟
            continue
        elif e.status_code >= 500:  # Server error
            time.sleep(5)   # 等 5 秒
            continue
        else:
            raise  # 其他错误直接抛出
```

**2. 工具执行错误**

```python
for call in response.tool_calls:
    try:
        result = execute(call)
    except Exception as e:
        # 把错误信息返回给模型
        result = f"Error: {e}"
    
    messages.append({
        role: "user",
        content: result
    })
```

**关键：** 不要让错误中断循环，而是把错误信息给模型，让它自己处理。

**3. 超时保护**

```python
start_time = time.time()
MAX_DURATION = 300  # 5 分钟

while True:
    if time.time() - start_time > MAX_DURATION:
        print("超时，强制结束")
        break
    
    response = model(messages)
    # ...
```

**4. 最大轮数限制**

```python
MAX_TURNS = 50

for turn in range(MAX_TURNS):
    response = model(messages)
    
    if response.stop_reason != "tool_use":
        break
    
    # 执行工具...

if turn >= MAX_TURNS - 1:
    print("达到最大轮数，强制结束")
```

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
