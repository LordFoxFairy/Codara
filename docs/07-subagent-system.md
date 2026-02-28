# 子代理系统

> [← 上一篇: 技能系统](./06-skills.md) | [目录](./README.md) | [下一篇: 记忆系统 →](./08-memory-system.md)

CodeTerm 的子代理系统允许主代理将任务委派给独立的子代理。每个子代理运行在完全隔离的上下文窗口中 — 它不继承父代理的对话历史，不能生成自己的子子代理，完成后仅向父代理返回压缩摘要。

**源文件：**

- `src/agent/subagent.ts` — 子代理生成、内置类型、只读强制执行、自定义代理加载
- `src/agent/manager.ts` — 后台代理注册表和生命周期跟踪
- `src/tools/definitions/task.ts` — `Task` 工具（父代理用于生成子代理的 API）
- `src/tools/definitions/agent-output.ts` — `AgentOutput` 工具（获取后台代理结果）

---

## 隔离模型

子代理不是线程 — 每个子代理都运行在自己独立的上下文窗口中。

- **不继承历史。** 子代理从一个全新的 `messages[]` 数组开始。它接收自己的系统提示词、委派提示词（任务描述）、环境信息以及任何适用的 `CODETERM.md` 指令 — 但不包含父对话中的任何内容。
- **不能生成子子代理。** `Task` 工具被排除在子代理的工具注册表之外，防止无限嵌套。
- **仅返回摘要。** 父代理接收子代理输出的压缩摘要，而非完整对话。详细输出在内部保留用于日志记录，但不会呈现给父代理。

这种设计保持父代理上下文窗口的清洁，防止深度嵌套的代理链导致 token 消耗失控。

---

## 内置代理类型

CodeTerm 内置了三种代理类型，定义在 `BUILTIN_AGENTS` 中：

| 类型 | 只读 | 默认模型 | 描述 |
|------|------|----------|------|
| `Explore` | 是 | `haiku` | 快速代码库探索。文件搜索、代码搜索、理解代码库结构。 |
| `Plan` | 是 | 继承 | 用于设计实现方案的软件架构师。 |
| `general-purpose` | 否 | 继承 | 具有所有工具的全能力代理。用于复杂的多步骤任务。 |

**模型解析优先级**（从高到低）：

1. `Task` 工具调用中显式指定的 `model` 参数
2. 自定义代理定义中的 `model` 字段
3. 内置代理类型的默认模型
4. 父代理的模型（回退）

特殊值 `"inherit"` 解析为父代理的模型。所有模型解析都通过中央路由器完成 — 没有硬编码的绕过方式。

---

## 自定义代理定义

自定义代理定义为带有 YAML 前置元数据的 Markdown 文件，从两个目录加载：

1. **项目级别：** `.codeterm/agents/*.md`（优先检查）
2. **用户级别：** `~/.codeterm/agents/*.md`

项目级别的代理会覆盖同名的用户级别代理（通过 `Set<string>` 去重，首次匹配生效）。

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

### 前置元数据结构

| 字段 | 类型 | 必填 | 描述 |
|------|------|------|------|
| `name` | `string` | 否 | 代理名称。默认为去掉 `.md` 扩展名的文件名。 |
| `description` | `string` | 否 | 人类可读的描述，显示在工具列表中。 |
| `tools` | `string[]` 或逗号分隔的 `string` | 否 | 工具白名单。如果设置，仅注册这些工具。如果省略，继承所有父工具（减去排除的工具）。 |
| `disallowedTools` | `string[]` 或逗号分隔的 `string` | 否 | 工具黑名单。这些工具会被添加到拒绝规则中。 |
| `model` | `"sonnet"` \| `"opus"` \| `"haiku"` \| `"inherit"` | 否 | 使用的模型。默认从父代理继承。 |
| `permissionMode` | `string` | 否 | 权限模式覆盖。 |
| `maxTurns` | `number` | 否 | 最大代理轮次。默认为 50。 |
| `skills` | `string[]` 或逗号分隔的 `string` | 否 | 预加载到代理中的技能。 |
| `background` | `boolean` | 否 | 是否默认在后台运行。 |
| `isolation` | `"worktree"` | 否 | 如果设为 `"worktree"`，代理在单独的 git worktree 中运行。 |

