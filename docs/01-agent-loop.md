# Agent Loop

> [← 上一篇: 架构概览](./00-architecture-overview.md) | [目录](./README.md) | [下一篇: 模型路由 →](./02-model-routing.md)

Agent 循环是 CodeTerm 的核心执行引擎。它使用**基于 stop-reason 驱动**的架构来驱动用户、LLM 和工具系统之间的对话：每个 LLM 响应都包含一个 `stop_reason`，用于决定下一步操作。

**源文件：**
- `src/agent/loop.ts` — 核心循环、工具执行、错误处理
- `src/agent/events.ts` — 事件类型定义
- `src/agent/system-prompt.ts` — 系统提示词组装

---

## 基于 Stop-Reason 驱动的循环

`AgentLoop` 的核心是 `run()` 方法——一个 `AsyncGenerator<AgentEvent>`，在 Agent 工作时向 TUI 产出事件。内部运行一个 `while (true)` 循环，每次迭代调用 LLM 并检查 `stop_reason` 来决定下一步操作。

### 循环架构

```
用户输入
    |
    v
while (true) {
    1. 安全检查（maxTurns, maxBudget, abort）
    2. 如需要则进行上下文压缩
    3. 流式接收 LLM 响应
    4. 追踪 Token
    5. 检查 stop_reason：
        - "end_turn"    -> 发出 done，返回
        - "tool_use"    -> 执行工具，继续循环
        - "max_tokens"  -> 继续（让 LLM 完成输出）
        - "pause_turn"  -> 继续
        - "refusal"     -> 发出 done(refusal)，返回
        - "model_context_window_exceeded" -> 压缩，继续
        - 其他          -> 发出 done，返回
}
```

### Stop Reason 处理

`stop_reason` 从 `fullResponse.response_metadata?.stop_reason` 中提取。如果缺失，循环会推断：如果响应包含 `tool_calls`，则视为 `"tool_use"`；否则为 `"end_turn"`。

```typescript
const stopReason =
  fullResponse.response_metadata?.stop_reason ??
  (fullResponse.tool_calls?.length ? "tool_use" : "end_turn");
```

| stop_reason | 动作 |
|---|---|
| `end_turn` | 触发 `Stop` 钩子。如果钩子拒绝（退出码 2），继续循环。否则，发出 `done` 事件（原因为 `"complete"`）并返回。 |
| `tool_use` | 执行每个工具调用（包含权限检查、钩子和检查点），然后继续循环让 LLM 看到工具结果。 |
| `max_tokens` | 响应被截断。立即继续循环让 LLM 在下一轮完成输出。 |
| `pause_turn` | 服务端工具循环达到迭代限制。继续。 |
| `refusal` | 模型出于安全原因拒绝了请求。发出 `done` 事件（原因为 `"refusal"`）并返回。 |
| `model_context_window_exceeded` | 上下文窗口已满。触发压缩，然后继续。 |

### 流式响应处理

LLM 响应以流的形式消费。每个分块作为 `text_delta` 事件产出，并拼接成完整的 `AIMessageChunk`：

```typescript
const stream = await this.model.stream(this.messages, {
  signal: this.abortController.signal,
});

for await (const chunk of stream) {
  if (chunk.content) {
    yield { type: "text_delta", text: /* 提取的文本 */ };
  }
  fullResponse = fullResponse
    ? fullResponse.concat(chunk)
    : chunk;
}
```

这为 TUI 提供了实时流式文本，同时构建完整的响应用于消息历史和工具调用提取。

---

## 事件系统

Agent 循环通过定义在 `src/agent/events.ts` 中的 `AgentEvent` 可辨识联合类型与 TUI 通信。循环是一个 `AsyncGenerator<AgentEvent>`，TUI 通过 `for await (const event of loop.run(...))` 消费事件。

### AgentEvent 类型

