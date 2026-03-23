# 第4章：Context Management — 静态和动态分层

## 循环跑起来,上下文就会爆

s01 说了:agent 就是个循环,模型不断调用工具,结果追加到 messages。

但问题来了:

```python
messages = [
  {role: "system", content: "你是一个助手..."},
  {role: "user", content: "读取 package.json"},
  {role: "assistant", content: "我要执行 cat"},
  {role: "user", content: "文件内容 3000 行..."},
  {role: "assistant", content: "我要修改..."},
  {role: "user", content: "修改结果 3000 行..."},
  # 继续增长...
]
```

每轮循环,messages 都在变长。成本变高,响应变慢,模型开始抓不住重点。

## 核心问题:两种东西混在一起

messages 里有两种完全不同的内容:

**静态层:**
- 身份定义
- 工具规则
- 技能索引

**动态层:**
- 用户请求
- 工具结果
- 任务进展

一旦混在一起,系统就会同时失去性能和清晰度。

## 正确的做法

把静态和动态分开:

```python
# 静态层:缓存,不变
system_prompt = build_system_prompt()

# 动态层:每轮增长
conversation = []

while True:
    messages = [system_prompt] + conversation
    response = model(messages, tools)
    conversation.append(response)
```

静态层可以缓存,动态层可以压缩。

## 为什么要压缩

即使分层做对了,动态层也会越跑越大。

成熟系统会做两件事:

**1. 保留最近现场**

```python
# 只保留最近 N 轮对话
conversation = conversation[-20:]
```

**2. 完整历史另存**

```python
# 完整历史存文件,供恢复和追溯
save_to_disk(full_history)
```

压缩不是删除真相,而是把"正在参与推理的内容"和"系统长期记忆"分开。

## 三个关键点

**1. 静态层尽量稳定**

不要把临时信息塞进 system prompt。

**2. 动态层可以裁剪**

模型不需要看到所有历史,只需要看到相关的。

**3. 完整历史必须保存**

用户可能要回溯,调试可能要复现。

---

**静态和动态分层,系统才能既快又稳。后面的技能按需加载、子 Agent 上下文裁剪,都建立在这个基础上。**
