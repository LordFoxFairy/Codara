# 代理协作

> [← 上一篇: 技能系统](./06-skills.md) | [目录](./README.md) | [下一篇: 记忆与上下文 →](./08-memory-system.md)

Codara 的代理架构采用**主从模型（Main Agent + Sub Agent）**。用户启动 Codara 时创建的是**主 Agent（Main Agent）**，它是唯一直接与用户交互的代理实例。主 Agent 可以通过 `Task` 工具生成**从 Agent（Sub Agent）**来并行处理子任务。

每个 Agent 实例（无论主代理还是从代理）都拥有自己的 `MiddlewarePipeline`，中间件栈可按代理类型定制。

> 本文档主要覆盖主从代理之间的委派关系。Team 级别的多代理对等协作见末尾扩展章节。

---

## 主从代理架构

```
用户 ◄──────► 主 Agent (Main Agent)
               │  唯一直接与用户交互的代理
               │  拥有完整工具集 + 完整中间件栈
               │  MiddlewarePipeline: Safety → Session → Memory → Skill → ...
               │
               ├── 从 Agent A (Explore)
               │   独立 Pipeline（精简栈），只读工具，haiku 模型
               │
               ├── 从 Agent B (general-purpose)
               │   独立 Pipeline（完整栈），完整工具（排除 Task/AskUserQuestion）
               │
               └── 从 Agent C (自定义)
                   .codara/agents/researcher.md 定义，Pipeline 按配置定制
```

**关键区分：**

| 维度 | 主 Agent | 从 Agent |
|------|----------|----------|
| **创建时机** | Codara 启动时 | 主 Agent 通过 Task 工具生成 |
| **用户交互** | 直接交互（InputArea、对话框） | 权限请求代理到主 Agent 的 TUI |
| **上下文** | 完整对话历史 | 独立的空白上下文窗口 |
| **工具集** | 全部工具 | 继承但排除 Task/AskUserQuestion/AgentOutput |
| **中间件栈** | 完整（14 个内置中间件） | 按代理类型定制（可精简） |
| **生命周期** | 用户会话 | 任务完成即销毁，返回摘要给主 Agent |
| **嵌套** | 可生成从 Agent | 不能再生成子代理 |

---

## 协作工具与中间件

代理协作由 **SubagentMiddleware**（`wrapToolCall`）和一组**扁平注册的协作工具**共同支撑：

