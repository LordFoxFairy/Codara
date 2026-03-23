# 第4章：Context Management — KV Cache 决定了架构

## 循环跑起来，上下文就会爆

s01 说了：agent 就是个循环，模型不断调用工具，结果追加到 messages。

但问题来了：

```python
messages = [
  {role: "user", content: "读取 package.json"},
  {role: "assistant", content: "我要执行 cat"},
  {role: "user", content: "文件内容 3000 行..."},
  {role: "assistant", content: "我要修改..."},
  {role: "user", content: "修改结果 3000 行..."},
  # 继续增长...
]
```

每轮循环，messages 都在变长。10 轮后可能就是 50k tokens。成本线性增长，响应越来越慢。

## KV Cache：为什么 System Prompt 不能变

Transformer 推理的本质是：**每个 token 都要看到之前所有 token 的 Key 和 Value。**

```
Token 1: 计算 K1, V1
Token 2: 计算 K2, V2，用 K1,V1 做 attention
Token 3: 计算 K3, V3，用 K1,V1,K2,V2 做 attention
...
Token N: 计算 KN, VN，用 K1...KN-1, V1...VN-1 做 attention
```

**问题：** 如果输入是 10k tokens，每次推理都要重新计算 10k 个 K,V，成本巨大。

**优化：** 如果输入的前半部分没变，可以缓存之前计算的 K,V。

```python
# 第一次调用（1000 tokens）
system = "你是助手..."  # 500 tokens
user = "读文件"         # 10 tokens
# 计算 K1...K510, V1...V510
# 缓存：cache[hash(system + user)] = (K1...K510, V1...V510)

# 第二次调用（1500 tokens）
system = "你是助手..."  # 500 tokens（没变！）
user = "读文件"         # 10 tokens（没变！）
assistant = "执行 cat"  # 20 tokens
tool_result = "..."     # 970 tokens
# 从缓存读取 K1...K510, V1...V510
# 只计算新增的 K511...K1500, V511...V1500
```

**关键：** 缓存的 key 是输入的 hash。**只要前缀完全一样，就能命中缓存。**

## 为什么 System Prompt 必须静态

如果 System Prompt 变了，哪怕只改一个字符：

```python
# 第一次
system = "你是助手，遵循规则..."

# 第二次（加了时间戳）
system = "你是助手，遵循规则... [时间: 14:32]"
```

**整个前缀都变了，缓存全部失效。**

```
第一次：hash("你是助手，遵循规则...") = 0x1234
第二次：hash("你是助手，遵循规则... [时间: 14:32]") = 0x5678
# 0x1234 != 0x5678，缓存未命中
```

结果：**每次调用都要重新计算所有 K,V，成本暴增 10-100 倍。**

## 实际影响

假设一个 agent 会话：

- System Prompt: 5k tokens
- 每轮对话: 2k tokens
- 10 轮对话

**如果 System Prompt 静态（KV Cache 命中）：**

```
第1轮: 计算 5k + 2k = 7k tokens
第2轮: 计算 2k tokens（5k 从缓存读取）
第3轮: 计算 2k tokens
...
总计: 7k + 9×2k = 25k tokens
```

**如果 System Prompt 动态（KV Cache 失效）：**

```
第1轮: 计算 5k + 2k = 7k tokens
第2轮: 计算 5k + 4k = 9k tokens（缓存失效，全部重算）
第3轮: 计算 5k + 6k = 11k tokens
...
总计: 7k + 9k + 11k + ... = 115k tokens
```

**成本差距：4.6 倍。**

## 正确的架构

```python
# 静态层：初始化时构建，永不改变
system_prompt = build_system_prompt()  # 只调用一次
tools = load_tools()                   # 只调用一次

# 动态层：每轮增长
conversation = []

while True:
    response = model(
        system=system_prompt,  # 不变，KV Cache 命中
        messages=conversation, # 变化，只计算新增部分
        tools=tools            # 不变
    )
    conversation.append(response)
```

**关键约束：** `system_prompt` 在整个会话中不能变。

## 动态信息怎么办

如果需要动态信息（时间、进度、提醒），**不能塞进 System Prompt，要通过 messages 注入：**

```python
# ✗ 错误：破坏 KV Cache
system = f"你是助手，当前时间 {now()}"

# ✓ 正确：通过 messages 注入
conversation.append({
    role: "user",
    content: f"<reminder>当前时间 {now()}</reminder>"
})
```

这样 System Prompt 保持不变，KV Cache 继续命中。

## KV Cache 的深层细节

### 为什么必须是前缀匹配

KV Cache 不能部分缓存，必须是**连续前缀**：

