# 第5章：Skill Loading — 按需注入知识

## 为什么需要 Skill

Agent 会跑、会用工具，但它不知道你的工作流程。

比如：
- 提交前要跑哪些检查
- 测试失败了怎么处理
- 代码审查要看什么

你可以把这些写进固定 prompt，但这样做有问题：

```python
system_prompt = """
你是一个 agent。
提交前要运行 lint、test、build。
测试失败要看日志、修代码、重跑。
代码审查要检查类型、边界、错误处理。
发布流程是...
团队规范是...
"""
```

每加一条规则，prompt 就胖一圈。模型背着一堆无关知识工作。

## Skill 的核心思想

把知识分两层：

```python
# 索引层：告诉模型有哪些 skill
tools = [
    {"name": "load_skill", "description": "Load a skill by name"},
]

# 内容层：需要时才加载
if model_calls("load_skill", "commit-check"):
    messages.append(read_skill("commit-check"))
```

模型看到索引，决定要不要加载。加载后，知识进入 messages，模型按指导执行。

## 什么适合做成 Skill

不是所有知识都该做成 skill。

**适合的：**
- 有明确触发场景（"提交前"、"测试失败时"）
- 可重复使用的流程
- 需要多步骤的操作指南

**不适合的：**
- 通用常识（模型已经知道）
- 一次性的说明
- 太简单的规则（直接写进 system prompt）

## 实现要点

**1. Skill 是工具，不是文档**

```python
# ✓ 好：模型主动调用
model: "我要提交代码，先加载 commit-check"
system: load_skill("commit-check")

# ✗ 坏：被动塞给模型
system: "这是所有 skill 的内容..."
```

**2. 索引要轻**

```python
skills = [
    {"name": "commit-check", "trigger": "before commit"},
    {"name": "test-debug", "trigger": "test failure"},
]
```

模型扫一眼就知道有什么，不需要读完整内容。

**3. 内容要可执行**

Skill 不是"提交前要小心"，而是"运行 lint → 运行 test → 检查 diff"。

## 为什么不直接塞进 System Prompt

对比两种方式：

**固定 Prompt：**
- 所有知识一次性加载
- 模型背着无关内容工作
- 难以模块化管理

**Skill Loading：**
- 按需加载
- 只引入当前需要的知识
- 可以独立维护、更新

## 和后面的关系

Skill 解决了"知识怎么进入系统"。

但有知识不代表能执行好。长任务容易偏航，需要外部规划支架。

这就是 s05 要讲的：**Plan Mode。**

---

**Skill Loading 的核心：把知识索引和内容分开，让模型按需加载场景化指导。**