```
┌────────────────────────────────────────────────────────────────┐
│                      SubagentMiddleware                        │
│  钩子: wrapToolCall (priority: 70)                             │
│  职责: 从代理工具过滤、生命周期监控、权限代理                     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  协作工具（扁平注册到 ToolRegistry）：                            │
│                                                                │
│  ┌──────────────────────────┐  ┌───────────────────────────┐   │
│  │  TodoWrite               │  │  TaskCreate / TaskUpdate / │   │
│  │  轻量级执行中进度跟踪      │  │  TaskList / TaskGet        │   │
│  │  代理内部分步跟踪，        │  │  持久化任务管理，            │   │
│  │  会话级，无持久化          │  │  支持依赖管理和多代理协作    │   │
│  └──────────────────────────┘  └───────────────────────────┘   │
│                                                                │
│  两者定位不同：                                                  │
│  TodoWrite 适合单代理内部分步执行的轻量进度跟踪。                  │
│  Task* 适合需要持久化、依赖管理的多代理任务协调。                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

**设计变更：** TodoWrite 和 Task* 是**普通工具**，扁平注册到 ToolRegistry——不需要独立的 TodoMiddleware / TaskMiddleware。SubagentMiddleware 在 `wrapToolCall` 中负责从代理的工具过滤（如从代理不能使用 Task/AskUserQuestion）和生命周期事件。

---

## SubagentMiddleware — 从代理生命周期

SubagentMiddleware（priority: 70）通过 `wrapToolCall` 管理从代理的完整生命周期：生成、隔离、监控、结果收集、权限代理。

### 隔离模型

从代理不是线程——每个从代理运行在自己独立的上下文窗口中。

- **不继承历史。** 从代理从全新的 `messages[]` 开始。它接收自己的系统提示词、任务描述和环境信息，但不包含主 Agent 对话中的任何内容。
- **不能生成子子代理。** `Task` 工具被排除在从代理的工具注册表之外，防止无限嵌套。
- **仅返回摘要。** 主 Agent 接收从代理输出的压缩摘要（默认最大 4000 字符），而非完整对话。

这种设计保持主 Agent 上下文窗口的清洁，防止 token 消耗失控。

### 内置从代理类型

Codara 随附三个内置代理类型，作为 **builtin-agents skill** 分发：

| 类型 | 位置 | 只读 | 默认模型 | 描述 |
|------|------|------|----------|------|
| `Explore` | `~/.codara/skills/builtin-agents/agents/Explore.md` | 是 | haiku | 快速代码库探索。文件搜索、代码搜索、理解代码库结构。 |
| `Plan` | `~/.codara/skills/builtin-agents/agents/Plan.md` | 是 | 继承主 Agent | 软件架构师。设计实现方案，只读。 |
| `general-purpose` | `~/.codara/skills/builtin-agents/agents/general-purpose.md` | 否 | 继承主 Agent | 全能力代理。拥有所有工具，用于复杂多步骤任务。 |

**关键设计**：
- 所有内置代理类型集中在一个 `builtin-agents` skill 中
- 这个 skill 不是用户可调用的（`user-invocable: false`），它只提供代理定义
- 用户可以通过创建 `.codara/skills/builtin-agents/` 覆盖整个 skill
- 或创建 `.codara/skills/my-skill/agents/Explore.md` 覆盖单个代理（项目级优先级更高）

**扩展方式**：
- 新增内置代理类型：在 `builtin-agents/agents/` 添加新的 .md 文件
- 自定义代理类型：在 `.codara/skills/my-skill/agents/` 添加定义

### Task 工具

主 Agent 通过 `Task` 工具生成从代理。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `prompt` | string | 是 | 任务描述 |
| `subagent_type` | string | 是 | 代理类型：`"Explore"`、`"Plan"`、`"general-purpose"` 或自定义名称 |
| `name` | string | 否 | 代理显示名称 |
| `model` | string | 否 | 模型覆盖：`"sonnet"`、`"opus"`、`"haiku"` 或完整 ID |
| `max_turns` | number | 否 | 最大代理轮次（默认 50） |
| `description` | string | 否 | 简短描述（3-5 个词） |
| `run_in_background` | boolean | 否 | 异步生成，立即返回代理 ID |

### AgentOutput 工具

获取后台代理的执行结果。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `agent_id` | string | 是 | 代理 ID 或名称 |
| `block` | boolean | 否 | 等待完成（默认 true） |

- **阻塞模式**（默认）：等待代理完成后返回摘要。
- **非阻塞模式**：立即返回当前状态（running / done / error）。

### 前台与后台执行

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| **前台**（默认） | `run_in_background` 省略或为 false | 主 Agent 阻塞直到从代理完成，摘要作为工具结果内联返回 |
| **后台** | `run_in_background: true` | 立即返回代理 ID，从代理并发运行，稍后用 AgentOutput 获取结果 |

后台模式适用于并行化独立研究任务、长时间运行的探索或不应阻塞主 Agent 流程的工作。

### 模型解析优先级

从代理的模型按以下优先级确定（从高到低）：

1. Task 工具调用中显式指定的 `model` 参数
2. 自定义代理定义中的 `model` 字段
3. 内置代理类型的默认模型
4. 主 Agent 的模型（回退）

特殊值 `"inherit"` 解析为主 Agent 的模型。所有解析通过中央路由器完成，详见 [02-模型路由](./01-model-routing.md)。

### 工具继承

从代理继承主 Agent 的 ToolRegistry，但有三个强制排除项：

| 排除的工具 | 原因 |
|------------|------|
| `Task` | 防止嵌套生成（无无限递归） |
| `AskUserQuestion` | 从代理不能直接与用户交互 |
| `AgentOutput` | 从代理不能查询主 Agent 的后台代理注册表 |

过滤链：主 Agent 工具 → 移除 Task/AskUserQuestion/AgentOutput → 应用白名单（如设置）→ 应用黑名单拒绝规则 → 应用只读拒绝规则（如适用）。

### 只读强制执行

`Explore` 和 `Plan` 从代理收到额外 deny 规则，阻止文件系统和仓库修改：

- **文件操作：** Write(\*)、Edit(\*)
- **破坏性 Bash：** rm、mv、cp、chmod、chown、mkdir、rmdir、touch
- **危险 git 操作：** git push\*、git reset\*、git checkout -- \*
- **包管理：** npm publish\*、npx \*

从代理的权限请求**会传递到主 Agent 的交互层**——当从代理的工具调用触发权限检查时，权限对话框在主 Agent 的 TUI 中显示，用户审批后结果返回给从代理。这与 Claude Code 的行为一致：子代理不直接拥有 TUI，但其权限请求通过父代理的交互基础设施处理。

### 摘要压缩

当从代理完成时，其输出按以下方式压缩：

1. 优先使用最终响应（来自 `done` 事件的最后内容）
2. 如果没有最终响应，压缩完整输出：保留前 2000 + 后 2000 字符，中间插入 `[compressed N chars]` 标记

### 生命周期事件

SubagentMiddleware 在 `wrapToolCall` 中触发从代理生命周期事件：

| 事件 | 时机 | 数据 |
|------|------|------|
| `agent_spawned` | 从代理开始执行前 | 代理类型、会话 ID、工作目录 |
| `agent_completed` | 从代理完成后（含出错） | 代理类型、输出（截断到 1000 字符）、会话 ID |

Shell 钩子可通过 `settings.json` 配置 `SubagentStart` / `SubagentStop` 事件来响应从代理生命周期。

### 错误处理

从代理执行期间的错误被优雅处理，不会导致主 Agent 崩溃。错误消息被包含在摘要中返回给主 Agent。对于后台代理，promise 的拒绝处理器捕获错误，代理状态标记为 `"error"`，错误结果被返回（而非重新抛出）。

---

## TodoWrite — 轻量级执行中进度跟踪

TodoWrite 是一个**普通工具**（扁平注册到 ToolRegistry），让代理跟踪自己的工作进度。

**定位：** 轻量级的执行中进度跟踪，适合单代理在处理复杂任务时将工作分步可视化。状态存储在内存中，会话级生命周期，无磁盘持久化。每个代理有自己独立的 TODO 列表。

### TodoWrite 工具

代理通过 `TodoWrite` 管理自己的 TODO 列表。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `todos` | array | 是 | TODO 项目数组 |

每个 TODO 项目包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 唯一标识 |
| `content` | string | 任务描述 |
| `status` | string | `"pending"` / `"in_progress"` / `"completed"` |

### 工作流

1. 代理收到复杂任务时，先用 `TodoWrite` 创建待办列表
2. 开始某项工作时，将对应项标为 `in_progress`
3. 完成后标为 `completed`
4. TUI 实时显示 TODO 进度条

### TUI 进度展示

TodoWrite 状态通过事件推送到 TUI，渲染进度指示器：

```
⬡ 分析项目结构
◉ 重写工具文档          ← 当前进行中
⬡ 更新导航链接
✓ 创建任务列表
```

这使用户能直观了解代理当前的工作阶段，无需阅读完整输出。

---

## Task* 工具 — 持久化任务管理与协调

TaskCreate、TaskUpdate、TaskList、TaskGet 是**普通工具**（扁平注册到 ToolRegistry），提供磁盘持久化的任务管理系统，支持任务创建、状态更新、依赖管理和多代理协作。

### TaskCreate 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subject` | string | 是 | 任务标题（祈使语气） |
| `description` | string | 是 | 详细描述 |
| `activeForm` | string | 否 | 进行中的展示文本（现在进行时，例如 `"Running tests"`） |