Markdown 正文（前置元数据之后的所有内容）成为代理的 `systemPrompt`。当代理被生成时，此系统提示词会以分隔符为前缀附加到任务提示词之前。

---

## 工具继承

子代理继承父代理的 `ToolRegistry`，但有三个强制排除项：

| 排除的工具 | 原因 |
|------------|------|
| `Task` | 防止子子代理生成（无无限嵌套） |
| `AskUserQuestion` | 子代理不能直接与用户交互 |
| `AgentOutput` | 子代理不能查询父代理的后台代理注册表 |

### 额外过滤

- **工具白名单**（自定义代理定义中的 `tools` 字段）：如果指定，仅注册白名单中的工具。其他工具被静默丢弃。
- **工具黑名单**（`disallowedTools` 字段）：每个不允许的工具以 `ToolName(*)` 形式添加到拒绝规则中。
- **只读强制执行**：对于 `Explore` 和 `Plan` 代理（或任何标记为 `readOnly: true` 的内置代理），会应用额外的拒绝规则（见下一节）。

过滤链为：父工具 -> 移除 Task/AskUserQuestion/AgentOutput -> 应用白名单（如果设置）-> 应用黑名单拒绝规则 -> 应用只读拒绝规则（如适用）。

---

## 只读强制执行

标记为 `readOnly: true` 的内置代理（`Explore` 和 `Plan`）会收到拒绝规则，阻止任何文件系统或仓库的修改操作：

**被拒绝的文件操作：**
- `Write(*)` — 不能创建或覆盖文件
- `Edit(*)` — 不能修改现有文件

**被拒绝的破坏性 Bash 命令：**
- `rm`、`mv`、`cp`、`chmod`、`chown`、`mkdir`、`rmdir`、`touch`

**被拒绝的危险 git 操作：**
- `git push*`
- `git reset*`
- `git checkout -- *`

**被拒绝的包管理操作：**
- `npm publish*`
- `npx *`

**允许的（只读 Bash 命令）：**
- `cat`、`ls`、`find`、`grep`、`head`、`tail`、`wc`
- `git status`、`git log`、`git diff`、`git show`、`git branch`
- 任何其他非破坏性命令

子代理的权限请求会被自动拒绝 — 子代理不能显示交互式权限对话框。如果工具调用需要权限且不在允许规则覆盖范围内，会被静默拒绝。

---

## 后台与前台执行

`Task` 工具支持两种执行模式，由 `run_in_background` 参数控制。

### 前台（默认）

```
run_in_background: false（或省略）
```

- 直接调用 `spawnSubagent()` 并 `await` 结果
- 父代理阻塞直到子代理完成
- 将子代理的摘要作为工具结果内联返回
- 流程更简单，适合大多数单任务委派

### 后台

```
run_in_background: true
```

- 通过 `AgentManager.spawn()` 注册代理
- 立即返回代理 ID，不阻塞
- 子代理在父代理继续工作的同时并发运行
- 稍后使用 `AgentOutput` 工具获取结果

后台模式适用于：
- 并行化独立的研究任务
- 不应阻塞父流程的长时间运行代理
- 即发即忘的探索任务

---

## AgentManager

`AgentManager`（位于 `src/agent/manager.ts`）是一个跟踪所有已生成后台代理的注册表。

### 数据模型

```typescript
interface SpawnedAgent {
  id: string;          // UUID
  name: string;        // 用户指定的名称
  type: string;        // 代理类型（如 "Explore"、"Plan"）
  status: "running" | "done" | "error";
  result?: SubagentResult;
  promise: Promise<SubagentResult>;  // 可等待的句柄
}
```

