# 记忆系统

> [← 上一篇: 生命周期钩子](./04-hooks.md) | [目录](./README.md) | [下一篇: 技能系统 →](./06-skills.md)

> 记忆系统负责运行时的动态记忆管理：AI 维护的跨会话记忆、会话持久化、文件快照和上下文压缩。

## 在主线中的定位

记忆系统是**运行时机制**，负责：
- AI 自己维护的长期记忆（auto-memory）
- 会话的持久化和恢复
- 文件修改的快照和回退
- 上下文窗口的压缩管理
- Token 使用和成本追踪

**不包括**：
- ❌ CODARA.md 项目配置（这是静态配置，在初始化时加载）
- ❌ rules 规则系统（这应该作为 skill 实现，不是核心机制）
- ❌ skills 内容注入（在 [06-skills](./06-skills.md) 中说明）

---

## 目录

1. [自动记忆（Auto Memory）](#1-自动记忆auto-memory)
2. [会话持久化](#2-会话持久化)
3. [文件检查点系统](#3-文件检查点系统)
4. [上下文压缩](#4-上下文压缩)
5. [Token 追踪与成本计算](#5-token-追踪与成本计算)
6. [子代理记忆](#6-子代理记忆)

---

## 1. 自动记忆（Auto Memory）

### 概念

**自动记忆是 AI 自己维护的跨会话笔记**，用于记住项目特定的模式、偏好和决策。

> **与 Claude Code 对齐**：代理通过标准的 Write/Edit 工具直接操作记忆文件，无需专用 API。系统提示词中告知代理记忆目录路径和使用规范。

### 存储位置

```
~/.codara/projects/{md5-hash}/memory/
  ├── MEMORY.md          # 主索引，始终加载（前 200 行）
  ├── debugging.md       # 主题特定文件
  ├── patterns.md        # 主题特定文件
  └── architecture.md    # 主题特定文件
```

`{md5-hash}` 是 git 根路径的 MD5 哈希的前 12 个字符，为每个项目提供唯一但稳定的目录。

### MEMORY.md — 主索引

`MEMORY.md` 始终被注入对话上下文（前 200 行）。它作为代理的"工作记忆"——关于项目已学到的内容的简洁摘要。

代理通过 Write/Edit 工具直接维护此文件：

```markdown
# 项目记忆

## 技术栈
- Uses Bun instead of npm for package management
- Database migrations are in src/db/migrations/

## 用户偏好
- User prefers functional style over classes
- Commit messages use Chinese

## 架构决策
- API routes follow RESTful conventions
- Error handling uses custom AppError class
```

### 使用规范

代理在使用 Write/Edit 操作记忆文件时，应遵循以下规范（通过系统提示注入）：

**保存什么：**
- ✅ 稳定模式和约定（经过多次交互确认）
- ✅ 关键架构决策、重要文件路径、项目结构
- ✅ 用户偏好（工作流、工具、沟通风格）
- ✅ 反复出现的问题的解决方案和调试见解

**不保存什么：**
- ❌ 会话特定的上下文（当前任务详情、进行中的工作、临时状态）
- ❌ 不完整或未经验证的信息
- ❌ 与 CODARA.md 重复的内容
- ❌ 推测性或未经验证的结论

**组织原则：**
- 按主题语义组织，不按时间顺序
- 保持简洁，200 行上限
- 更新或删除过时的记忆，避免重复
- 详细内容写入主题文件（如 `debugging.md`），MEMORY.md 中索引链接

### 主题文件

对于会使 `MEMORY.md` 膨胀的详细笔记，代理创建主题特定文件，存放在同一 `memory/` 目录下。

主题文件不会自动加载到上下文中。代理在相关时使用 Read 工具显式读取。

**示例：**
```markdown
# MEMORY.md
## 调试经验
详见 [debugging.md](debugging.md) 了解常见问题和解决方案。
```

### 显式用户请求

当用户明确要求记住某事时（如"always use bun"、"never auto-commit"），代理应立即保存到 MEMORY.md，无需等待多次交互验证。

当用户要求忘记某事时，代理应找到并删除相关条目。

---

## 2. 会话持久化

### 存储位置

```
~/.codara/sessions/{uuid}.json
```

每个会话是一个以其 UUID 命名的 JSON 文件。

### 会话数据结构

```json
{
  "id": "abc-123-def-456",
  "createdAt": "2026-03-02T10:00:00.000Z",
  "lastActive": "2026-03-02T11:30:00.000Z",
  "cwd": "/Users/nako/projects/myapp",
  "messages": [
    // 完整对话历史（序列化的 LangChain 消息）
  ],
  "metadata": {
    "totalTurns": 15,
    "totalCostUsd": 0.42,
    "model": "claude-sonnet-4-6",
    "summary": "Implemented user authentication"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | UUID |
| `createdAt` | string | ISO 时间戳 |
| `lastActive` | string | ISO 时间戳，每次保存时更新 |
| `cwd` | string | 会话开始时的工作目录 |
| `messages` | array | 完整对话历史 |
| `metadata.totalTurns` | number | 总轮次 |
| `metadata.totalCostUsd` | number | 总费用 |
| `metadata.model` | string | 使用的模型 |
| `metadata.summary` | string? | 可选的会话描述 |

### 原子写入

为防止崩溃或并发访问导致的数据损坏，会话采用原子写入：

1. 将内容写入临时文件：`{uuid}.json.tmp.{timestamp}`
2. 将临时文件重命名为最终路径：`{uuid}.json`

`rename` 操作在大多数文件系统上是原子的，因此会话文件要么是旧版本，要么是新版本——绝不会是部分写入。

### 路径遍历防护

通过 ID 加载会话时，存储器验证 ID 是否匹配 `^[\w-]+$`（仅限字母数字、下划线、连字符）。这防止了通过精心构造的会话 ID 进行路径遍历攻击。

### 会话列表

`listRecent(limit)` 读取所有会话文件，解析其元数据，并按修改时间排序返回（最新的在前）。默认限制为 20 个会话。

每个条目包含：
- `id` — 会话 UUID
- `lastActive` — ISO 时间戳
- `summary` — 可选描述（如果在元数据中设置）

### 自动清理

`cleanup(keepCount)` 保留最近的 `keepCount` 个会话（默认：100），删除其余会话。会话按文件系统修改时间排序，超出阈值的最旧会话将被移除。

启动时自动触发清理（非阻塞，尽力而为）。

---

## 3. 文件检查点系统

### 工作原理

在任何文件修改（Write 或 Edit）之前，检查点系统会快照原始内容。这使得可以回退到任何先前状态。

**流程：**

1. **创建检查点** — 每个用户提示创建一个新的检查点，带有自增 ID
2. **文件快照** — 在 Write 或 Edit 工具修改文件之前，`snapshotFile(path)` 读取并存储当前内容
3. **去重** — 如果同一文件在当前检查点中已被快照，则不再重复快照（第一次快照捕获修改前的状态）

### 回退

`rewind(checkpointId, mode)` 将文件恢复到目标检查点的修改应用之前的状态。

**回退过程：**
1. 收集从目标检查点到检查点列表末尾的所有文件快照
2. 对于每个文件，取**最早的**快照（任何修改开始之前的状态）
3. 将快照内容写回磁盘
4. 移除目标之后的所有检查点

### 回退模式

| 模式 | 行为 |
|------|----------|
| `code_and_conversation` | 恢复文件并截断对话历史 |
| `code_only` | 恢复文件，保留对话不变 |
| `conversation_only` | 重置对话，保留文件更改 |

### 列出检查点

`list()` 返回所有检查点，包含：
- `id` — 检查点编号
- `prompt` — 创建该检查点的用户提示的前 80 个字符
- `filesChanged` — 被快照的文件数量
- `time` — 创建时间戳

### 示例流程

```
用户: "Refactor the auth module"
  → 创建检查点 #3
  → 代理编辑 src/auth/login.ts  → 已快照（原始内容已保存）
  → 代理编辑 src/auth/guard.ts  → 已快照
  → 代理编辑 src/auth/login.ts  → 未快照（已捕获）

用户: "Actually, revert that"
  → rewind(3, "code_and_conversation")
  → src/auth/login.ts 恢复到编辑前的内容
  → src/auth/guard.ts 恢复到编辑前的内容
  → 检查点 #4+ 被移除
```

---

## 4. 上下文压缩

当对话接近 token 限制时，压缩器收缩上下文以腾出空间继续交互。

### 触发条件

当估计的 token 使用量超过最大 token 容量的 **95%**（默认：200,000 tokens）时触发压缩。

Token 估算使用简单启发式方法：`Math.ceil(content.length / 3.5)` 字符 ≈ 1 token。

### 第一阶段：工具输出截断

第一个也是最经济的压缩策略针对 `ToolMessage` 输出，这通常是对话中最大的消息（文件内容、命令输出、搜索结果）。

对于超过 1,000 个字符的工具输出：
- 保留**前 500 个字符**
- 插入 `\n...[truncated]...\n`
- 保留**后 200 个字符**

这保留了开头（通常是头部、函数签名）和结尾（通常是结果、返回值），同时丢弃中间部分。

### 第二阶段：LLM 摘要

如果第一阶段不够（估计 token 仍超过容量的 60%），压缩器调用 LLM 对较旧的消息进行摘要。

**消息如何分割：**

1. **系统消息**（索引 0）始终保留
2. **最近消息**（最新的一半，最多 20 条）保持原样
3. **较旧消息**（系统消息和最近消息之间的所有内容）发送给 LLM 进行摘要

摘要提示指示 LLM 关注：
- 用户要求了什么任务
- 已完成了什么
- 修改了哪些文件
- 还需要做什么
- 任何重要的决策或约束

摘要限制在 500 字以内。

**生成的消息数组如下：**

```
[SystemMessage]                    ← 原始系统提示
[SystemMessage: compact_boundary]  ← 元数据标记（JSON）
[SystemMessage: summary]           ← "[Context compacted]\n..."
[recent messages...]               ← 保持原样
```

### 压缩边界标记

`compact_boundary` 消息包含有关压缩事件的元数据：

```json
{
  "type": "compact_boundary",
  "trigger": "auto",
  "preTokens": 185234,
  "timestamp": "2026-03-02T10:30:00.000Z"
}
```

`trigger` 字段为 `"auto"` 表示阈值触发的压缩，为 `"manual"` 表示用户显式请求压缩。

### 事件

TUI 层监听压缩事件：

| 事件 | TUI 显示 |
|-------|-------------|
| `compact_start` | "Compacting context..." |
| `compact_end` | "Compaction done: N -> M tokens" |
| `PreCompact` 钩子 | 在压缩开始前触发（用户可配置） |

---

## 5. Token 追踪与成本计算

每次 API 调用的 token 使用量都会被记录，用于成本估算和上下文利用率追踪。

### 使用量记录

每次 API 调用报告 `input_tokens` 和 `output_tokens`。追踪器将这些存储为带时间戳的记录。

### 定价表

使用每模型定价（美元/百万 token）计算成本：

| 模型 | 输入（$/1M） | 输出（$/1M） |
|-------|-------------|---------------|
| Claude Sonnet 4 / 4.6 | $3.00 | $15.00 |
| Claude Opus 4 / 4.6 | $15.00 | $75.00 |
| Claude Haiku 4.5 / 3.5 | $0.80 | $4.00 |
| GPT-4o | $2.50 | $10.00 |
| GPT-4o Mini | $0.15 | $0.60 |
| DeepSeek Chat | $0.14 | $0.28 |

如果归一化后在定价表中找不到模型，则应用 $3/$15（Sonnet 级别）的默认定价。

### 模型名称归一化

模型名称经过多步归一化流水线以匹配定价表：

1. **精确匹配** — 直接尝试原始模型名称
2. **剥离 provider 前缀** — `"anthropic/claude-sonnet-4"` → `"claude-sonnet-4"`
3. **前缀匹配** — `"claude-sonnet-4-6-20250101"` 匹配 `"claude-sonnet-4-6"`
4. **剥离日期后缀** — `"claude-opus-4-20250514"` → `"claude-opus-4"`

这处理了不同 provider 的各种模型名称格式（OpenRouter 添加前缀，API 响应可能包含日期后缀）。

**摘要格式示例**：`"12500 in / 3200 out / $0.0855"`

### 上下文利用率

追踪器可以报告最近一次 API 调用消耗了上下文窗口的百分比。例如 200K 上下文窗口中使用了 75% 返回 `0.75`。

---

## 6. 子代理记忆

子代理可以拥有独立于主代理的跨会话持久化记忆。通过代理定义 frontmatter 的 `memory` 字段声明作用域（详见 [07-代理协作](./07-agent-collaboration.md)）。

### 记忆作用域

| 作用域 | 路径 | 说明 |
|--------|------|------|
| `user` | `~/.codara/agent-memory/{name}/` | 用户级，跨项目共享 |
| `project` | `.codara/agent-memory/{name}/` | 项目级，团队共享 |
| `local` | `.codara/agent-memory-local/{name}/` | 本地，被 gitignore |

其中 `{name}` 为代理名称。

### 与主代理自动记忆的关系

子代理记忆与主代理的自动记忆机制相同：
- 加载 `MEMORY.md` 的前 200 行到上下文
- 代理可通过 Write/Edit 工具更新记忆文件
- 按主题语义组织，避免重复

区别在于路径隔离方式不同：
- **主代理记忆**：按项目哈希隔离（`~/.codara/projects/{hash}/memory/`）
- **子代理记忆**：按代理名称隔离（`~/.codara/agent-memory/{name}/`）

### 作用域组合示例

```markdown
---
name: code-reviewer
memory: user,project
---
```

加载顺序：先 `user` 级，再 `project` 级。后加载的内容补充而非覆盖先加载的内容。

---

## 架构总结

```
                    记忆系统（运行时）

     ┌──────────────────────────────────────┐
     │         Auto Memory                  │
     │  ~/.codara/projects/{hash}/memory/   │
     │  - MEMORY.md (AI 维护)               │
     │  - 主题文件 (按需读取)               │
     └────────────┬─────────────────────────┘
                  │
     ┌────────────▼─────────────────────────┐
     │      Agent Loop（对话）               │
     │  - 每轮创建 checkpoint                │
     │  - 监控 token 使用                    │
     │  - 触发压缩（95% 阈值）               │
     └────────────┬─────────────────────────┘
                  │
      ┌───────────┼───────────┐
      ▼           ▼           ▼
┌──────────┐ ┌─────────┐ ┌──────────┐
│Checkpoint│ │Compactor│ │  Token   │
│ System   │ │         │ │ Tracker  │
│(快照)    │ │(压缩)   │ │(成本)    │
└──────────┘ └─────────┘ └────┬─────┘
                               │
                    ┌──────────▼──────────┐
                    │   Session Store     │
                    │   (持久化)          │
                    └─────────────────────┘
```

**关键点：**
- 记忆系统是**纯运行时机制**
- AI 通过标准工具（Write/Edit/Read）操作记忆文件
- 所有机制都是动态的、自动的
- 不包含静态配置（CODARA.md、rules 等）

---

> [← 上一篇: 生命周期钩子](./04-hooks.md) | [目录](./README.md) | [下一篇: 技能系统 →](./06-skills.md)