新创建的任务状态为 `pending`，无 owner。

### TaskUpdate 工具

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `taskId` | string | 是 | 任务 ID |
| `status` | string | 否 | `"pending"` / `"in_progress"` / `"completed"` / `"deleted"` |
| `owner` | string | 否 | 任务负责人（代理名称） |
| `addBlocks` | string[] | 否 | 此任务阻塞的其他任务 |
| `addBlockedBy` | string[] | 否 | 阻塞此任务的前置任务 |

### TaskList 工具

无参数。返回所有任务的摘要，包括 ID、标题、状态、负责人和依赖关系。

### 协作模式

```
主 Agent                          从 Agent
  │                                 │
  ├─ TaskCreate(任务A)              │
  ├─ TaskCreate(任务B)              │
  ├─ Task(生成从代理)  ────────────▶│
  │                                 ├─ TaskList() → 发现可用任务
  │                                 ├─ TaskUpdate(任务A, in_progress)
  │                                 ├─ ...执行任务A...
  │                                 ├─ TaskUpdate(任务A, completed)
  │                                 ├─ TaskUpdate(任务B, in_progress)
  │                                 ├─ ...执行任务B...
  │                                 ├─ TaskUpdate(任务B, completed)
  │  ◀────────────────────────────  ├─ 返回结果
  ├─ TaskList() → 查看进度          │
```

