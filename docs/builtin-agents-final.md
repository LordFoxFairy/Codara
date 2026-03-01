# 内置代理类型组织 - 最终方案

## 核心原则

**"核心通用，领域扩展全靠 Skill"**

Explore、Plan、general-purpose 是领域扩展功能，所以它们**必须是 skills**，不应该硬编码，也不应该创造新的"standalone agents"概念。

## 最终方案：统一的 builtin-agents Skill

### 目录结构

```
~/.codara/skills/
├── builtin-agents/          ← 提供基础代理类型的 skill
│   ├── SKILL.md
│   └── agents/
│       ├── Explore.md
│       ├── Plan.md
│       └── general-purpose.md
├── commit/                  ← 提供 commit 工作流的 skill
│   └── SKILL.md
└── review-pr/               ← 提供 PR 审查工作流的 skill
    └── SKILL.md
```

### builtin-agents/SKILL.md

```markdown
---
name: builtin-agents
description: Built-in agent types for Codara
user-invocable: false
---

This skill provides the default agent types:
- Explore: Fast codebase exploration (read-only, haiku)
- Plan: Software architect (read-only, sonnet)
- general-purpose: Full-capability agent (all tools)

Users can override individual agents by creating:
- .codara/agents/Explore.md (project standalone)
- ~/.codara/agents/Explore.md (user standalone)
```

### 代理解析顺序

```
1. 项目 standalone: .codara/agents/Explore.md
2. 项目 skill agents: .codara/skills/*/agents/Explore.md
3. 用户 standalone: ~/.codara/agents/Explore.md
4. 用户 skill agents: ~/.codara/skills/*/agents/Explore.md
   └─ builtin-agents skill 在这里
```

## 为什么这是正确的方案

### ✅ 符合核心原则

- 所有扩展功能都是 skills（包括 Explore/Plan/general-purpose）
- 没有硬编码
- 没有创造新概念（如"standalone agents"）

### ✅ 集中管理

- 所有内置代理类型在一个 skill 目录中
- 不像之前的方案那样零散（explore/、plan/、general-purpose/ 三个独立目录）
- 易于维护和理解

### ✅ 灵活覆盖

用户可以选择：
1. 覆盖整个 builtin-agents skill：创建 `.codara/skills/builtin-agents/`
2. 覆盖单个代理：创建 `.codara/agents/Explore.md`（优先级更高）

### ✅ 概念清晰

- `builtin-agents` 是一个 skill，它提供基础代理类型
- `commit` 是一个 skill，它提供 commit 工作流
- `review-pr` 是一个 skill，它提供 PR 审查工作流
- 它们都是 skills，只是提供的能力不同

## 扩展方式

### 新增内置代理类型

在 `builtin-agents/agents/` 添加新文件：

```bash
# 添加新的内置代理类型
echo "---
name: Debugger
model: sonnet
tools: Read, Grep, Bash
---
You are a debugging specialist..." > ~/.codara/skills/builtin-agents/agents/Debugger.md
```

### 自定义代理类型

用户可以在自己的项目或用户目录创建：

```bash
# 项目级自定义代理
mkdir -p .codara/agents
echo "..." > .codara/agents/MyAgent.md

# 或者在自己的 skill 中
mkdir -p .codara/skills/my-workflow/agents
echo "..." > .codara/skills/my-workflow/agents/MyAgent.md
```

## 总结

**唯一正确的方案**：统一的 `builtin-agents` skill

- 所有内置代理类型集中在一个 skill 中
- 符合"所有扩展都是 skills"的核心原则
- 集中管理，不零散
- 用户可灵活覆盖

**不应该有的概念**：
- ❌ 硬编码的内置代理类型
- ❌ "standalone agents"作为与 skills 并列的概念
- ❌ 每个代理类型一个独立的 skill 目录
