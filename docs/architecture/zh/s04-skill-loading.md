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

**问题：** 如果你有 20 个 skill，每个 500 tokens，全塞进 System Prompt 就是 10k tokens。但 90% 的时间，模型只需要其中 1-2 个。

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

## 为什么索引在 System Prompt，内容在 tool_result

这个设计不是随意的，而是基于 KV Cache 的约束。

**索引必须在 System Prompt：**

```python
system_prompt = """
你是 agent。

可用 Skills:
- commit-check: 提交前检查流程
- test-debug: 测试失败调试指南
- code-review: 代码审查清单
"""
```

索引是静态的，初始化后不变。放在 System Prompt 可以：
- 利用 KV Cache，不重复计算
- 模型每轮都能看到完整索引
- 成本固定，不随会话增长

**内容必须在 tool_result：**

```python
# 模型调用工具
model: tool_use(name="load_skill", args={"skill": "commit-check"})

# 系统返回内容
messages.append({
    "role": "user",
    "content": [{
        "type": "tool_result",
        "tool_use_id": "...",
        "content": """
        # Commit Check 流程
        1. 运行 lint
        2. 运行 test
        3. 检查 diff
        """
    }]
})
```

内容是动态的，按需加载。放在 messages 可以：
- 只在需要时才注入，不污染 System Prompt
- 用完可以压缩或丢弃
- 不破坏 KV Cache

**如果反过来会怎样：**

```python
# ✗ 错误：把内容塞进 System Prompt
system_prompt = f"""
你是 agent。

{load_all_skills()}  # 10k tokens
"""
# 问题：
# 1. System Prompt 变大，KV Cache 成本高
# 2. 90% 的内容用不到，浪费 context window
# 3. 无法动态更新
```

## Skill 加载的成本分析

每次加载 skill 都有成本，需要权衡。

**成本构成：**

```python
# 1. 工具调用成本
model: tool_use(name="load_skill", args={"skill": "commit-check"})
# 输出 tokens: ~50

# 2. 内容注入成本
messages.append({
    "role": "user",
    "content": skill_content  # 假设 500 tokens
})
# 输入 tokens: 500

# 3. 后续轮次的累积成本
# 加载后，这 500 tokens 会在后续每轮都被处理
# 如果还有 5 轮对话，总成本 = 500 × 5 = 2500 tokens
```

**对比固定 System Prompt：**

假设有 10 个 skill，每个 500 tokens：

```
固定 System Prompt:
- 初始成本: 5000 tokens（全部加载）
- 每轮成本: 5000 tokens（KV Cache 命中，但占用 context）
- 10 轮总成本: 5000 × 10 = 50,000 tokens

按需加载（假设只用 2 个 skill）:
- 初始成本: 200 tokens（索引）
- 加载成本: 1000 tokens（2 个 skill）
- 每轮成本: 1200 tokens
- 10 轮总成本: 1200 × 10 = 12,000 tokens

节省: 76%
```

**关键：** 如果使用率低（<30%），按需加载更划算。如果使用率高（>70%），固定加载更简单。

## Skill 的生命周期

Skill 不是加载后就永久存在，需要管理生命周期。

**1. 加载时机**

```python
# 模型主动加载
model: "我要提交代码，先加载 commit-check"
system: load_skill("commit-check")

# 系统自动加载（基于触发器）
if detect_test_failure():
    auto_load_skill("test-debug")
```

**2. 生命周期**

```python
# 加载后，skill 内容进入 messages
messages = [
    {"role": "system", "content": "..."},
    {"role": "user", "content": "提交代码"},
    {"role": "assistant", "content": "加载 commit-check"},
    {"role": "user", "content": "# Commit Check 流程\n..."},  # ← skill 内容
    {"role": "assistant", "content": "执行 lint"},
    {"role": "user", "content": "lint 通过"},
    # skill 内容一直存在于 messages 中
]
```

**3. 卸载时机**

Skill 不会主动卸载，但可以通过压缩策略移除：

```python
# 滑动窗口：只保留最近 N 轮
if len(messages) > 30:
    messages = messages[-20:]  # skill 内容可能被丢弃

# 摘要压缩：把旧对话压缩成摘要
if len(messages) > 30:
    summary = model.summarize(messages[:10])
    messages = [summary] + messages[10:]  # skill 内容被压缩
```

**4. 重复加载**

如果 skill 被压缩后又需要，模型会重新加载：

```python
# 第 1 轮：加载 commit-check
messages.append(load_skill("commit-check"))  # 500 tokens

# 第 20 轮：压缩，skill 被移除
messages = compress(messages)

# 第 25 轮：再次需要，重新加载
messages.append(load_skill("commit-check"))  # 又是 500 tokens
```

**成本：** 重复加载会增加成本。如果 skill 使用频繁，考虑放进 System Prompt。

## 什么适合做成 Skill