| 事件 | 描述 | 关键字段 |
|---|---|---|
| `turn_start` | 新的 LLM 轮次即将开始 | `turn: number` |
| `text_delta` | 来自 LLM 流的增量文本 | `text: string` |
| `tool_start` | 工具即将执行 | `tool, input, callId` |
| `tool_end` | 工具执行完成 | `tool, output, isError, callId` |
| `tool_denied` | 工具被阻止（由钩子、权限或用户） | `tool, reason` |
| `permission_request` | 循环需要用户授权才能运行工具 | `tool, input, resolve()` |
| `ask_user` | AskUserQuestion 工具需要用户输入 | `questions[], resolve()` |
| `agent_spawned` | 子 Agent（Task 工具）已启动 | `agentId, name, agentType` |
| `agent_completed` | 子 Agent 已完成 | `agentId, name, success` |
| `compact_start` | 上下文压缩即将开始 | （无） |
| `compact_end` | 上下文压缩已完成 | `preTokens, postTokens` |
| `status_update` | 每次 LLM 调用后的 Token/费用/轮次统计 | `data: StatusData` |
| `done` | 循环已结束 | `reason, content?` |

### 双向事件

两种事件类型携带 `resolve` 回调，在循环和 TUI 之间创建双向通道：

**`permission_request`** — 循环产出此事件并等待 `Promise<PermissionDecision>`。TUI 渲染权限对话框，用户的选择（`allow_once`、`allow_session`、`always_allow` 或 `deny`）解析 Promise，恢复循环执行。

```typescript
let resolvePermission!: (d: PermissionDecision) => void;
const permissionPromise = new Promise<PermissionDecision>((r) => {
  resolvePermission = r;
});

yield {
  type: "permission_request",
  tool: call.name,
  input: effectiveArgs,
  resolve: resolvePermission,
};

const decision = await permissionPromise;
```

**`ask_user`** — 相同模式，由 `AskUserQuestion` 工具使用。工具设置事件处理器，循环产出事件，TUI 收集用户回答。

### StatusData

每次 LLM 调用后，循环产出一个包含以下内容的 `status_update` 事件：

```typescript
interface StatusData {
  model: string;           // 模型的显示名称
  tokensUsed: number;      // 本次会话使用的总 Token 数
  cost: number;            // 估算费用（美元）
  turnsUsed: number;       // LLM 轮次数
  permissionMode?: string; // 当前权限模式
}
```

### Done 原因

`done` 事件包含一个 `reason` 字段，表明循环停止的原因：

| 原因 | 触发条件 |
|---|---|
| `complete` | LLM 返回 `end_turn`（或未知的 stop reason） |
| `max_turns` | 轮次计数器达到 `maxTurns` |
| `max_budget` | Token 费用达到 `maxBudgetUsd` |
| `timeout` | 会话超时 |
| `interrupted` | 用户按下 Esc / 中止信号触发 |
| `refusal` | 模型拒绝了请求 |
| `error` | API 错误（认证失败、限流、网络） |

---

## 系统提示词组装

系统提示词由 `src/agent/system-prompt.ts` 中的 `assembleSystemPrompt()` 构建。它将四个部分用 `---` 分隔符连接起来。

### 1. 基础角色指令

定义 CodeTerm 身份和核心原则的固定提示词：
- 先读后写
- 工具失败不是崩溃
- 简洁，展示代码
- 验证工作，运行测试
- 最小化改动
- 优先使用专用工具而非 Bash 等效物（Read 替代 cat，Edit 替代 sed 等）

### 2. 环境信息

注入到提示词中的运行时上下文：

```
# Environment
- Working directory: /path/to/project
- Platform: darwin
- Shell: zsh
- Git branch: main
- Date: 2026-02-28
- Model: claude-sonnet-4-6
```

Git 分支通过在工作目录中运行 `git branch --show-current` 检测。

### 3. 六层记忆内容

`MemoryLoader` 按优先级顺序从六层加载指令：

