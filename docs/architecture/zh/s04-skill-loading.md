# s04: Skill Loading

> *"两层注入 — System Prompt 放索引，Tool Result 放内容"*

## 问题

你希望 Agent 遵循特定领域的工作流：git 约定、测试模式、代码审查清单。

全塞进 System Prompt 太浪费 — 10 个技能，每个 2000 token，就是 20,000 token，大部分跟当前任务毫无关系。

而且违反了 s02 的原则：**System Prompt 必须静态**。

## 核心设计

```
System Prompt (Layer 1 — 永远存在):
+--------------------------------------+
| You are a coding agent.              |
| Skills available:                    |
|   - git: Git workflow helpers        |  ~100 tokens/skill
|   - test: Testing best practices     |
+--------------------------------------+

当模型调用 load_skill("git"):
+--------------------------------------+
| tool_result (Layer 2 — 按需):        |
| <skill name="git">                   |
|   Full git workflow instructions...  |  ~2000 tokens
| </skill>                             |
+--------------------------------------+
```

**第一层：** System Prompt 中放技能名称（低成本）
**第二层：** tool_result 中按需放完整内容

## 为什么两层？

### 单层方案的问题

**方案 A：全部放 System Prompt**
- 违反静态原则，KV Cache 失效
- 20k tokens 前置成本，每轮都付费

**方案 B：全部按需加载**
- Agent 不知道有哪些技能可用
- 需要额外的"列出技能"工具

### 两层方案的优势

- **Layer 1 静态** — KV Cache 命中
- **Layer 2 动态** — 只在需要时加载
- **Agent 可发现** — 知道有什么可用

## 技能设计原则

### 1. 可发现

技能描述要让 Agent 知道什么时候用。

```markdown
---
name: git
description: Git workflow — branch naming, commit messages, PR checklist
---
```

### 2. 自包含

技能内容要完整，不依赖外部文档。

```markdown
## Git Workflow

1. Branch naming: `feature/<author>/<description>`
2. Commit messages: `type(scope): description`
3. PR checklist:
   - Tests pass
   - No console.log
   - Updated docs
```

### 3. 可执行

技能是行动指南，不是理论文档。

## 伪代码

```python
# Layer 1: System Prompt
SYSTEM = f"""You are a coding agent.
Skills available:
{skill_loader.get_descriptions()}"""

# Layer 2: Tool
TOOLS = {
    "load_skill": lambda name: skill_loader.get_content(name)
}
```

7 行。索引 + 内容分离。

## 设计权衡

| 选择 | 优点 | 缺点 |
|------|------|------|
| 两层注入 | 静态 + 动态平衡，KV Cache 命中 | 需要两次交互（列表 + 加载） |
| 索引在 System Prompt | Agent 可发现，成本低 | 技能多时索引也会膨胀 |
| 内容在 tool_result | 按需加载，节省成本 | 加载后占用 messages 空间 |
| SKILL.md 文件 | 版本控制，易维护 | 需要文件系统访问 |

## 关键洞察

- **索引 vs 内容分离** — System Prompt 只放索引，保持静态
- **按需加载是性能优化** — 不是所有知识都需要前置
- **技能是领域专长** — 不是通用知识，是特定工作流
- **Agent 自己决定何时加载** — 不是 Harness 强制注入

---

**知识不是越多越好。用到什么，加载什么。**
