# 工具

> [← 上一篇: 代理循环](./02-agent-loop.md) | [目录](./README.md) | [下一篇: 生命周期钩子 →](./04-hooks.md)

Codara 的所有工具采用**扁平注册**，统一注册到 ToolRegistry。本文档主要覆盖文件操作类核心工具的参数与行为。协作类工具（AskUserQuestion、TodoWrite、TaskCreate 等）的文档在各自章节中。

## 本章怎么读（教程模式）

### 你会学到什么

- 工具层的职责边界：只定义能力，不定义策略。
- 六类核心工具的参数、行为和边界条件。
- 工具执行链中 hooks/permissions/checkpoint 的插入位置。

### 建议阅读方式

1. 先读「在主线中的定位」和「工具分层」。
2. 再按 `Bash → Read/Write/Edit → Glob/Grep` 顺序阅读核心工具。
3. 最后回看「检查点集成」把写操作回滚链路串起来。

### 完成标志

- 你能判断一个新需求该加新工具、还是在 hooks/permissions 中实现。
- 你能快速识别某个工具调用失败属于参数问题还是策略拦截问题。

### 最小实操

1. 用 Read/Glob/Grep 完成一次只读排查，确认只读工具默认放行行为。
2. 用 Edit 或 Write 执行一次改动，再验证是否触发检查点快照。
3. 用 Bash 执行受限命令，观察是参数错误、权限拒绝还是 hook 拒绝。

### 常见误区

- 把“工具能力定义”和“工具执行策略”写在同一层。
- 误以为工具失败都来自工具实现，忽略了 hooks/permissions 前置拦截。

### 排错清单（症状 -> 排查顺序）

| 症状 | 排查顺序 |
|------|----------|
| Bash 输出异常被截断 | 检查缓冲区和截断规则 -> 检查 timeout 与退出码 |
| Read/Write/Edit 报路径错误 | 检查参数是否为绝对路径 -> 检查文件是否存在/目录是否可写 |
| 同一命令有时成功有时被拒绝 | 检查 hooks 拦截 -> 检查 permissions 规则命中 -> 再看工具参数 |

## 在主线中的定位

工具层只定义“能做什么”，不定义“什么时候该做”。  
后者由 hooks + permissions + skills 共同决定：

- hooks：拦截、拒绝、改写输入（机制）
- permissions：授权求值（策略步骤，附录）
- skills：面向场景的组合与复用（扩展入口）

## 工具分层

| 分层 | 工具 | 来源 | 说明 |
|------|------|------|------|
| **核心工具** | Bash | ToolRegistry 硬注册 | Shell 命令执行 |
| | Read | ToolRegistry 硬注册 | 文件读取 |
| | Write | ToolRegistry 硬注册 | 文件创建/覆写 |
| | Edit | ToolRegistry 硬注册 | 文件精确编辑 |
| | Glob | ToolRegistry 硬注册 | 文件模式搜索 |
| | Grep | ToolRegistry 硬注册 | 内容正则搜索 |
| **协作工具** | AskUserQuestion | ToolRegistry | 交互式问答（通过事件回调与 TUI 通信） |
| | TodoWrite | ToolRegistry | 代理自身进度跟踪（详见 [07](./07-agent-collaboration.md)） |
| | TaskCreate, TaskUpdate, TaskList | ToolRegistry | 持久化任务管理（详见 [07](./07-agent-collaboration.md)） |
| | Task, AgentOutput | ToolRegistry | 从代理生命周期（详见 [07](./07-agent-collaboration.md)） |

所有工具在应用启动时实例化并注册到 ToolRegistry，通过 `model.bindTools()` 绑定到 LLM。

> **与 Claude Code 对齐：** 采用**扁平工具注册**——所有工具（Bash、Read、TodoWrite、TaskCreate、AskUserQuestion 等）以相同方式注册到 ToolRegistry，无分层区分。文件操作类工具（核心工具）和协作类工具的区别仅在于用途，注册和调用机制完全一致。子代理通过工具过滤（排除 Task/AskUserQuestion 等）获得受限工具集。

---

## 工具执行流程

所有工具调用在执行前经过权限检查和钩子拦截。权限检查（deny/ask/allow）、Shell 钩子（PreToolUse/PostToolUse）、文件检查点等拦截逻辑按顺序执行。工具本身只负责"做事"，不关心谁在检查它。完整流程详见 [01-代理循环](./02-agent-loop.md) 的工具执行流程章节。

---

## 核心工具参考

### 1. Bash

执行 Shell 命令，支持持久化工作目录跟踪。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 是 | Shell 命令 |
| `description` | string | 否 | 命令的简要描述 |
| `timeout` | number | 否 | 超时时间（毫秒），默认 120000，最大 600000 |
| `cwd` | string | 否 | 工作目录覆盖 |

#### 行为

