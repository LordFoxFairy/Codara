# 工具

> [← 上一篇: 模型路由](./02-model-routing.md) | [目录](./README.md) | [下一篇: 权限引擎 →](./04-permissions.md)

CodeTerm 提供 9 个内置工具，供 LLM 调用以与文件系统、Shell、用户和子代理系统进行交互。本文档涵盖每个工具的 Schema、行为和集成点。

## 工具架构

所有工具都继承自 LangChain 的 `StructuredTool` 基类，并通过 Zod schema 定义参数。框架通过注册表模式管理工具，并将其与权限系统和生命周期钩子集成。

### ToolRegistry

`src/tools/registry.ts` — 一个 `Map<string, StructuredTool>` 包装器，按名称存储工具实例。

```typescript
class ToolRegistry {
  register(tool: StructuredTool): void   // 按 .name 添加工具
  get(name: string): StructuredTool      // 按名称检索（不存在时抛出异常）
  has(name: string): boolean
  getAll(): StructuredTool[]             // 以数组形式返回所有工具（传递给 model.bindTools()）
  list(): string[]                       // 工具名称列表
  remove(name: string): boolean
}
```

工具在应用启动时于 `src/index.tsx` 中实例化并注册。完整工具集通过 `model.bindTools(registry.getAll())` 绑定到 LLM，使其在代理循环中可作为函数调用使用。

### 注册顺序

```typescript
// 文件系统工具
agent.toolRegistry.register(new BashTool(cwd));
agent.toolRegistry.register(new ReadTool());
agent.toolRegistry.register(new WriteTool());
agent.toolRegistry.register(new EditTool());
agent.toolRegistry.register(new GlobTool(cwd));
agent.toolRegistry.register(new GrepTool(cwd));

// 代理工具
agent.toolRegistry.register(new TaskTool(appConfig, parentTools, permissionRules, hookConfig, agentManager));
agent.toolRegistry.register(new AgentOutputTool(agentManager));

// 交互工具
agent.toolRegistry.register(new AskUserQuestionTool());
```

---

## 工具参考

### 1. Bash

**源文件：** `src/tools/definitions/bash.ts`

执行 Shell 命令，支持持久化工作目录跟踪。

#### Schema

```typescript
z.object({
  command:     z.string(),                          // 必填 — Shell 命令
  description: z.string().nullable().optional(),    // 命令的简要描述
  timeout:     z.number().nullable().optional(),     // 超时时间（毫秒），默认 120000，最大 600000
  cwd:         z.string().nullable().optional(),     // 工作目录覆盖
})
```

#### 行为

- 通过用户的 `$SHELL`（回退到 `/bin/sh`）以 `-c` 标志生成子进程。
- **工作目录跟踪：** 在命令后追加唯一标记（`__CODETERM_CWD_<timestamp>__=$(pwd)`）。完成后从 stdout 中提取标记并更新内部 `currentCwd`。这使得 `cd` 命令可以跨工具调用持久化，无需维护 Shell 会话。
- **环境变量：** 继承 `process.env`，设置 `TERM=dumb` 以抑制终端控制序列。
- **超时：** 默认 120 秒，上限 600 秒。超时后发送 `SIGTERM`，如果进程 5 秒后仍存活则发送 `SIGKILL`。输出包含 `[Command timed out]`。
- **输出：** stdout 和 stderr 合并（stderr 前缀为 `STDERR:\n`）。如果总输出超过 100,000 个字符，从中间截断 — 保留前后各 50K 字符，中间插入 `[truncated N characters]` 标记。
- 非零退出码追加为 `[Exit code: N]`。空输出返回 `(no output)`。

#### 缓冲区限制

| 流 | 限制 |
|--------|-------|
| stdout | 200,000 字符（MAX_OUTPUT 的 2 倍，以应对 CWD 标记提取） |
| stderr | 100,000 字符 |
| 最终合并输出 | 截断后 100,000 字符 |

---

### 2. Read

**源文件：** `src/tools/definitions/read.ts`

读取文件内容并附带行号。这是 LLM 检查文件的主要方式。

#### Schema

