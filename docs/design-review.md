# Codara 架构设计审查

## 整体评估

### 设计完整性 ✅

当前文档覆盖了完整的系统架构，每个环节都有详细说明：

1. **00-architecture-overview.md** — 全局架构视图
2. **02-agent-loop.md** — 核心执行循环
3. **01-model-routing.md** — 模型路由与提供商
4. **03-tools.md** — 工具系统
5. **05-permissions.md** — 权限与安全
6. **04-hooks.md** — 中间件与钩子
7. **06-skills.md** — 技能扩展系统
8. **07-agent-collaboration.md** — 代理协作
9. **08-memory-system.md** — 记忆与上下文
10. **09-terminal-ui.md** — 终端界面

### 设计原则一致性 ✅

核心理念贯穿始终：**核心通用，领域扩展全靠 Skill**

- ✅ Middleware 架构统一（6-Hook 模式）
- ✅ 工具扁平注册（ToolRegistry）
- ✅ 技能作为统一扩展单元
- ✅ 资源解析优先级清晰（5 层）
- ✅ 事件驱动的 TUI 集成

---

## 发现的架构不一致性

### 问题：内置从代理类型硬编码

**当前状态**（07-agent-collaboration.md）：

```
内置从代理类型：
- Explore (haiku, 只读)
- Plan (sonnet, 只读)
- general-purpose (继承, 完整工具)

解析顺序：
1. 项目 standalone agents
2. 项目 skill agents
3. 用户 standalone agents
4. 用户 skill agents
5. **内置默认（硬编码）** ← 不一致
```

**问题分析**：

1. **违反"核心通用"原则** — Explore/Plan/general-purpose 是领域功能，不应硬编码在核心
2. **扩展性差** — 新增内置代理类型需要修改核心代码
3. **与 Skill 系统不一致** — commit/init/review-pr 是 skill，为什么 Explore/Plan 不是？
4. **用户无法覆盖内置行为** — 虽然文档说"可以通过创建同名 .codara/agents/Explore.md 覆盖"，但内置定义仍在代码中

### 解决方案：将内置代理类型实现为内置 Skills

**新架构**：

```
内置 Skills（随 Codara 分发）：
~/.codara/skills/
├── explore/
│   ├── SKILL.md
│   └── agents/
│       └── Explore.md
├── plan/
│   ├── SKILL.md
│   └── agents/
│       └── Plan.md
└── general-purpose/
    ├── SKILL.md
    └── agents/
        └── general-purpose.md

解析顺序（统一）：
1. 项目 standalone agents
2. 项目 skill agents
3. 用户 standalone agents
4. 用户 skill agents ← 内置 skills 在这里
5. （无硬编码回退）
```

**优势**：

1. ✅ **架构一致性** — 所有扩展功能都是 skill
2. ✅ **零核心修改扩展** — 新增代理类型只需添加 skill 目录
3. ✅ **用户完全可覆盖** — 用户/项目 skill 自然覆盖内置 skill
4. ✅ **文档即代码** — 内置代理的定义就是 .md 文件，易于理解和修改

---

## 实施方案

### 1. 创建内置 Skills

**~/.codara/skills/explore/SKILL.md**：

```markdown
---
name: explore
description: Fast codebase exploration agent (read-only, haiku model)
user-invocable: false
agent: Explore
---

This skill provides a fast, read-only agent for codebase exploration.
Use it for file searches, code searches, and understanding project structure.
```

**~/.codara/skills/explore/agents/Explore.md**：

```markdown
---
name: Explore
description: Fast codebase exploration. File search, code search, understand structure.
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
model: haiku
permissionMode: auto
maxTurns: 30
---

You are a fast codebase exploration agent. Your job is to:
- Search for files using Glob
- Search code content using Grep
- Read files to understand structure
- Run safe bash commands for analysis

You are READ-ONLY. Never modify files or run destructive commands.
```

**类似地创建 plan/ 和 general-purpose/ skills**。

### 2. 修改代理类型解析逻辑

**当前代码**（伪代码）：

```typescript
function resolveAgentType(subagent_type: string): AgentDefinition {
  // 1-4: 查找自定义定义
  const custom = findCustomAgent(subagent_type);
  if (custom) return custom;

  // 5: 硬编码回退
  if (subagent_type === "Explore") return BUILTIN_EXPLORE;
  if (subagent_type === "Plan") return BUILTIN_PLAN;
  if (subagent_type === "general-purpose") return BUILTIN_GENERAL;

  throw new Error(`Unknown agent type: ${subagent_type}`);
}
```

**新代码**（伪代码）：

```typescript
function resolveAgentType(subagent_type: string): AgentDefinition {
  // 1-4: 查找自定义定义（包括内置 skills）
  const custom = findCustomAgent(subagent_type);
  if (custom) return custom;

  // 无硬编码回退 — 如果找不到就报错
  throw new Error(`Unknown agent type: ${subagent_type}`);
}
```