```python
# ✓ 可以缓存
第1次: [A, B, C]
第2次: [A, B, C, D, E]  # 前3个完全一样，缓存命中

# ✗ 不能缓存
第1次: [A, B, C]
第2次: [A, X, C, D, E]  # 中间变了，缓存失效
```

为什么？因为 Attention 是**因果的**：

```
Token C 的 K,V 依赖于 [A, B]
如果 B 变成 X，C 的 K,V 就必须重算
```

这就是为什么 System Prompt 必须在最前面，且不能变。

### 多层多头的缓存

Transformer 不是单层的，是多层多头：

```
Layer 1:  K1[head1...head32], V1[head1...head32]
Layer 2:  K2[head1...head32], V2[head1...head32]
...
Layer 40: K40[head1...head32], V40[head1...head32]
```

**缓存的是所有层所有头的 K,V。**

假设模型是 40 层，32 个头，每个头的维度是 128：

```
每个 token 的 KV 大小 = 40 × 32 × 128 × 2 × 2 bytes
                    = 655,360 bytes ≈ 640 KB
```

5000 tokens 的 System Prompt 缓存大小：

```
5000 × 640 KB = 3.2 GB
```

这就是为什么 KV Cache 很贵，但值得缓存。

### Prompt Caching vs KV Cache

两个概念容易混淆：

**KV Cache（模型层）：**
- 在推理过程中自动发生
- 缓存的是计算好的 K,V 矩阵
- 生命周期：单次请求内有效

**Prompt Caching（API 层）：**
- Claude API 提供的功能
- 缓存的是 System Prompt 的 KV
- 生命周期：5 分钟内跨请求有效

```python
# 第1次请求（14:00）
response = client.messages.create(
    system=[{
        "type": "text",
        "text": "你是助手...",
        "cache_control": {"type": "ephemeral"}  # 标记为可缓存
    }],
    messages=[...]
)
# API 缓存这段 System Prompt 的 KV

# 第2次请求（14:02，2分钟后）
response = client.messages.create(
    system=[{
        "type": "text",
        "text": "你是助手...",  # 完全一样
        "cache_control": {"type": "ephemeral"}
    }],
    messages=[...]
)
# API 从缓存读取，不重新计算
# 成本：只计算 messages 部分
```

**关键：** Prompt Caching 让 KV Cache 跨请求复用，5 分钟内有效。

### 缓存失效的边界情况

**1. 空格和换行**

```python
# 第1次
system = "你是助手"

# 第2次（多了空格）
system = "你是助手 "
# 缓存失效！
```

**2. Unicode 归一化**

```python
# 第1次
system = "你好"  # NFC 编码

# 第2次
system = "你好"  # NFD 编码（看起来一样，实际不同）
# 缓存失效！
```

**3. 工具定义顺序**

```python
# 第1次
tools = [bash, read, write]

# 第2次
tools = [read, bash, write]  # 顺序变了
# 缓存失效！
```

### 如何设计 System Prompt 最大化缓存

**1. 把静态内容放前面**

```python
system = f"""
你是助手。

工具规则：
- bash: 执行命令
- read: 读文件

技能列表：
- git: Git 工作流
- test: 测试规范
"""
# 这部分永远不变，可以缓存
```

**2. 动态内容通过 messages 注入**

```python
# ✗ 错误
system = f"你是助手，当前时间 {now()}"

# ✓ 正确
messages.append({
    "role": "user",
    "content": f"<context>当前时间 {now()}</context>"
})
```

**3. 使用 Prompt Caching API**

```python
system = [{
    "type": "text",
    "text": build_system_prompt(),
    "cache_control": {"type": "ephemeral"}  # 5分钟缓存
}]
```

## 压缩策略

即使分层做对了，动态层也会越跑越大。成熟系统会做：

**1. 滑动窗口**

```python
# 只保留最近 N 轮对话
conversation = conversation[-20:]
```

**2. 完整历史持久化**

```python
# 完整历史存磁盘，供恢复和调试
save_to_disk(full_history)
```

**3. 摘要压缩**

```python
# 把旧对话压缩成摘要
if len(conversation) > 30:
    summary = model.summarize(conversation[:10])
    conversation = [summary] + conversation[10:]
```

## 三个关键点

**1. System Prompt 初始化后不能变**

否则 KV Cache 失效，成本暴增 5-10 倍。

**2. 动态信息通过 messages 注入**

时间、进度、提醒都通过 `conversation.append()` 注入，不改 System Prompt。

**3. 压缩是必须的，但要保留完整历史**

压缩是为了推理效率，完整历史是为了调试和恢复。

---

**KV Cache 的存在，决定了 System Prompt 必须静态。这不是设计选择，而是性能约束。**