不是所有知识都该做成 skill。

**适合的：**
- 有明确触发场景（"提交前"、"测试失败时"）
- 可重复使用的流程
- 需要多步骤的操作指南
- 使用频率 <30%（偶尔用到）

**不适合的：**
- 通用常识（模型已经知道）
- 一次性的说明
- 太简单的规则（直接写进 system prompt）
- 使用频率 >70%（几乎每次都用）

## Skill Loading vs RAG

Skill Loading 看起来像 RAG（Retrieval-Augmented Generation），但有本质区别。

**RAG 的工作方式：**

```python
# 1. 用户提问
user: "如何提交代码？"

# 2. 检索相关文档
docs = vector_search(user_query, knowledge_base)
# 返回：["提交前要运行 lint", "测试失败要修复", ...]

# 3. 注入到 prompt
prompt = f"""
相关文档：
{docs}

用户问题：{user_query}
"""
```

**Skill Loading 的工作方式：**

```python
# 1. 模型识别场景
model: "用户要提交代码，我需要 commit-check 流程"

# 2. 主动加载 skill
model: tool_use(name="load_skill", args={"skill": "commit-check"})

# 3. 执行 skill 指导
system: 返回 skill 内容
model: 按照 skill 执行步骤
```

**核心区别：**

| 维度 | RAG | Skill Loading |
|------|-----|---------------|
| 触发方式 | 被动检索（基于用户输入） | 主动加载（模型决策） |
| 内容类型 | 知识片段（文档、FAQ） | 可执行流程（步骤、清单） |
| 使用时机 | 回答问题时 | 执行任务时 |
| 模型角色 | 消费知识 | 执行流程 |
| 成本 | 每次查询都检索 | 按需加载，可复用 |

**为什么不用 RAG：**

```python
# RAG 的问题
user: "提交代码"
docs = vector_search("提交代码")
# 返回：["提交前要运行 lint", "代码审查规范", "Git 使用指南", ...]
# 问题：
# 1. 检索结果不精确（可能包含无关内容）
# 2. 每次都要检索，成本高
# 3. 模型需要从文档中提取流程，容易遗漏

# Skill Loading 的优势
model: "我需要 commit-check"
system: 返回精确的流程清单
model: 按清单执行，不会遗漏
# 优势：
# 1. 精确匹配（模型知道要什么）
# 2. 只加载一次，可复用
# 3. 流程化，不需要提取
```

**适用场景：**

- RAG：回答知识性问题（"什么是 KV Cache？"）
- Skill Loading：执行结构化任务（"提交代码前的检查流程"）

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
    {"name": "commit-check", "trigger": "before commit", "size": "~500 tokens"},
    {"name": "test-debug", "trigger": "test failure", "size": "~800 tokens"},
]
```

模型扫一眼就知道有什么，不需要读完整内容。

**索引设计原则：**
- 名称要语义化（commit-check 比 skill-001 好）
- 描述要包含触发场景（"before commit" 而不是 "useful for commits"）
- 可选：标注大小，帮助模型评估成本

**3. 内容要可执行**

Skill 不是"提交前要小心"，而是"运行 lint → 运行 test → 检查 diff"。

```python
# ✗ 坏：模糊的建议
"""
提交前要小心检查代码质量。
"""

# ✓ 好：可执行的清单
"""
# Commit Check 流程

1. 运行 lint
   - 命令：npm run lint
   - 失败则修复后重跑

2. 运行 test
   - 命令：npm test
   - 失败则调试后重跑

3. 检查 diff
   - 命令：git diff --staged
   - 确认没有调试代码、console.log
"""
```

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

## 实现模式

**1. 工具定义**

```typescript
{
  name: "Skill",
  description: "Load a skill to get specialized guidance for specific tasks",
  parameters: {
    skill: {
      type: "string",
      description: "Skill name to load",
      enum: ["commit-check", "test-debug", "code-review"]
    }
  }
}
```

**2. 索引注入（System Prompt）**

```python
system_prompt = """
你是 agent。

可用 Skills（按需加载）:
- commit-check: 提交前检查流程（~500 tokens）
- test-debug: 测试失败调试指南（~800 tokens）
- code-review: 代码审查清单（~600 tokens）
- deploy: 部署流程（~1000 tokens）

使用 Skill 工具加载需要的 skill。
"""
```

**3. 内容加载（tool_result）**

```python
def handle_skill_load(skill_name: str) -> str:
    skill_path = f".codara/skills/{skill_name}/SKILL.md"
    content = read_file(skill_path)

    return {
        "type": "tool_result",
        "content": content
    }
```

**4. 缓存策略**

```python
# 已加载的 skill 记录
loaded_skills = set()

def handle_skill_load(skill_name: str) -> str:
    # 避免重复加载
    if skill_name in loaded_skills:
        return "Skill already loaded in this session"

    loaded_skills.add(skill_name)
    return read_skill(skill_name)
