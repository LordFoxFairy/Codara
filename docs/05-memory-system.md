# 记忆系统

> [← 上一篇: 生命周期钩子](./04-hooks.md) | [目录](./README.md) | [下一篇: 技能系统 →](./06-skills.md)

> 记忆系统负责 Agent 的动态记忆管理：AI 维护的跨会话记忆、会话持久化、文件快照。

## 在主线中的定位

记忆系统是 **Agent 的核心记忆机制**，负责：
- AI 自己维护的长期记忆（MEMORY.md）
- 会话的持久化和恢复
- 文件修改的快照和回退

**不包括**：
- ❌ 上下文压缩（由 SummaryMiddleware 处理）
- ❌ Token 追踪（由 TokenTracker 处理，不是记忆管理）
- ❌ 静态配置（CODARA.md、rules 等在初始化时加载）

## 记忆层契约

| 项 | 契约定义 |
|---|---|
| 输入 | 会话消息、用户/项目上下文、写操作快照触发信号 |
| 输出 | 持久化会话、可复用记忆条目、可回退检查点 |
| 主路径 | 加载记忆 -> 会话推进 -> 增量保存 -> 需要时回退 |
| 失败路径 | 持久化失败、快照缺失、回退目标不存在、数据损坏 |

实现约束：
- 记忆层负责“保存与恢复”，不负责权限与策略决策。
- 记忆条目应保持稳定事实与长期偏好，不记录瞬时任务噪声。
- 写操作快照必须先于内容变更执行，确保可回退。

---

## 目录

1. [自动记忆（MEMORY.md）](#1-自动记忆memorymd)
2. [子代理记忆](#2-子代理记忆)
3. [会话持久化](#3-会话持久化)
4. [文件检查点系统](#4-文件检查点系统)

---

## 1. 自动记忆（MEMORY.md）

### 概念

**MEMORY.md 是 AI 自己维护的跨会话笔记**，用于记住项目特定的模式、偏好和决策。

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
- Database migrations follow the project migration workflow

## 用户偏好
- User prefers functional style over classes
- Commit messages use Chinese

## 架构决策
- API routes follow RESTful conventions
- Error handling uses custom AppError class

## 常见问题
- Auth token 过期时间是 7 天
- 数据库连接池大小设置为 20
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
- ❌ 与 CODARA.md 重复的内容（CODARA.md 是权威来源）
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

## 2. 子代理记忆

子代理可以拥有独立于主代理的跨会话持久化记忆。通过代理定义 frontmatter 的 `memory` 字段声明作用域（详见 [07-代理协作](./07-agent-collaboration.md)）。

### 记忆作用域

| 作用域 | 路径 | 说明 |
|--------|------|------|
| `user` | `~/.codara/agent-memory/{name}/` | 用户级，跨项目共享 |
| `project` | `.codara/agent-memory/{name}/` | 项目级，团队共享 |
| `local` | `.codara/agent-memory-local/{name}/` | 本地，被 gitignore |

其中 `{name}` 为代理名称。

### 与主代理记忆的关系

子代理记忆与主代理的记忆机制相同：
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

## 3. 会话持久化

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
  "messages": [],
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
| `messages` | array | 完整对话历史（序列化的 LangChain 消息） |
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

## 4. 文件检查点系统

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
  → 代理编辑认证入口模块  → 已快照（原始内容已保存）
  → 代理编辑认证守卫模块  → 已快照
  → 代理再次编辑认证入口模块  → 未快照（已捕获）

用户: "Actually, revert that"
  → rewind(3, "code_and_conversation")
  → 认证入口模块恢复到编辑前的内容
  → 认证守卫模块恢复到编辑前的内容
  → 检查点 #4+ 被移除
```

---

## 架构总结

```
                    记忆系统（Agent 核心）

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
     │  - 保存 session                       │
     └────────────┬─────────────────────────┘
                  │
      ┌───────────┴───────────┐
      ▼                       ▼
┌──────────┐         ┌─────────────────┐
│Checkpoint│         │  Session Store  │
│ System   │         │   (持久化)      │
│(快照)    │         └─────────────────┘
└──────────┘
```

**关键点：**
- 记忆系统聚焦于 **Agent 的记忆管理**
- MEMORY.md：AI 维护的跨会话记忆
- Session：会话持久化和恢复
- Checkpoints：文件修改的快照和回退
- 不包含压缩、Token 追踪等其他机制

---

> [← 上一篇: 生命周期钩子](./04-hooks.md) | [目录](./README.md) | [下一篇: 技能系统 →](./06-skills.md)