### 依赖管理

任务之间可以声明依赖关系：

- `addBlocks`：标记此任务完成后才能开始的下游任务
- `addBlockedBy`：标记此任务启动前必须完成的上游任务

被阻塞的任务（`blockedBy` 非空）不应被认领，直到其所有前置任务完成。

### Todo vs Task 对比

| 维度 | TodoWrite | TaskCreate/Update/List |
|------|-----------|------------------------|
| **定位** | 轻量级执行中进度跟踪 | 持久化任务管理与协调 |
| **存储** | 内存（会话级） | 磁盘持久化（`~/.codara/tasks/`） |
| **作用域** | 单代理内部 | 跨代理共享 |
| **依赖管理** | 无 | 支持 `addBlocks` / `addBlockedBy` |
| **典型场景** | 代理将复杂任务分步可视化 | 多代理协作、任务分派与跟踪 |
| **TUI 展示** | 进度条 | 任务列表（含负责人/状态） |

> **业界参考：** Claude Code 中 `TodoWrite` 和 `Task*` 是两个独立系统——前者是旧的内存 checklist（半弃用），后者是新的磁盘持久化系统。两者并非"本地 vs 共享"的因果关系，而是不同阶段的产物。Codara 保留两者，但重新定义了它们的分工：TodoWrite 专注轻量进度展示，Task* 专注持久化协调。

两者可以组合使用：子代理内部用 TodoWrite 跟踪执行一个 Task 的细节步骤。

---

## 从代理类型解析

`subagent_type` 是一个**查找键**，不是硬编码的枚举。解析顺序：

1. **项目 skill agents**：`.codara/skills/*/agents/{subagent_type}.md` → 项目技能中的代理定义（最高优先级）
2. **用户 skill agents**：`~/.codara/skills/*/agents/{subagent_type}.md` → 用户技能中的代理定义（**builtin-agents skill 在这里**）

内置类型（Explore、Plan、general-purpose）位于 `builtin-agents` skill 中（`~/.codara/skills/builtin-agents/agents/*.md`）。它们和自定义代理没有区别——只是预配置了工具集、模型和系统提示词。

**统一 Skills 原则**：
- ✅ 所有代理定义都在 skills 中（`.codara/skills/*/agents/` 或 `~/.codara/skills/*/agents/`）
- ❌ 不存在 standalone agents 路径（如 `.codara/agents/` 或 `~/.codara/agents/`）
- ✅ 项目级 skill agents 覆盖用户级 skill agents
- ✅ 易于维护：所有扩展功能统一在 skills 目录下

**无硬编码回退**：如果在上述 2 个位置都找不到代理类型，系统会报错，而不是回退到硬编码定义。这确保了所有代理类型都是可见、可覆盖的。

### 内置类型预配置

内置代理类型的默认配置（位于 `~/.codara/skills/builtin-agents/agents/*.md`）：

| 类型 | 模型 | 工具集 | 特殊规则 |
|------|------|--------|---------|
| `Explore` | haiku | 只读（Read, Grep, Glob, Bash） | deny Write/Edit + 破坏性命令 |
| `Plan` | sonnet | 只读 + 分析 | deny Write/Edit |
| `general-purpose` | 继承主 Agent | 完整（排除 Task/AskUserQuestion） | 无额外限制 |

