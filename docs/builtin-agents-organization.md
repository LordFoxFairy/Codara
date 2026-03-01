# 内置代理类型组织方案改进

## 问题分析

**当前方案**（过于零散）：
```
~/.codara/skills/
├── explore/
│   └── agents/Explore.md
├── plan/
│   └── agents/Plan.md
└── general-purpose/
    └── agents/general-purpose.md
```

**问题**：
1. ❌ 三个 skill 目录，每个只有一个 agent 文件
2. ❌ 管理分散，不易维护
3. ❌ 概念混淆：这些不是"技能"，而是"代理类型"

## 改进方案 A：统一内置代理 Skill

### 目录结构

```
~/.codara/skills/
└── builtin-agents/          ← 单一 skill 包含所有内置代理
    ├── SKILL.md
    └── agents/
        ├── Explore.md
        ├── Plan.md
        └── general-purpose.md
```

### SKILL.md

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
```

### 优势

- ✅ 集中管理：所有内置代理在一个 skill 中
- ✅ 概念清晰：这是一个"代理类型集合"skill
- ✅ 易于维护：修改/新增代理只需编辑一个目录
- ✅ 用户可覆盖：创建 `.codara/skills/builtin-agents/` 覆盖全部，或 `.codara/agents/Explore.md` 覆盖单个

## 改进方案 B：完全移除 Skill 包装

### 目录结构

```
~/.codara/agents/            ← 直接放在 agents/ 目录
├── Explore.md
├── Plan.md
└── general-purpose.md
```

### 代理解析顺序

```
1. 项目 standalone agents: .codara/agents/{type}.md
2. 项目 skill agents: .codara/skills/*/agents/{type}.md
3. 用户 standalone agents: ~/.codara/agents/{type}.md  ← 内置代理在这里
4. 用户 skill agents: ~/.codara/skills/*/agents/{type}.md
```

### 优势

- ✅ 最简单：内置代理就是普通的 agent 定义文件
- ✅ 无概念混淆：不需要 skill 包装
- ✅ 易于理解：用户看到 `~/.codara/agents/` 就知道这是代理定义
- ✅ 用户可覆盖：项目/用户 standalone agents 优先级更高

### 劣势

- ⚠️ 与 skill agents 不在同一层级（但这可能是优点，因为它们确实不是 skill）

## 改进方案 C：混合方案

### 目录结构

```
~/.codara/
├── agents/                  ← 内置代理（standalone）
│   ├── Explore.md
│   ├── Plan.md
│   └── general-purpose.md
└── skills/                  ← 内置技能
    ├── commit/
    │   └── SKILL.md
    ├── review-pr/
    │   └── SKILL.md
    └── code-review/         ← 复杂技能可以打包自己的代理
        ├── SKILL.md
        └── agents/
            ├── reviewer.md
            ├── security-checker.md
            └── style-checker.md
```

### 设计理念

**区分两种扩展类型**：

1. **内置代理类型**（Explore/Plan/general-purpose）
   - 定位：通用的代理能力配置
   - 位置：`~/.codara/agents/`（standalone）
   - 特点：轻量、独立、可单独覆盖

2. **内置技能**（commit/review-pr/code-review）
   - 定位：完整的工作流
   - 位置：`~/.codara/skills/`
   - 特点：可打包代理、钩子、脚本等资源

### 优势

- ✅ 概念清晰：代理类型 ≠ 技能
- ✅ 分层合理：简单的代理用 standalone，复杂的工作流用 skill
- ✅ 易于管理：内置代理集中在 `~/.codara/agents/`
- ✅ 灵活扩展：复杂技能可以打包自己的专用代理

## 推荐方案：C（混合方案）

### 理由

1. **概念清晰**：
   - Explore/Plan/general-purpose 是"代理类型"，不是"技能"
   - commit/review-pr 是"技能"，可能需要专用代理

2. **管理简单**：
   - 内置代理：3 个文件在 `~/.codara/agents/`
   - 内置技能：N 个目录在 `~/.codara/skills/`

3. **扩展灵活**：
   - 简单代理：直接添加 `.codara/agents/my-agent.md`
   - 复杂技能：创建 `.codara/skills/my-skill/` 打包所有资源

### 实施步骤

1. **内置代理**：安装时复制到 `~/.codara/agents/`
   ```bash
   cp builtin-agents/*.md ~/.codara/agents/
   ```

2. **内置技能**：安装时复制到 `~/.codara/skills/`
   ```bash
   cp -r builtin-skills/* ~/.codara/skills/
   ```

3. **文档更新**：
   - 07-agent-collaboration.md：内置代理位于 `~/.codara/agents/`
   - 06-skills.md：技能可以打包自己的代理（可选）

## 对比总结

| 方案 | 管理复杂度 | 概念清晰度 | 扩展灵活性 | 推荐度 |
|------|-----------|-----------|-----------|--------|
| A. 统一 builtin-agents skill | 中 | 中（概念混淆） | 中 | ⭐⭐⭐ |
| B. 完全移除 skill 包装 | 低 | 高 | 中 | ⭐⭐⭐⭐ |
| C. 混合方案 | 低 | 高 | 高 | ⭐⭐⭐⭐⭐ |

**最终推荐**：方案 C（混合方案）

- 内置代理类型 → `~/.codara/agents/`（standalone）
- 内置技能 → `~/.codara/skills/`
- 复杂技能可以打包自己的专用代理 → `.codara/skills/*/agents/`