### 关键操作

| 方法 | 描述 |
|------|------|
| `spawn(name, type, options)` | 注册并启动一个后台代理。立即返回 `SpawnedAgent`。如果同名代理正在运行则抛出错误。已完成的同名代理会被替换。 |
| `get(idOrName)` | 通过 UUID 或名称查找代理。未找到时返回 `undefined`。 |
| `getResult(idOrName)` | `get(idOrName)?.result` 的简写。 |
| `list()` | 以数组形式返回所有被跟踪的代理。 |
| `waitFor(idOrName)` | 等待代理的 promise 并返回结果。未找到代理时抛出错误。 |

### 名称冲突解决

- 如果同名代理正在运行，`spawn()` 抛出错误。
- 如果存在已完成或出错的同名代理，该代理会被移除，名称被复用。
- 通过双索引（`Map<id>` + `Map<name -> id>`）同时支持 UUID 和名称查找。

---

## AgentOutput 工具

`AgentOutput` 工具用于从后台代理获取结果：

```typescript
{
  agent_id: string;   // 代理 ID 或名称
  block: boolean;     // 等待完成（默认：true）
}
```

**阻塞模式**（`block: true`，默认）：通过 `AgentManager.waitFor()` 等待代理的 promise，在代理完成时返回摘要。

**非阻塞模式**（`block: false`）：立即返回当前状态：
- `"running"` — 代理仍在工作
- `"done"` — 返回代理的摘要
- `"error"` — 返回错误摘要

---

## 摘要压缩

当子代理完成时，其输出会被压缩为摘要返回给父代理：

1. **优先使用最终响应。** 如果代理产生了最终文本响应（来自 `done` 事件的 `lastContent`），直接使用。
2. **回退到压缩。** 如果没有最终响应，使用 `compressSummary()` 压缩完整输出。

### 压缩算法

```
maxLen = 4000 字符（默认）

if output.length <= maxLen:
    原样返回 output

half = floor(maxLen / 2)
return 前半部分 + "\n\n... [compressed N chars] ...\n\n" + 后半部分
```

压缩保留输出的前 2000 个字符和后 2000 个字符，在中间插入一个标记指示被移除了多少字符。这种方式同时保留了初始上下文和最终结论，同时丢弃中间内容。

---

## Hook 集成

子代理生命周期触发两个 hook，允许外部系统监控或响应子代理活动。

### SubagentStart

在子代理开始执行之前触发。

```typescript
{
  event: "SubagentStart",
  tool: agentType,        // 如 "Explore"、"Plan"
  sessionId: string,      // 子代理的会话 ID
  cwd: string,            // 工作目录
}
```

### SubagentStop

在子代理完成后触发 — **即使出错也一定会触发**。

```typescript
{
  event: "SubagentStop",
  tool: agentType,
  output: string,         // 截断到 1000 字符
  sessionId: string,
  cwd: string,
}
```

`SubagentStop` 负载中的 output 被截断为 1000 字符，以防止 hook 负载过大。

---

## 错误处理

子代理执行期间的错误会被优雅处理，不会导致父代理崩溃：

1. `spawnSubagent()` 函数将 `agent.run()` 包装在 try/catch 中。
2. 如果发生错误，错误消息被追加到 `fullOutput`。
3. `doneReason` 被设为 `"error"`。
4. 无论成功或失败，`SubagentStop` hook 都会触发。
5. 压缩后的摘要（可能包含错误消息）被返回给父代理。

对于由 `AgentManager` 管理的后台代理：

1. promise 的拒绝处理器捕获错误。
2. 构建一个 `success: false` 的错误结果，错误消息作为摘要。
3. 代理的状态被设为 `"error"`。
4. 错误结果被返回（而非重新抛出），以防止未处理的 promise 拒绝。

在两种情况下，父代理都会收到有意义的错误消息，并可以决定如何继续。