| 层级 | 范围 | 路径 | 描述 |
|---|---|---|---|
| 1. Managed | `managed` | `/etc/codeterm/CODETERM.md` | 系统级管理员指令 |
| 2. User | `user` | `~/.codeterm/CODETERM.md` | 用户级指令 |
| 2.5 | `rules` | `~/.codeterm/rules/*.md` | 用户级规则文件 |
| 3. Project | `project` | `CODETERM.md` 或 `.codeterm/CODETERM.md` | 团队共享项目指令（向上查找至 git 根目录） |
| 4. Local | `local` | `CODETERM.local.md` | 个人项目覆盖（已 gitignore） |
| 5. Project rules | `rules` | `.codeterm/rules/*.md` | 项目级规则文件 |
| 6. Auto memory | `auto` | `~/.codeterm/projects/<hash>/memory/MEMORY.md` | Agent 自动写入的持久化记忆（仅前 200 行） |

每层都支持 `@import` 语法来包含其他文件（最多 5 层深度），并有路径遍历保护。

### 4. 技能描述

列出用户可调用的技能，让模型了解 `/command` 快捷方式：

```
# Available Skills
- /commit: Create a git commit with a generated message
- /review-pr: Review a pull request
```

---

## 轮次管理

### 轮次计数器

每次 LLM API 调用都会递增 `turnCount`。循环在每次迭代开始时检查：

```typescript
if (this.turnCount >= this.config.maxTurns) {
  yield { type: "done", reason: "max_turns" };
  return;
}
```

### 预算追踪

`TokenTracker` 记录每次 LLM 响应的 `usage_metadata` 中的输入/输出 Token。费用按已解析的模型 ID 的定价计算。当累计费用达到 `maxBudgetUsd` 时，循环停止：

```typescript
if (this.tokenTracker.getTotalCost(this.resolvedModelId) >= this.config.maxBudgetUsd) {
  yield { type: "done", reason: "max_budget" };
  return;
}
```

### 并发保护

循环通过 `running` 标志防止并发的 `run()` 调用。如果在已运行时调用 `run()`，会立即产出一个带有错误消息的 `done` 事件。

---

## API 错误处理

网络和 API 错误在流式处理块中被捕获，并根据错误类型进行处理：

| 错误 | 可重试 | 行为 |
|---|---|---|
| **401/403**（认证） | 否 | 发出 `done`，消息为 `"Authentication failed"` |
| **429**（限流） | 是，一次 | 等待 5 秒后重试。如果重试也失败，发出 `done`。 |
| **ETIMEDOUT / timeout** | 是，一次 | 立即重试。如果重试也失败，发出 `done`。 |
| **ECONNREFUSED / ENOTFOUND** | 否 | 发出 `done`，消息为 `"Cannot connect to API"` |
| **未知错误** | 否 | 发出 `done`，附带错误消息 |

重试计数器（`apiRetries`）在每次成功的流式传输后重置为 0，重试次数限制为 `MAX_API_RETRIES = 1`。

如果在 API 调用过程中中止信号触发，错误会被捕获并视为中断而非 API 错误。

---

## 上下文压缩

`ContextCompactor` 管理 200K Token 的上下文窗口，当使用量超过 95% 时触发压缩。

### 触发条件

```typescript
// 在主循环中，每次 LLM 调用前：
if (this.compactor.shouldCompact(this.messages)) {
  // 触发压缩
}
```

Token 估算使用简单的启发式方法：每条消息 `Math.ceil(content.length / 3.5)`。

### 阶段 1：裁剪工具输出

超过 1000 字符的 ToolMessage 输出被裁剪为保留前 500 和后 200 字符：

```
[前 500 字符]
...[已截断]...
[后 200 字符]
```

### 阶段 2：LLM 摘要

如果阶段 1 后上下文仍超过 60% 容量，压缩器使用 LLM 对较旧的消息进行摘要：

1. 保留系统消息
2. 将剩余消息分为两部分：较旧的一半用于摘要，较新的一半原样保留
3. 将较旧的消息发送给 LLM，附带摘要提示词
4. 用摘要替换较旧的消息