```typescript
z.object({
  file_path: z.string(),                         // 必填 — 绝对路径
  offset:    z.number().nullable().optional(),    // 起始行（从 0 开始）
  limit:     z.number().nullable().optional(),    // 读取行数（默认 2000）
})
```

#### 行为

- 将整个文件读入缓冲区，然后按行范围切片。
- **二进制检测：** 检查前 512 字节是否包含空字节（`0x00`）。对二进制文件返回 `"Error: Binary file detected (N bytes): path"`。
- **空文件：** 返回 `"(empty file: path)"`。
- **行格式：** 每行格式为 `{lineNum}│{content}`，其中 `lineNum` 从 1 开始，右对齐至 6 个字符。超过 2000 个字符的行会被截断并附加 `...`。
- 显式处理 `ENOENT`（文件未找到）和 `EISDIR`（路径为目录）错误。

#### 输出示例

```
     1│import { z } from "zod";
     2│import { StructuredTool } from "@langchain/core/tools";
     3│
     4│export class MyTool extends StructuredTool {
```

---

### 3. Write

**源文件：** `src/tools/definitions/write.ts`

创建或覆盖文件。父目录会自动创建。

#### Schema

```typescript
z.object({
  file_path: z.string(),   // 必填 — 绝对路径
  content:   z.string(),   // 必填 — 文件内容
})
```

#### 行为