**关键变化**：

- 移除所有硬编码的内置代理定义
- 内置 skills 通过标准 skill 发现机制加载
- 用户/项目 skills 自然覆盖内置 skills（优先级更高）

### 3. 安装时部署内置 Skills

**安装脚本**（npm postinstall / 首次运行）：

```bash
# 如果 ~/.codara/skills/ 不存在内置 skills，则复制
if [ ! -d ~/.codara/skills/explore ]; then
  cp -r /path/to/codara/builtin-skills/* ~/.codara/skills/
fi
```

**或者**：Codara 启动时检测并自动创建缺失的内置 skills。

### 4. 更新文档

**07-agent-collaboration.md** 修改：

```diff
- ### 内置从代理类型
-
- | 类型 | 只读 | 默认模型 | 描述 |
- |------|------|----------|------|
- | `Explore` | 是 | haiku | 快速代码库探索 |
- | `Plan` | 是 | 继承主 Agent | 软件架构师 |
- | `general-purpose` | 否 | 继承主 Agent | 全能力代理 |

+ ### 内置从代理类型
+
+ Codara 随附三个内置代理类型，作为内置 skills 分发：
+
+ | 类型 | 位置 | 描述 |
+ |------|------|------|
+ | `Explore` | `~/.codara/skills/explore/agents/Explore.md` | 快速代码库探索（只读，haiku） |
+ | `Plan` | `~/.codara/skills/plan/agents/Plan.md` | 软件架构师（只读，sonnet） |
+ | `general-purpose` | `~/.codara/skills/general-purpose/agents/general-purpose.md` | 全能力代理（完整工具） |
+
+ 这些是普通的 skill agents，用户可以通过创建同名 skill 完全覆盖。
```

---

## 其他设计审查发现

### 1. ✅ Middleware 架构 Solid

- 6-Hook 模式清晰
- 优先级系统合理
- 生命周期管理完整

### 2. ✅ 权限系统 Solid

- 三层安全（Hooks → PermissionMiddleware → Skills allowed-tools）
- 权限模式灵活（default / acceptEdits / plan）
- 与 TUI 集成良好

### 3. ✅ 记忆系统 Solid

- 3 层层级清晰（用户 → 项目 → 会话）
- rules 定位明确（模块化规则片段）
- 自动记忆机制合理

### 4. ✅ TUI 设计 Solid

- 底部锚定布局
- `<Static>` 消息滚动方案
- 三种对话框统一设计
- TodoWrite vs Task 渲染区分清晰

### 5. ⚠️ 潜在改进点

#### 5.1 Skills 的 `agent` 字段语义不清

**当前**（06-skills.md）：

```yaml
agent: string  # 用于执行的自定义代理类型
```

**问题**：这个字段的作用是什么？

- 如果是"调用此 skill 时使用的代理类型"，那应该叫 `execution-agent`
- 如果是"此 skill 提供的代理类型"，那应该通过 `agents/` 目录隐式定义

**建议**：

- 移除 `agent` 字段（或重命名为 `execution-agent` 并明确语义）
- Skill 提供的代理类型通过 `agents/` 目录自动发现

#### 5.2 Skill 的 `context` 字段未充分说明

**当前**（06-skills.md）：

```yaml
context: "inline" | "fork"  # 执行上下文模式
```

**问题**：文档中只定义了字段，没有说明两种模式的区别。

**建议**：在 06-skills.md 添加详细说明：

- `inline`：在主 Agent 上下文中执行（默认）
- `fork`：生成从 Agent 执行（隔离上下文）

---

## 总结

### 当前设计质量：8.5/10

**优点**：
- ✅ 架构清晰，文档完整
- ✅ 核心原则一致（Middleware + Skill 扩展）
- ✅ 每个子系统设计 solid

**主要问题**：
- ❌ 内置代理类型硬编码（违反扩展原则）
- ⚠️ 部分字段语义不够清晰

### 改进后设计质量：9.5/10

**实施"内置代理类型 → 内置 Skills"后**：

- ✅ 完全一致的扩展模型
- ✅ 零核心修改即可扩展
- ✅ 用户完全可控
- ✅ 文档即代码

**你的直觉完全正确**：内置代理类型应该是 skills，新增代理类型只需添加一个 skill 目录和 .md 文件。

---

## 实施优先级

### P0（必须）：
1. 将 Explore/Plan/general-purpose 实现为内置 skills
2. 移除代理解析中的硬编码回退
3. 更新 07-agent-collaboration.md 文档

### P1（建议）：
1. 明确 skill 的 `agent` 字段语义
2. 补充 `context: fork` 的详细说明
3. 添加"如何创建自定义代理类型"教程

### P2（可选）：
1. 提供 skill 模板生成器（`codara skill init <name>`）
2. 支持 skill 的版本管理和依赖
3. 建立 skill 市场/仓库