摘要提示词关注：用户询问了什么、完成了什么、修改了哪些文件、还剩什么、以及关键决策。

### 压缩边界标记

压缩后，会插入一个 `compact_boundary` 标记作为 SystemMessage，包含元数据：

```json
{
  "type": "compact_boundary",
  "trigger": "auto",
  "preTokens": 185000,
  "timestamp": "2026-02-28T10:30:00.000Z"
}
```

### 强制压缩

如果 LLM 返回 `stop_reason: "model_context_window_exceeded"`，压缩会以 `focusHint` 为 `"context_window_exceeded"` 运行，这会自定义摘要提示词。

循环还暴露了 `compactNow()` 方法，供用户手动触发压缩。

---

## 中止 / 中断

### AbortController 集成

循环在构造时创建一个 `AbortController`，并将其 signal 传递给 LLM 的 `stream()` 调用。外部中止信号（例如来自 TUI 的 Esc 键处理器）通过 `options.signal` 参数接入：

```typescript
const abortHandler = () => this.interrupt();
if (options?.signal) {
  options.signal.addEventListener("abort", abortHandler);
}
```

### 中断流程

1. 用户按下 Esc（或其他中断源）
2. 外部信号触发，调用 `this.interrupt()` 进而调用 `this.abortController.abort()`
3. LLM 流抛出异常（在错误处理器中捕获）
4. 错误处理器检测到 `abortController.signal.aborted`，产出 `done` 事件（原因为 `"interrupted"`）
5. 或者，循环顶部的中止检查在下一次 LLM 调用前捕获

### 监听器限制

当 EventTarget 有超过 10 个监听器时，Node.js 会发出警告。由于 LangChain 的 `stream()` 会向 abort signal 添加监听器，循环将限制提升到 100：

```typescript
function setAbortSignalMaxListeners(n: number, signal: AbortSignal): void {
  try {
    const { setMaxListeners } = require("events");
    setMaxListeners?.(n, signal);
  } catch {
    // Node <19 — 忽略（警告仅为外观问题）
  }
}
```

### 清理

`run()` 中的 `finally` 块移除中止事件监听器并重置 `running` 标志，防止内存泄漏：

```typescript
finally {
  this.running = false;
  if (options?.signal) {
    options.signal.removeEventListener("abort", abortHandler);
  }
}
```

`resetAbort()` 方法为中断后的下一个对话轮次创建新的 `AbortController`。

---

## 会话管理

### 会话存储

会话通过 `SessionStore` 持久化到 `~/.codeterm/sessions/<uuid>.json`。每个会话文件包含：

```typescript
interface Session {
  id: string;                // UUID
  createdAt: string;         // ISO 时间戳
  lastActive: string;        // ISO 时间戳
  cwd: string;               // 工作目录
  messages: SerializedMessage[];  // 对话历史
  metadata: {
    totalTurns: number;
    totalCostUsd: number;
    model: string;
    summary?: string;
  };
}
```

### 保存

会话使用临时文件+重命名模式进行原子写入，防止损坏：

```typescript
const tmp = target + `.tmp.${Date.now()}`;
await fs.writeFile(tmp, JSON.stringify(session, null, 2), "utf-8");
await fs.rename(tmp, target);
```

保存发生在 `emitSessionEnd()` 中，该方法在循环因任何原因结束时触发。多模态内容（图片等）由 `JSON.stringify` 处理，它会将复杂的内容数组序列化为字符串。

系统消息不包含在保存的会话中——恢复时会从当前的记忆层重新构建。

### 恢复

当提供 `--resume <session-id>` 参数时，`init()` 加载保存的会话并重建消息历史：

```typescript
if (this.config.resume) {
  const session = await this.sessionStore.load(this.config.resume);
  if (session) {
    for (const msg of session.messages) {
      // 重建 HumanMessage, AIMessage, ToolMessage
    }
    this.turnCount = session.metadata.totalTurns;
  }
}
```

会话 ID 通过 `/^[\w-]+$/` 验证以防止路径遍历。

