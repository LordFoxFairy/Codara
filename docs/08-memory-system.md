# 记忆系统 — 6 层层级结构与上下文管理

> [← 上一篇: 子代理系统](./07-subagent-system.md) | [目录](./README.md) | [下一篇: TUI 组件 →](./09-tui-components.md)

> 代理"知道"的一切都通过记忆层流转。从管理员控制的系统指令到 AI 维护的项目笔记，每一层在塑造代理行为方面都有独特的作用。

本文档涵盖完整的记忆和上下文管理流水线：指令如何加载、上下文如何在压力下压缩、会话如何持久化、成本如何追踪，以及代理如何维护自己的长期记忆。

---

## 目录

1. [6 层记忆层级](#1-6-层记忆层级)
2. [导入系统](#2-导入系统)
3. [上下文压缩](#3-上下文压缩)
4. [Token 追踪与成本计算](#4-token-追踪与成本计算)
5. [会话持久化](#5-会话持久化)
6. [自动记忆](#6-自动记忆)
7. [文件检查点系统](#7-文件检查点系统)

---

## 1. 6 层记忆层级

所有记忆层由 `MemoryLoader.load(cwd)` 加载，并按优先级顺序注入系统提示。每一层是一个包含 `scope`、`path` 和 `content` 字段的 `MemoryLayer`。

来源：`src/memory/loader.ts`

### 加载顺序

| 层 | 作用域 | 源路径 | 用途 |
|-------|-------|-------------|---------|
| 1. 托管层 | `managed` | `/etc/codeterm/CODETERM.md` | 系统级指令，管理员控制 |
| 2. 用户层 | `user` | `~/.codeterm/CODETERM.md` | 用户全局指令 |
| 2.5 用户规则层 | `rules` | `~/.codeterm/rules/*.md` | 用户规则文件（目录中所有 `.md` 文件） |
| 3. 项目层 | `project` | `{git-root}/CODETERM.md` 或 `{git-root}/.codeterm/CODETERM.md` | 项目共享指令（提交到仓库） |
| 4. 项目本地层 | `local` | `{git-root}/CODETERM.local.md` | 项目本地覆盖（被 gitignore） |
| 5. 项目规则层 | `rules` | `{cwd}/.codeterm/rules/*.md` | 项目特定规则文件 |
| 6. 自动记忆层 | `auto` | `~/.codeterm/projects/{hash}/memory/MEMORY.md` | AI 维护的每项目记忆（前 200 行） |

在 Windows 上，托管层路径为 `%PROGRAMDATA%\codeterm\CODETERM.md` 而非 `/etc/codeterm/CODETERM.md`。

### Git 根目录检测

加载器从当前工作目录向上遍历，检查每个父目录是否有 `.git` 目录。这决定了：

- **在何处停止**查找项目/本地指令文件
- **哪个目录**作为规则和自动记忆的项目根目录

如果未找到 `.git` 目录，则使用当前工作目录作为根目录。

```
/home/user/projects/myapp/src/components/
  └── 向上遍历在 /home/user/projects/myapp/ 找到 .git
      ├── CODETERM.md          → 第 3 层（项目）
      ├── CODETERM.local.md    → 第 4 层（本地）
      └── .codeterm/rules/     → 第 5 层（项目规则）
```

### 项目层向上遍历

第 3 层和第 4 层使用向上遍历策略。从 `cwd` 开始，加载器逐级向上检查每个目录直到 git 根目录：

- **项目文件**（`CODETERM.md`）：在每个目录的两个位置检查 -- 先检查根目录，再检查 `.codeterm/CODETERM.md`。每个目录只加载第一个匹配项。
- **本地文件**（`CODETERM.local.md`）：在每个目录的根目录检查。

结果使用 `unshift` 添加，因此父目录出现在子目录之前的最终层列表中。

### 规则加载

规则文件从 `rules/` 目录加载。支持用户级（`~/.codeterm/rules/`）和项目级（`.codeterm/rules/`）。

- 仅包含 `.md` 文件
- YAML frontmatter（由 `---` 分隔）会被自动剥离
- 每个规则文件成为一个独立的 `MemoryLayer`，作用域为 `rules`

```markdown
---
description: Enforce TypeScript strict mode
globs: ["*.ts", "*.tsx"]
---

Always use strict TypeScript. No `any` types unless explicitly justified.
```

上面的 frontmatter 会被剥离，只有正文内容会被注入。

---

## 2. 导入系统

所有层支持 `@import` 语法来包含其他文件的内容。所有层加载后，每一层的内容都会被处理以解析导入。

来源：`src/memory/loader.ts` — `resolveImports()`

### 语法

```markdown
@./relative/path.md
@../parent/file.md
@~/home-relative/path.md
@some-file.md
```

`@` 前缀触发文件包含。路径可以是：

- **相对路径**（`./`、`../`）— 从文件所在目录解析
- **Home 相对路径**（`~/`）— 从用户主目录解析
- **直接文件名** — 从文件所在目录解析（必须包含文件扩展名，以区分于 `@param` 等注解）

### 深度限制

导入递归解析最深 **5 层**。这防止了循环导入导致的无限递归。在第 5 层，任何剩余的 `@import` 引用保持未解析状态。

### 路径遍历防护

导入路径会针对两个允许的根目录进行验证：

1. 包含导入的文件所在的基目录
2. `~/.codeterm/`

任何解析后落在这两个根目录之外的路径会被静默跳过。这防止了项目指令文件读取任意系统文件。

### 缺失文件

如果导入的文件不存在，导入行被替换为：

```
@path/to/file.md (not found)
```

---

## 3. 上下文压缩

当对话接近 token 限制时，压缩器收缩上下文以腾出空间继续交互。

来源：`src/memory/compactor.ts`

### 触发条件

当估计的 token 使用量超过最大 token 容量的 **95%**（默认：200,000 tokens）时触发压缩。容量和阈值百分比均可通过 `ContextCompactor` 构造函数配置。

```typescript
const compactor = new ContextCompactor(200_000, 95);
// 在 190,000 估计 token 时触发
```

Token 估算使用简单启发式方法：每个 token 约 `Math.ceil(content.length / 3.5)` 个字符。

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
  "timestamp": "2026-02-28T10:30:00.000Z"
}
```

`trigger` 字段为 `"auto"` 表示阈值触发的压缩，为 `"manual"` 表示提供了聚焦提示（例如，用户显式请求压缩并指定特定关注领域）。

### 事件

TUI 层监听压缩事件：

| 事件 | TUI 显示 |
|-------|-------------|
| `compact_start` | "Compacting context..." |
| `compact_end` | "Compaction done: N -> M tokens" |
| `PreCompact` 钩子 | 在压缩开始前触发（用户可配置） |

---

## 4. Token 追踪与成本计算

每次 API 调用的 token 使用量都会被记录，用于成本估算和上下文利用率追踪。

来源：`src/memory/token-tracker.ts`

### 使用量记录

每次 API 调用报告 `input_tokens` 和 `output_tokens`。追踪器将这些存储为带时间戳的记录：

```typescript
tracker.record({ input_tokens: 1500, output_tokens: 350 });
```

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
2. **剥离 provider 前缀** — `"anthropic/claude-sonnet-4"` 变为 `"claude-sonnet-4"`
3. **前缀匹配** — `"claude-sonnet-4-6-20250101"` 匹配 `"claude-sonnet-4-6"`
4. **剥离日期后缀** — `"claude-opus-4-20250514"` 变为 `"claude-opus-4"`

这处理了不同 provider 的各种模型名称格式（OpenRouter 添加前缀，API 响应可能包含日期后缀）。

### 摘要格式

```typescript
tracker.getSummary("claude-sonnet-4");
// → "12500 in / 3200 out / $0.0855"
```

### 上下文利用率

追踪器可以报告最近一次 API 调用消耗了上下文窗口的百分比：

```typescript
tracker.getContextUtilization(200_000);
// → 0.75 (75% of context used)
```

---

## 5. 会话持久化

会话被保存到磁盘，以便后续可以使用 `--resume` 标志恢复。

来源：`src/memory/session-store.ts`

### 存储位置

```
~/.codeterm/sessions/{uuid}.json
```

每个会话是一个以其 UUID 命名的 JSON 文件。

### 会话数据结构

```typescript
interface Session {
  id: string;           // UUID
  createdAt: string;    // ISO 时间戳
  lastActive: string;   // ISO 时间戳，每次保存时更新
  cwd: string;          // 会话开始时的工作目录
  messages: SerializedMessage[];  // 完整对话历史
  metadata: {
    totalTurns: number;
    totalCostUsd: number;
    model: string;
    summary?: string;   // 可选的列表描述
  };
}
```

### 原子写入

为防止崩溃或并发访问导致的数据损坏，会话采用原子写入：

1. 将内容写入临时文件：`{uuid}.json.tmp.{timestamp}`
2. 将临时文件重命名为最终路径

`rename` 操作在大多数文件系统上是原子的，因此会话文件要么是旧版本，要么是新版本 -- 绝不会是部分写入。

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

---

## 6. 自动记忆

代理可以写入跨会话持久化的笔记。这是代理"记住"项目特定模式、偏好和决策的方式。

来源：`src/memory/auto-memory.ts`

### 存储

```
~/.codeterm/projects/{md5-hash}/memory/
  ├── MEMORY.md          ← 主索引，始终加载
  ├── debugging.md       ← 主题特定文件
  ├── patterns.md        ← 主题特定文件
  └── architecture.md    ← 主题特定文件
```

`{md5-hash}` 是 git 根路径的 MD5 哈希的前 12 个字符。这为每个项目提供一个唯一但稳定的目录。

### MEMORY.md — 索引文件

`MEMORY.md` 始终被注入对话上下文（前 200 行）。它作为代理的"工作记忆" -- 关于项目已学到的内容的简洁摘要。

代理通过 `remember(content)`（不指定主题）写入，追加一个要点：

```markdown
- Uses Bun instead of npm for package management
- Database migrations are in src/db/migrations/
- User prefers functional style over classes
```

### 主题文件

对于会使 `MEMORY.md` 膨胀的详细笔记，代理通过 `remember(content, topic)` 写入主题特定文件：

```typescript
autoMemory.remember("Stack trace showed...", "debugging");
// 追加到 ~/.codeterm/projects/{hash}/memory/debugging.md
```

主题文件不会自动加载到上下文中。代理必须在相关时显式读取它们。

### 可用操作

| 方法 | 描述 |
|--------|-------------|
| `remember(content)` | 向 `MEMORY.md` 追加一个要点 |
| `remember(content, topic)` | 追加到 `{topic}.md` |
| `loadIndex()` | 读取 `MEMORY.md`（前 200 行） |
| `loadTopic(topic)` | 读取特定主题文件 |
| `listTopics()` | 列出所有主题文件（不包括 `MEMORY.md`） |

### 代理记忆的内容

代理根据对话上下文决定保存什么。典型条目：

- **稳定模式** — 编码规范、首选工具、项目结构
- **架构决策** — 为什么以某种方式构建
- **用户偏好** — 工作流、沟通风格、工具选择
- **反复出现的解决方案** — 反复出现的问题的修复方法

代理避免保存：
- 会话特定的上下文（当前任务详情、进行中的工作）
- 未经验证或推测性的结论
- 与现有指令文件重复的信息

---

## 7. 文件检查点系统

在任何文件修改（Write 或 Edit）之前，检查点系统会快照原始内容。这使得可以回退到任何先前状态。

来源：`src/agent/checkpoint.ts`

### 工作原理

1. **创建检查点** — 每个用户提示创建一个新的检查点，带有自增 ID
2. **文件快照** — 在 Write 或 Edit 工具修改文件之前，`snapshotFile(path)` 读取并存储当前内容
3. **去重** — 如果同一文件在当前检查点中已被快照，则不再重复快照（第一次快照捕获修改前的状态）

### 回退

`rewind(checkpointId, mode)` 将文件恢复到目标检查点的修改应用之前的状态。

回退过程：
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

## 架构总结

```
                    系统提示组装
                    ┌─────────────────────┐
  /etc/codeterm/    │ 第 1 层: 托管层      │
  ~/.codeterm/      │ 第 2 层: 用户层      │
  ~/.codeterm/rules │ 第 2.5 层: 规则层    │
  {git-root}/       │ 第 3 层: 项目层      │
  {git-root}/       │ 第 4 层: 本地层      │
  .codeterm/rules/  │ 第 5 层: 规则层      │
  ~/.codeterm/      │ 第 6 层: 自动记忆层  │
                    └────────┬────────────┘
                             │
                             ▼
                    ┌─────────────────────┐
                    │    代理循环          │
                    │  （对话）            │
                    └────────┬────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
     ┌──────────────┐ ┌───────────┐ ┌──────────────┐
     │ TokenTracker │ │ Compactor │ │ Checkpoints  │
     │ （成本/利用率）│ │ （收缩）  │ │ （快照）     │
     └──────────────┘ └───────────┘ └──────────────┘
              │
              ▼
     ┌──────────────┐
     │ SessionStore │
     │ （持久化）    │
     └──────────────┘
```