---

## 自定义代理定义

自定义代理定义为带有 YAML 前置元数据的 Markdown 文件，从两个位置加载（按优先级顺序）：

1. **项目 skill agents：** `.codara/skills/*/agents/*.md`（最高优先级）
2. **用户 skill agents：** `~/.codara/skills/*/agents/*.md`

同名代理按优先级覆盖。所有代理定义必须在 skills 中，不存在 standalone agents 路径。

### 文件格式

```markdown
---
name: my-researcher
description: Searches documentation and summarizes findings
tools: Read, Grep, Glob, Bash
disallowedTools: Write, Edit
model: haiku
permissionMode: auto
maxTurns: 30
skills: search-docs
background: true
isolation: worktree
---

You are a documentation researcher. Your job is to find and summarize
relevant information from the codebase and external docs.

Always cite file paths and line numbers in your findings.
```

### 前置元数据字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 否 | 代理名称。默认为文件名（去掉 `.md`） |
| `description` | string | 否 | 人类可读的描述，显示在工具列表中 |
| `tools` | string 或逗号分隔列表 | 否 | 工具白名单。省略则继承所有父工具 |
| `disallowedTools` | string 或逗号分隔列表 | 否 | 工具黑名单，以 deny 规则添加 |
| `model` | string | 否 | 使用的模型（`"sonnet"` / `"opus"` / `"haiku"` / `"inherit"`） |
| `permissionMode` | string | 否 | 权限模式覆盖 |
| `maxTurns` | number | 否 | 最大代理轮次（默认 50） |
| `skills` | string 或逗号分隔列表 | 否 | 预加载的技能 |
| `background` | boolean | 否 | 是否默认在后台运行 |
| `isolation` | string | 否 | `"worktree"` 则在单独的 git worktree 中运行 |

Markdown 正文成为代理的系统提示词，在生成时附加到任务描述之前。

### 自定义代理缓存

自定义代理定义缓存 30 秒以避免重复文件系统扫描。

---

## 从代理的 MiddlewarePipeline

每个从代理实例化时根据类型配置自己的中间件栈：

```
主 Agent Pipeline（完整栈）:
  Safety(5) → Session(10) → Memory(15) → Skill(20) → Compression(25)
  → Retry(30) → Metrics(35) → Disclosure(40) → Permission(50)
  → ShellHook(55) → Guardrail(60) → Checkpoint(65) → Subagent(70) → Audit(90)

从 Agent Pipeline（按类型定制）:
  Safety(5) → Compression(25) → Retry(30) → Permission(50, 代理到主 TUI)
  → ShellHook(55) → Guardrail(60) → Checkpoint(65) → Audit(90)
  // 跳过: Session, Memory, Skill, Disclosure, Subagent, Metrics
```

从代理的 `PermissionMiddleware` 通过主 Agent 的事件通道代理权限请求——从代理不直接拥有 TUI，但其权限对话框在主 Agent 的 TUI 中显示。

完整的中间件清单详见 [05-中间件与钩子](./04-hooks.md)。

---

## 扩展：Team 级别协作

当前文档主要覆盖 subagent 级别的主从委派关系。业界已出现 Team 级别的多代理对等协作模式：

- **Claude Code Agent Teams**：通过 `TeamCreate` 创建团队，多个代理通过共享任务列表和消息系统协作，代理间可直接通信（`SendMessage`），支持广播、关闭请求等协议
- **协作模式**：团队有 leader 和 teammates 角色，leader 分派任务，teammates 认领并执行，通过 idle/message 机制协调

Codara 的 Middleware 架构为 Team 级别协作预留了扩展空间：Task* 工具的磁盘持久化天然支持多代理并发访问，SubagentMiddleware 的生命周期管理可扩展为对等代理管理。未来可实现 `TeamMiddleware`，提供代理发现、消息路由和团队生命周期管理。

---

> [← 上一篇: 技能系统](./06-skills.md) | [目录](./README.md) | [下一篇: 记忆与上下文 →](./08-memory-system.md)