```

## 边界情况

**1. Skill 冲突**

如果两个 skill 有矛盾的指导：

```python
# commit-check: "提交前必须运行所有测试"
# fast-commit: "紧急修复可以跳过测试"

# 解决：
# - 在 skill 描述中标注优先级
# - 让模型根据场景选择
# - 或者设计互斥的 skill（不能同时加载）
```

**2. Skill 依赖**

如果一个 skill 依赖另一个：

```python
# deploy skill 依赖 commit-check

def handle_skill_load(skill_name: str):
    skill = read_skill(skill_name)

    # 检查依赖
    if skill.dependencies:
        for dep in skill.dependencies:
            if dep not in loaded_skills:
                # 自动加载依赖
                handle_skill_load(dep)

    return skill.content
```

**3. Skill 版本**

如果 skill 内容更新了：

```python
# 问题：会话中已加载旧版本
loaded_skills = {"commit-check": "v1.0"}

# 解决：
# 1. 重启会话（简单但不优雅）
# 2. 提供 reload 工具（复杂但灵活）
# 3. 在 skill 内容中包含版本号，模型可以检测
```

**4. Context Window 溢出**

如果加载太多 skill，超出 context window：

```python
# 检测机制
total_tokens = sum([
    len(system_prompt),
    len(messages),
    len(loaded_skills)
])

if total_tokens > context_limit * 0.8:
    # 警告或自动压缩
    compress_old_messages()
```

## 性能优化

**1. 懒加载**

```python
# ✗ 坏：启动时加载所有 skill 索引
skills = [read_skill_metadata(s) for s in all_skills]

# ✓ 好：只加载索引，内容按需读取
skills = [
    {"name": "commit-check", "path": ".codara/skills/commit-check"},
    {"name": "test-debug", "path": ".codara/skills/test-debug"},
]
```

**2. 预加载高频 skill**

```python
# 统计 skill 使用频率
skill_usage = {
    "commit-check": 0.8,  # 80% 的会话会用
    "test-debug": 0.3,    # 30% 的会话会用
}

# 高频 skill 直接放进 System Prompt
if skill_usage["commit-check"] > 0.7:
    system_prompt += read_skill("commit-check")
```

**3. 增量加载**

```python
# 如果 skill 很大（>2000 tokens），分段加载
def load_skill_incremental(skill_name: str, section: str):
    skill = read_skill(skill_name)

    # 只返回需要的部分
    return skill.sections[section]

# 模型调用
model: load_skill("deploy", section="pre-deploy-checks")
```

## 实际数据

基于 Codara 项目的实际测量：

**Skill 索引成本：**
```
可用 Skills 列表（System Prompt）:
- 10 个 skill 的索引
- 每个索引 ~30 tokens（名称 + 描述 + 触发场景）
- 总计: ~300 tokens

固定成本，利用 KV Cache，不重复计算
```

**单个 Skill 加载成本：**
```
commit-check skill:
- 工具调用: ~50 tokens
- 内容注入: ~500 tokens
- 总计: ~550 tokens

如果会话有 10 轮，累积成本: 550 × 10 = 5,500 tokens
```

**对比全量加载：**
```
如果把 10 个 skill 全塞进 System Prompt:
- 初始成本: 10 × 500 = 5,000 tokens
- 每轮成本: 5,000 tokens（占用 context）
- 10 轮总成本: 50,000 tokens

按需加载（假设只用 2 个）:
- 索引: 300 tokens
- 加载: 2 × 550 = 1,100 tokens
- 10 轮总成本: (300 + 1,100) × 10 = 14,000 tokens

节省: 72%
```

**延迟分析：**
```
加载 skill 的延迟:
- 读取文件: ~1ms（本地 SSD）
- 工具调用往返: ~200ms（模型推理 + 网络）
- 总延迟: ~200ms

可接受，因为：
1. 只在需要时发生（不是每轮）
2. 相比模型推理时间（1-3s），占比小
3. 可以通过缓存优化
```

## 和后面的关系

Skill 解决了"知识怎么进入系统"。

但有知识不代表能执行好。长任务容易偏航，需要外部规划支架。

这就是 s05 要讲的：**Plan Mode。**

## 三个关键点

**1. 索引在 System Prompt，内容在 tool_result**

索引静态，利用 KV Cache。内容动态，按需注入。

**2. 成本取决于使用率**

使用率 <30%：按需加载更划算。使用率 >70%：固定加载更简单。

**3. Skill Loading ≠ RAG**

RAG 是被动检索知识片段，Skill Loading 是主动加载可执行流程。

---

**Skill Loading 的核心：把知识索引和内容分开，让模型按需加载场景化指导。这不是为了炫技，而是为了在 KV Cache 约束下，最大化 context window 的利用效率。**