### 清理

`SessionStore.cleanup(keepCount)` 删除超过阈值（默认：100）的最旧会话，按文件系统修改时间排序。

### 权限持久化

当循环结束时，所有 `always_allow` 权限决策会持久化到 `.codeterm/settings.local.json`：

```typescript
const pendingRules = this.permissions.getPendingPersistRules();
// 合并到 settings.permissions.allow 数组
```

---

## 技能检测

技能是 `/command` 快捷方式，在发送给 LLM 之前会展开为完整的提示词。

### 检测

在 `run()` 开始时，如果用户输入以 `/` 开头，循环会尝试将其解析为技能：

```typescript
if (userInput.startsWith("/")) {
  const parts = userInput.split(/\s+/);
  const skillName = parts[0].slice(1);    // 例如 "commit"
  const skillArgs = parts.slice(1).join(" ");
  const skill = await this.skillLoader.resolve(skillName);
  // ...
}
```

### 展开

如果找到技能，`SkillExecutor` 将其展开为完整的提示词和可选的临时权限规则：

```typescript
const invocation = await this.skillExecutor.expand(skill, skillArgs);
userInput = invocation.expandedPrompt;

// 授予技能所需的临时工具权限
for (const rule of invocation.temporaryAllowRules) {
  this.permissions.addAllow(rule);
}
```

### 非模型技能

部分技能设置了 `disableModelInvocation: true`，意味着它们直接产生输出而不调用 LLM。此时展开的提示词作为 `text_delta` 产出，循环立即返回。

---

## 工具执行管道

当 LLM 返回 `stop_reason: "tool_use"` 时，每个工具调用经过 6 步管道：

### 1. PreToolUse 钩子

钩子引擎触发 `PreToolUse`。钩子可以：
- **允许** — 正常继续
- **拒绝** — 阻止工具，推送拒绝的 ToolMessage，产出 `tool_denied`
- **修改** — 更改工具的输入参数

### 2. 权限检查

`PermissionManager` 根据配置的规则评估工具：
- **允许** — 继续
- **拒绝** — 阻止工具，推送拒绝的 ToolMessage
- **询问** — 产出 `permission_request` 事件并等待用户决策

权限决策：
- `allow_once` — 仅执行此次调用
- `allow_session` — 生成规则并添加到本次会话
- `always_allow` — 生成规则并持久化到 `settings.local.json`
- `deny` — 阻止调用

### 3. 文件检查点

对于 `Write` 和 `Edit` 工具，`CheckpointManager` 在修改前对目标文件进行快照，支持撤销。

### 4. 工具执行

使用（可能已修改的）参数调用工具。`AskUserQuestion` 工具有特殊处理：其事件处理器被连接以通过生成器产出 `ask_user` 事件。

对于 `Task` 工具调用（子 Agent 生成），在执行前后分别发出 `agent_spawned` 和 `agent_completed` 事件。

### 5. PostToolUse 钩子

执行完成后：
- 成功时：触发 `PostToolUse` 钩子
- 失败时：触发 `PostToolUseFailure` 钩子，附带错误信息

### 6. 结果消息

工具结果作为 `ToolMessage` 追加到消息历史中，循环继续到下一次 LLM 调用。

---

## 初始化

`init()` 方法在循环运行前设置所有子系统：

1. **加载记忆层** — `MemoryLoader.load()` 读取全部 6 层
2. **发现技能** — `SkillLoader.discover()` 查找可用的 `/commands`
3. **组装系统提示词** — 组合基础提示词、环境信息、记忆和技能
4. **恢复会话** — 如果设置了 `--resume`，恢复消息和轮次计数
5. **创建模型** — `createModel()` 通过模型路由器初始化 LLM 并绑定工具
6. **触发 SessionStart 钩子** — 通知钩子会话即将开始

模型的显示名称和已解析的模型 ID 在创建后更新，因为模型路由器可能将配置的模型名称映射到不同的提供商/模型。