- 通过 `fs.mkdir(dir, { recursive: true })` 递归创建父目录。
- 以 UTF-8 编码写入内容。
- 返回 `"File written: {path} ({N} lines)"`。
- 写入前会创建文件检查点（参见[检查点集成](#检查点集成)）。

---

### 4. Edit

**源文件：** `src/tools/definitions/edit.ts`

在文件中执行精确字符串替换。

#### Schema

```typescript
z.object({
  file_path:   z.string(),                          // 必填 — 绝对路径
  old_string:  z.string(),                          // 必填 — 要查找的文本
  new_string:  z.string(),                          // 必填 — 替换文本
  replace_all: z.boolean().nullable().optional(),   // 替换所有匹配项（默认 false）
})
```

#### 行为

- 读取文件，验证 `old_string` 存在，然后执行替换。
- **唯一性检查：** 当 `replace_all` 为 false（默认）时，工具会统计出现次数。如果 `old_string` 出现多次，返回错误：
  `"Error: old_string appears N times in the file. Use replace_all: true or provide more context to make it unique."`
- **无操作警告：** 如果 `old_string === new_string`，返回警告但不修改文件。
- **未找到：** 返回 `"Error: old_string not found in {path}. Make sure the string matches exactly."`
- 成功时返回 `"Edited {path}: -{removedLines} +{addedLines} lines"`。
- 编辑前会创建文件检查点（参见[检查点集成](#检查点集成)）。

---

### 5. Glob

**源文件：** `src/tools/definitions/glob.ts`

查找匹配 glob 模式的文件，按修改时间排序。

#### Schema

```typescript
z.object({
  pattern: z.string(),                          // 必填 — glob 模式（例如 "**/*.ts"）
  path:    z.string().nullable().optional(),    // 搜索目录（默认为 cwd）
})
```

#### 行为

- 使用 `glob` npm 包，设置 `absolute: true` 和 `dot: false`。
- **默认排除项：** `**/node_modules/**`、`**/.git/**`、`**/dist/**`。
- 结果按 `mtime` 降序排列（最近修改的排在前面）。
- 截断为 200 个结果。如果存在更多匹配，追加 `"... and N more files"`。
- 无匹配时返回 `"No files found matching the pattern."`。

---

### 6. Grep

**源文件：** `src/tools/definitions/grep.ts`

使用正则表达式搜索文件内容。优先使用 ripgrep，不可用时回退到 `grep`。

#### Schema

```typescript
z.object({
  pattern:        z.string(),                          // 必填 — 正则表达式模式
  path:           z.string().nullable().optional(),    // 文件或目录（默认为 cwd）
  glob:           z.string().nullable().optional(),    // 文件过滤器（例如 "*.ts"）
  context:        z.number().nullable().optional(),    // 匹配上下文行数
  case_sensitive: z.boolean().nullable().optional(),   // 默认 false（不区分大小写）
})
```

#### 行为

- **工具选择：** 通过 `which rg` 检查 ripgrep 可用性。结果在工具实例的生命周期内缓存。
- **ripgrep 参数：** `-n --no-heading --color never` 加可选的 `--glob`、`-C`、`--ignore-case`。
- **grep 回退参数：** `-rn --color=never` 加可选的 `--include=`、`-C`、`-i`。
- **超时：** 30 秒。发送 `SIGTERM`，5 秒后发送 `SIGKILL`。
- **输出限制：** stdout 缓冲区上限 500,000 字符。输出截断为 500 行，附加 `"... (N more lines)"`。
- 无结果时返回 `"No matches found."`。

---

### 7. Task

**源文件：** `src/tools/definitions/task.ts`

启动子代理 — 执行聚焦任务的隔离 LLM 实例。支持前台（阻塞）和后台（异步）两种执行模式。

#### Schema

```typescript
z.object({
  prompt:            z.string(),                          // 必填 — 任务描述
  subagent_type:     z.string(),                          // 必填 — "Explore"、"Plan"、"general-purpose" 或自定义名称
  name:              z.string().optional(),                // 代理显示名称
  model:             z.string().nullable().optional(),     // 模型覆盖："sonnet"、"opus"、"haiku" 或完整 ID
  max_turns:         z.number().nullable().optional(),     // 最大代理轮次（默认 50）
  description:       z.string().nullable().optional(),     // 简短描述（3-5 个词）
  run_in_background: z.boolean().optional(),               // 异步生成，立即返回 agentId
})
```

#### 内置代理类型

| 类型 | 用途 | 模型 |
|------|---------|-------|
| `Explore` | 快速只读代码库探索 | haiku |
| `Plan` | 软件架构和设计（只读） | 可配置 |
| `general-purpose` | 全能力多步骤任务 | 可配置 |

#### 行为

- **自定义代理：** 从 `.codeterm/agents/*.md` 文件加载。自定义代理定义缓存 30 秒以避免重复文件系统扫描。
- **未知类型：** 返回错误，列出所有可用的代理类型（内置 + 自定义）。
- **代理名称：** 回退至 `input.name ?? input.description ?? agentType`。
- **前台模式**（默认）：同步调用 `spawnSubagent()`。返回代理的摘要。
- **后台模式**（`run_in_background: true`）：通过 `AgentManager.spawn()` 注册。立即返回代理 ID：`"Agent spawned: {name} (id: {id}). Running in background. Use AgentOutput tool with agent_id="{id}" to check results."`
- 子代理不能生成子子代理（防止无限递归）。

---

### 8. AgentOutput

**源文件：** `src/tools/definitions/agent-output.ts`

获取由 Task 工具生成的后台代理的输出。

#### Schema

```typescript
z.object({
  agent_id: z.string(),                // 必填 — 代理 ID 或名称
  block:    z.boolean().default(true),  // 等待完成（默认 true）
})
```

#### 行为

- **未找到：** 返回 `"Agent not found: "{id}". Use Task tool with run_in_background=true to spawn a background agent first."`
- **阻塞模式**（`block: true`，默认）：调用 `agentManager.waitFor(id)`。完成后返回代理的摘要，如果代理失败则返回错误消息。
- **非阻塞模式**（`block: false`）：立即返回当前状态：
  - `running` — `"Agent "{name}" ({id}) is still running..."`
  - `done` — 返回摘要
  - `error` — 返回错误摘要

---

### 9. AskUserQuestion

**源文件：** `src/tools/definitions/ask-user.ts`

通过 TUI 向用户展示交互式问题。用于收集偏好、澄清指令或提供实现方案选择。

#### Schema

```typescript
// 每个选项
const OptionSchema = z.object({
  label:       z.string(),                         // 显示文本（1-5 个词）
  description: z.string(),                         // 选项说明
  markdown:    z.string().nullable().optional(),   // 预览内容（代码片段、ASCII 示意图）
});

// 单个问题
const QuestionSchema = z.object({
  question:    z.string(),                                    // 问题文本
  header:      z.string().nullable().optional(),              // 短标签（最多 12 个字符）
  options:     z.array(OptionSchema).min(2).max(4),          // 2-4 个选项
  multiSelect: z.boolean().nullable().optional(),             // 允许多选（默认 false）
});

// 工具输入
z.object({
  questions: z.array(QuestionSchema).min(1).max(4),  // 1-4 个问题
})
```

#### 行为

- **事件驱动：** 工具本身不渲染 UI。它触发包含问题和 `resolve` 回调的 `AskUserEvent`。代理循环通过 `setEventHandler()` 设置事件处理器，TUI 层接收事件、渲染交互式对话框，并调用 `resolve(answers)` 返回用户的响应。
- **单选：** Tab 切换选项，Enter 提交。
- **多选：** Tab 切换，Space 切换选中状态，Enter 提交。
- **"其他" 选项：** 始终可用 — 允许用户输入自由文本响应。
- **处理器生命周期：** `onAskUser` 回调在每次使用后清除（`this.onAskUser = undefined`），并在下一次调用前由代理循环重新设置。这防止了闭包过期。
- **非交互模式：** 如果没有设置处理器，返回 `"Error: AskUserQuestion is not available in non-interactive mode."`。
- **输出格式：** 返回问答对：
  ```
  Q: What framework should we use?
  A: React

  Q: Include tests?
  A: Yes, unit tests only
  ```

---

## 权限集成

每次工具调用在执行前都会通过 `PermissionManager` 进行检查。检查发生在代理循环（`src/agent/loop.ts`）中 `PreToolUse` 钩子和实际调用之间。

### 权限流程

```
LLM 发出工具调用
  → PreToolUse 钩子（可修改输入或阻止执行）
    → PermissionManager.check(toolName, args)
      → "allow" → 执行工具
      → "ask"   → 提示用户审批
      → "deny"  → 向 LLM 返回错误，跳过执行
        → PostToolUse / PostToolUseFailure 钩子
```

### 只读工具

以下工具在 `default` 模式下免于权限检查：

```typescript
const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);
```

在 `plan` 模式下，仅 `Read`、`Glob`、`Grep` 自动允许，`Bash` 需要用户审批，其他所有工具被拒绝：

```typescript
const PLAN_MODE_TOOLS = new Set(["Read", "Glob", "Grep", "Bash"]);
```

### 权限模式

| 模式 | 只读工具 | Bash | Write/Edit | Task |
|------|----------------|------|------------|------|
| `default` | 允许 | 检查规则 | 检查规则 | 检查规则 |
| `acceptEdits` | 允许 | 检查规则 | 允许 | 检查规则 |
| `plan` | 允许 | 询问 | 拒绝 | 拒绝 |
| `dontAsk` | 允许 | 允许 | 允许 | 允许 |
| `bypassPermissions` | 允许 | 允许 | 允许 | 允许 |

---

## 检查点集成

Write 和 Edit 操作在修改前触发文件检查点，支持回退到先前状态。

### 工作原理

在代理循环中，执行 `Write` 或 `Edit` 之前，循环会调用：

```typescript
if (call.name === "Write" || call.name === "Edit") {
  const filePath = effectiveArgs.file_path ?? effectiveArgs.filePath;
  if (filePath) await this.checkpoint.snapshotFile(filePath);
}
```

`CheckpointManager.snapshotFile()` 读取文件的当前内容（或记录文件不存在），并将快照存储在活动检查点中。回退时，这些快照将文件恢复到修改前的状态。

### 检查点生命周期

1. 每个用户提示创建一个新检查点（`checkpoint.create()`）
2. 该轮次内的文件修改在更改前被快照
3. 回退时恢复目标检查点以来更改的所有文件
4. 目标检查点之后的检查点被丢弃

---

## 生命周期钩子

工具通过三个事件参与钩子系统：

| 钩子 | 时机 | 可修改内容 |
|------|--------|------------|
| `PreToolUse` | 权限检查和执行之前 | 可修改 `input` 参数，可阻止执行 |
| `PostToolUse` | 成功执行之后 | 只读访问结果 |
| `PostToolUseFailure` | 执行失败之后 | 只读访问错误信息 |

钩子处理器接收工具名称、输入参数以及（对于后置钩子）输出或错误。完整事件载荷参见 `src/hooks/types.ts`。