- 通过用户的 `$SHELL`（回退到 `/bin/sh`）以 `-c` 标志生成子进程。
- **工作目录跟踪：** 在命令后追加唯一标记。完成后从 stdout 中提取标记并更新内部 `currentCwd`。这使得 `cd` 命令可以跨工具调用持久化，无需维护 Shell 会话。
- **环境变量：** 继承 `process.env`，设置 `TERM=dumb` 以抑制终端控制序列。
- **超时：** 默认 120 秒，上限 600 秒。超时后发送 `SIGTERM`，5 秒后仍存活则发送 `SIGKILL`。输出包含 `[Command timed out]`。
- **输出：** stdout 和 stderr 合并（stderr 前缀为 `STDERR:\n`）。超过 100,000 字符时从中间截断——保留前后各 50K 字符，中间插入 `[truncated N characters]` 标记。
- 非零退出码追加为 `[Exit code: N]`。空输出返回 `(no output)`。

#### 缓冲区限制

| 流 | 限制 |
|--------|-------|
| stdout | 200,000 字符 |
| stderr | 100,000 字符 |
| 最终合并输出 | 截断后 100,000 字符 |

---

### 2. Read

读取文件内容并附带行号。这是 LLM 检查文件的主要方式。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 绝对路径 |
| `offset` | number | 否 | 起始行（从 0 开始） |
| `limit` | number | 否 | 读取行数（默认 2000） |

#### 行为

- 将整个文件读入缓冲区，然后按行范围切片。
- **二进制检测：** 检查前 512 字节是否包含空字节。对二进制文件返回 `"Error: Binary file detected (N bytes): path"`。
- **空文件：** 返回 `"(empty file: path)"`。
- **行格式：** 每行格式为 `{lineNum}│{content}`，行号从 1 开始，右对齐至 6 个字符。超过 2000 个字符的行会被截断并附加 `...`。
- 显式处理 `ENOENT`（文件未找到）和 `EISDIR`（路径为目录）错误。

---

### 3. Write

创建或覆盖文件。父目录会自动创建。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 绝对路径 |
| `content` | string | 是 | 文件内容 |

#### 行为

- 递归创建父目录。
- 以 UTF-8 编码写入内容。
- 返回 `"File written: {path} ({N} lines)"`。
- 写入前由 CheckpointMiddleware 自动创建文件快照（详见 [05-记忆与上下文](./05-memory-system.md)）。

---

### 4. Edit

在文件中执行精确字符串替换。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file_path` | string | 是 | 绝对路径 |
| `old_string` | string | 是 | 要查找的文本 |
| `new_string` | string | 是 | 替换文本 |
| `replace_all` | boolean | 否 | 替换所有匹配项（默认 false） |

#### 行为

- 读取文件，验证 `old_string` 存在，然后执行替换。
- **唯一性检查：** 当 `replace_all` 为 false 时，如果 `old_string` 出现多次，返回错误提示使用 `replace_all: true` 或提供更多上下文。
- **无操作警告：** 如果 `old_string === new_string`，返回警告但不修改文件。
- **未找到：** 返回 `"Error: old_string not found in {path}"`。
- 成功时返回 `"Edited {path}: -{removedLines} +{addedLines} lines"`。
- 编辑前由 CheckpointMiddleware 自动创建文件快照。

---

### 5. Glob

查找匹配 glob 模式的文件，按修改时间排序。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pattern` | string | 是 | glob 模式（例如 `"**/*.ts"`） |
| `path` | string | 否 | 搜索目录（默认为 cwd） |

#### 行为

- 设置 `absolute: true` 和 `dot: false`。
- **默认排除项：** `**/node_modules/**`、`**/.git/**`、`**/dist/**`。
- 结果按 `mtime` 降序排列（最近修改的排在前面）。
- 截断为 200 个结果。如果存在更多匹配，追加 `"... and N more files"`。
- 无匹配时返回 `"No files found matching the pattern."`。

---

### 6. Grep

使用正则表达式搜索文件内容。优先使用 ripgrep，不可用时回退到 grep。

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `pattern` | string | 是 | 正则表达式模式 |
| `path` | string | 否 | 文件或目录（默认为 cwd） |
| `glob` | string | 否 | 文件过滤器（例如 `"*.ts"`） |
| `context` | number | 否 | 匹配上下文行数 |
| `case_sensitive` | boolean | 否 | 默认 false（不区分大小写） |

#### 行为

- **工具选择：** 通过 `which rg` 检查 ripgrep 可用性。结果在工具实例的生命周期内缓存。
- **超时：** 30 秒。发送 `SIGTERM`，5 秒后发送 `SIGKILL`。
- **输出限制：** stdout 缓冲区上限 500,000 字符。输出截断为 500 行，附加 `"... (N more lines)"`。
- 无结果时返回 `"No matches found."`。

---

## 只读工具

以下工具在 `default` 权限模式下免于权限检查：

- **Read** — 文件读取
- **Glob** — 文件搜索
- **Grep** — 内容搜索

在 `plan` 模式下，仅这三个工具自动允许，Bash 需要用户审批，其他所有工具被拒绝。完整的权限模式和规则见 [权限策略附录](./appendix/permissions.md)。

---

## 检查点集成

Write 和 Edit 操作在修改前由 CheckpointMiddleware 触发文件检查点，支持回退到先前状态。

每个用户提示创建一个新检查点。该轮次内的文件修改在更改前被快照。回退时恢复目标检查点以来更改的所有文件。完整机制详见 [05-记忆与上下文](./05-memory-system.md)。

---

> [← 上一篇: 代理循环](./02-agent-loop.md) | [目录](./README.md) | [下一篇: 生命周期钩子 →](./04-hooks.md)
