# CodeTerm — AI Code Terminal 设计文档

> 一个类 Claude Code 的终端 AI 编程助手，基于 init_chat_model + 手写 while 循环 + Ink 构建

## 目录

1. [架构概览](#1-架构概览)
2. [Agent Loop — 核心循环](#2-agent-loop)
3. [Tool System — 工具系统](#3-tool-system)
4. [Bash Executor — 命令执行器](#4-bash-executor)
5. [Hooks — 生命周期钩子](#5-hooks)
6. [Skills — 可扩展技能](#6-skills)
7. [Memory — 上下文与记忆](#7-memory)
8. [TUI — 终端界面](#8-tui)
9. [项目结构](#9-项目结构)
10. [技术栈](#10-技术栈)

---

## 1. 架构概览

### 1.1 设计哲学

> Claude Code 是 Claude 模型的 **harness**（执行框架）。
> 智能来自模型，能动性来自框架。框架提供工具、上下文管理和执行环境。

核心原则：
- **stop_reason 驱动**: 循环逻辑由 LLM 的 stop_reason 决定，不是手动判断
- **一切可组合**: Tools、Permissions、MCP、Subagents、Skills、Hooks 独立配置
- **纵深防御**: Permissions (工具级) + Hooks (自定义验证) + Sandbox (OS 级)
- **上下文是约束**: Subagents、压缩、按需加载，都是为了管理有限的上下文窗口

### 1.2 系统分层

```
┌──────────────────────────────────────────────────────┐
│                    TUI Layer (Ink)                    │
│  ┌──────────┐ ┌───────────┐ ┌───────┐ ┌───────────┐ │
│  │InputArea │ │StreamOutput│ │StatusBar│ │PermPrompt│ │
│  └──────────┘ └───────────┘ └───────┘ └───────────┘ │
├──────────────────────────────────────────────────────┤
│         Agent Loop (while + stop_reason 驱动)         │
│  ┌────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ LLM Stream │→ │ stop_reason │→ │ ToolExecutor  │  │
│  │ (initChat) │  │  判定器      │  │ + Checkpoint  │  │
│  └────────────┘  └─────────────┘  └───────────────┘  │
├──────────────────────────────────────────────────────┤
│                   Core Services                       │
│  ┌──────┐ ┌──────┐ ┌────────┐ ┌──────┐ ┌──────────┐ │
│  │Hooks │ │Skills│ │ Memory │ │Perms │ │Checkpoint│ │
│  └──────┘ └──────┘ └────────┘ └──────┘ └──────────┘ │
├──────────────────────────────────────────────────────┤
│              Tool Implementations                     │
│  ┌──────┐ ┌──────┐ ┌─────┐ ┌────┐ ┌────┐ ┌───────┐ │
│  │ Bash │ │ Read │ │Write│ │Edit│ │Glob│ │  MCP  │ │
│  └──────┘ └──────┘ └─────┘ └────┘ └────┘ └───────┘ │
├──────────────────────────────────────────────────────┤
│          Subagent Layer (src/agent/subagent.ts)       │
│  ┌─────────┐ ┌──────┐ ┌─────────────────┐           │
│  │ Explore │ │ Plan │ │ General-purpose │           │
│  │ (haiku) │ │ (R/O)│ │ (full tools)    │           │
│  └─────────┘ └──────┘ └─────────────────┘           │
│  + Custom agents (.codeterm/agents/*.md)             │
└──────────────────────────────────────────────────────┘
```

### 1.3 数据流 (stop_reason 驱动)

```
用户输入 → TUI.InputArea → 追加到 messages[]
  │
  ▼
while (true):
  │
  ├─ 安全阀检查 (maxTurns / maxBudget / timeout)
  ├─ 上下文压缩检查 (@95% → auto compact)
  │
  ├─ model.stream(messages) → 流式输出到 TUI
  │
  ├─ 检查 stop_reason:
  │   │
  │   ├─ "end_turn" → 循环结束，等待下一次用户输入
  │   │
  │   ├─ "tool_use" →
  │   │   ├─ Hooks.PreToolUse(tool, input)
  │   │   ├─ Permissions.check(tool, input)
  │   │   │   ├─ 匹配 allow 规则 → 自动放行
  │   │   │   ├─ 匹配 deny 规则 → 拒绝，返回 is_error
  │   │   │   └─ 无匹配 → TUI 弹窗确认
  │   │   ├─ Checkpoint.snapshot(affected_files)
  │   │   ├─ ToolExecutor.run(tool, input)
  │   │   │   ├─ 成功 → tool_result
  │   │   │   └─ 失败 → tool_result { is_error: true }
  │   │   ├─ Hooks.PostToolUse(tool, result)
  │   │   └─ 追加 AIMessage + ToolMessages 到 messages[]
  │   │   └─ continue (回到 while 顶部)
  │   │
  │   ├─ "max_tokens" → 处理截断，可能继续
  │   │
  │   └─ "error" → 报告错误
  │
  └─ 更新 StatusBar (tokens, cost, turns)
```

<!-- SECTION_END: architecture -->

---

## 2. Agent Loop

> 参考 Claude Code 核心循环：stop_reason 驱动 + while 循环 + initChatModel

### 2.1 核心理念

Agent Loop 是系统的心脏。参考 Claude Code 的三阶段模式：
**gather context → take action → verify results**

关键设计决策：
- **stop_reason 驱动**：循环由 LLM 返回的 stop_reason 决定下一步，不是手动检查 tool_calls
- **工具失败不崩溃**：失败的 tool 返回 `is_error: true`，LLM 自行决定重试或换方案
- **file checkpoint**：执行文件修改前自动快照，支持 rewind
- **system-reminder**：在 tool_result 和 user message 中注入上下文提醒

### 2.2 stop_reason 语义

> 参考 Claude Code: 循环逻辑完全由 LLM 的 stop_reason 决定

| stop_reason | 含义 | Agent 行为 |
|-------------|------|-----------|
| `"end_turn"` | LLM 认为任务完成 | 结束循环，显示回复，等待用户输入 |
| `"tool_use"` | LLM 想调用工具 | 执行工具，追加结果，continue 循环 |
| `"max_tokens"` | 输出被截断 | 可能需要继续（发一个空消息让它接着说） |
| `"stop_sequence"` | 触发停止序列 | 结束循环 |

**核心区别**：不是检查 `tool_calls.length > 0`，而是看 stop_reason。这是 Claude Code 的方式。

### 2.3 initChatModel — 统一模型接口

```typescript
// src/agent/model.ts
import { initChatModel } from "langchain";

async function createModel(config: ModelConfig) {
  const model = await initChatModel(config.model, {
    temperature: config.temperature ?? 0,
    maxTokens: config.maxOutputTokens ?? 16384,
  });
  return model.bindTools(toolRegistry.getToolDefinitions());
}
```

### 2.4 AgentLoop 类 — 核心实现

```typescript
// src/agent/loop.ts
import { HumanMessage, AIMessage, ToolMessage, SystemMessage } from "@langchain/core/messages";

class AgentLoop {
  private messages: BaseMessage[] = [];
  private turnCount = 0;
  private totalCostUsd = 0;
  private sessionId = crypto.randomUUID();
  private model: BaseChatModel;
  private abortController = new AbortController();

  async init(): Promise<void> {
    this.model = await createModel(this.config);
    const systemPrompt = await memoryLoader.load(process.cwd());
    this.messages = [new SystemMessage(systemPrompt)];
  }

  // ★ 核心循环 — stop_reason 驱动
  async *run(userInput: string): AsyncGenerator<AgentEvent> {
    this.messages.push(new HumanMessage(userInput));

    // 创建 checkpoint（每次用户输入一个 checkpoint）
    await checkpoint.create(this.sessionId, this.turnCount);

    while (true) {
      // ── 安全阀 ──
      if (this.turnCount >= this.config.maxTurns) {
        yield { type: "done", reason: "max_turns" }; return;
      }
      if (this.totalCostUsd >= this.config.maxBudgetUsd) {
        yield { type: "done", reason: "max_budget" }; return;
      }
      if (this.abortController.signal.aborted) {
        yield { type: "done", reason: "interrupted" }; return;
      }

      // ── 上下文压缩 @95% ──
      if (await compactor.shouldCompact(this.messages)) {
        yield { type: "compact_start" };
        const result = await compactor.compact(this.messages, this.model);
        this.messages = result.messages;
        // 触发 SessionStart(compact) hook
        const hookOutput = await hooks.emit("SessionStart", { matcher: "compact" });
        if (hookOutput) {
          this.messages.push(new SystemMessage(hookOutput));
        }
        yield { type: "compact_end", preTokens: result.preTokens };
      }

      // ── 注入 system-reminder（动态上下文） ──
      await this.injectSystemReminders();

      // ── 调用 LLM（流式） ──
      this.turnCount++;
      yield { type: "turn_start", turn: this.turnCount };

      let fullResponse: AIMessage | null = null;
      const stream = await this.model.stream(this.messages, {
        signal: this.abortController.signal,
      });

      for await (const chunk of stream) {
        if (chunk.content) {
          yield { type: "text_delta", text: chunk.content as string };
        }
        fullResponse = fullResponse ? fullResponse.concat(chunk) : chunk as AIMessage;
      }

      if (!fullResponse) break;

      // 追踪成本
      if (fullResponse.usage_metadata) {
        this.totalCostUsd += this.calculateCost(fullResponse.usage_metadata);
        yield { type: "usage", usage: fullResponse.usage_metadata, cost: this.totalCostUsd };
      }

      this.messages.push(fullResponse);

      // ── ★ stop_reason 驱动 ──
      const stopReason = fullResponse.response_metadata?.stop_reason
        ?? (fullResponse.tool_calls?.length ? "tool_use" : "end_turn");

      if (stopReason === "end_turn") {
        yield { type: "done", reason: "complete", content: fullResponse.content as string };
        return;
      }

      if (stopReason === "max_tokens") {
        // 截断了，继续让它说
        yield { type: "status", message: "输出被截断，继续..." };
        continue;
      }

      if (stopReason !== "tool_use") {
        yield { type: "done", reason: "complete" };
        return;
      }

      // ── 执行 tool_calls ──
      for (const call of fullResponse.tool_calls ?? []) {
        // 1) PreToolUse hook
        const hookResult = await hooks.emit("PreToolUse", { tool: call.name, input: call.args });
        if (hookResult.action === "deny") {
          this.messages.push(new ToolMessage({
            tool_call_id: call.id!,
            content: `Tool denied: ${hookResult.reason}`,
          }));
          yield { type: "tool_denied", tool: call.name, reason: hookResult.reason };
          continue;
        }

        // 2) Permission check (deny → allow → ask 优先级)
        const permResult = await permissions.check(call.name, call.args);
        if (permResult === "deny") {
          this.messages.push(new ToolMessage({
            tool_call_id: call.id!,
            content: "Tool denied by permission rules.",
          }));
          continue;
        }
        if (permResult === "ask") {
          const userDecision: PermissionDecision = yield {
            type: "permission_request",
            tool: call.name,
            input: call.args,
          };
          if (userDecision === "deny") {
            this.messages.push(new ToolMessage({
              tool_call_id: call.id!,
              content: "Tool denied by user.",
            }));
            continue;
          }
          if (userDecision === "always_allow") {
            permissions.addAllow(call.name, call.args);
          }
        }

        // 3) File checkpoint（文件修改前快照）
        if (["Write", "Edit"].includes(call.name)) {
          await checkpoint.snapshotFile(call.args.filePath ?? call.args.file_path);
        }

        // 4) 执行工具
        yield { type: "tool_start", tool: call.name, input: call.args };
        let result: string;
        let isError = false;
        try {
          const tool = toolRegistry.get(call.name);
          result = await tool.invoke(hookResult.modifiedInput ?? call.args);
        } catch (err) {
          result = `Error: ${err.message}`;
          isError = true;
        }
        yield { type: "tool_end", tool: call.name, output: result, isError };

        // 5) PostToolUse hook
        await hooks.emit("PostToolUse", { tool: call.name, input: call.args, output: result });

        // 6) 追加 tool_result（is_error 让 LLM 知道失败了，它会自行重试）
        this.messages.push(new ToolMessage({
          tool_call_id: call.id!,
          content: result,
          additional_kwargs: isError ? { is_error: true } : undefined,
        }));
      }
      // continue while → 下一轮 LLM 调用
    }
  }

  // 注入动态上下文（类似 Claude Code 的 system-reminder）
  private async injectSystemReminders(): Promise<void> {
    const reminders: string[] = [];

    // git status 变化
    const gitStatus = await this.getGitStatus();
    if (gitStatus) reminders.push(`<system-reminder>gitStatus: ${gitStatus}</system-reminder>`);

    // 诊断信息（如 IDE 传来的错误）
    const diagnostics = await this.getDiagnostics();
    if (diagnostics) reminders.push(`<system-reminder>${diagnostics}</system-reminder>`);

    // 注入到最后一条消息中（而非新增消息）
    if (reminders.length > 0) {
      const last = this.messages.at(-1);
      if (last) {
        last.content += "\n" + reminders.join("\n");
      }
    }
  }

  interrupt(): void { this.abortController.abort(); }
}
```

### 2.5 事件类型

```typescript
// src/agent/events.ts
type AgentEvent =
  | { type: "turn_start"; turn: number }
  | { type: "text_delta"; text: string }
  | { type: "tool_start"; tool: string; input: Record<string, unknown> }
  | { type: "tool_end"; tool: string; output: string; isError?: boolean }
  | { type: "tool_denied"; tool: string; reason?: string }
  | { type: "permission_request"; tool: string; input: Record<string, unknown>;
      resolve: (decision: PermissionDecision) => void }
  | { type: "ask_user"; questions: Question[];
      resolve: (answers: Record<string, string>) => void }
  | { type: "status_update"; data: StatusData }
  | { type: "compact_start" }
  | { type: "compact_end"; preTokens: number }
  | { type: "done"; reason: "complete" | "max_turns" | "max_budget" | "timeout" | "interrupted"; content?: string };

// 权限决策类型 — 新增 allow_session 选项
type PermissionDecision = "approve" | "deny" | "always_allow";

// TUI 权限弹窗使用更细粒度的 PermissionChoice
type PermissionChoice = "allow_once" | "allow_session" | "always_allow" | "deny";
```

### 2.6 File Checkpointing / Rewind

> 参考 Claude Code: 文件修改前自动快照，支持回退

```typescript
// src/agent/checkpoint.ts
interface FileSnapshot {
  path: string;
  content: string;      // 修改前的内容
  timestamp: Date;
}

interface Checkpoint {
  id: number;            // 递增，对应每次用户输入
  sessionId: string;
  userPrompt: string;    // 触发这个 checkpoint 的用户输入
  files: FileSnapshot[];
  createdAt: Date;
}

class CheckpointManager {
  private checkpoints: Checkpoint[] = [];

  // 每次用户输入创建一个 checkpoint
  async create(sessionId: string, turnCount: number): Promise<void> { ... }

  // 文件修改前快照
  async snapshotFile(filePath: string): Promise<void> {
    const current = this.checkpoints.at(-1);
    if (!current) return;
    // 避免重复快照同一文件
    if (current.files.some(f => f.path === filePath)) return;
    try {
      const content = await fs.readFile(filePath, "utf-8");
      current.files.push({ path: filePath, content, timestamp: new Date() });
    } catch {
      // 新文件，无需快照
    }
  }

  // Rewind: 恢复到指定 checkpoint
  async rewind(checkpointId: number, mode: "code_and_conversation" | "code_only" | "conversation_only"): Promise<void> {
    const cp = this.checkpoints.find(c => c.id === checkpointId);
    if (!cp) throw new Error("Checkpoint not found");

    if (mode === "code_and_conversation" || mode === "code_only") {
      // 恢复所有快照文件
      for (const snap of cp.files) {
        await fs.writeFile(snap.path, snap.content);
      }
    }

    if (mode === "code_and_conversation" || mode === "conversation_only") {
      // 截断 messages 到该 checkpoint 对应位置
    }
  }

  // 列出所有 checkpoint（供 /rewind UI 展示）
  list(): { id: number; prompt: string; filesChanged: number; time: Date }[] {
    return this.checkpoints.map(cp => ({
      id: cp.id,
      prompt: cp.userPrompt.slice(0, 80),
      filesChanged: cp.files.length,
      time: cp.createdAt,
    }));
  }
}
```

**Rewind 交互**（Esc+Esc 或 /rewind）：
1. 展示 checkpoint 列表（每个用户输入一个）
2. 用户选择一个 checkpoint
3. 选择恢复模式：
   - 恢复代码和对话 — 回到那个时间点
   - 仅恢复代码 — 撤销文件改动，保留对话
   - 仅恢复对话 — 回退消息，保留当前文件
   - 从此处总结 — 压缩后续消息为摘要（释放上下文）

**注意**: Bash 执行的改动（rm, mv 等）不在 checkpoint 范围内。这不是 git 的替代品。

### 2.7 System Prompt 组装

```typescript
// src/agent/system-prompt.ts
function assembleSystemPrompt(config: {
  layers: MemoryLayer[];
  tools: StructuredTool[];
  environment: EnvironmentInfo;
  skills: SkillSummary[];
}): string {
  const parts: string[] = [];

  // 1. 基础角色指令（内置）
  parts.push(BASE_SYSTEM_PROMPT);

  // 2. 环境信息
  parts.push(`# Environment
- Working directory: ${config.environment.cwd}
- Platform: ${config.environment.platform}
- Shell: ${config.environment.shell}
- Git branch: ${config.environment.gitBranch}
- Date: ${config.environment.date}
- Model: ${config.environment.model}`);

  // 3. 工具描述（自动从 StructuredTool 生成）
  // LangChain bindTools 会自动处理

  // 4. Memory 层级（六层合并）
  for (const layer of config.layers) {
    parts.push(`# ${layer.scope} instructions (${layer.path})\n${layer.content}`);
  }

  // 5. Skill 描述摘要（不是完整内容，按需加载）
  if (config.skills.length > 0) {
    parts.push(`# Available Skills\n${config.skills.map(s => `- /${s.name}: ${s.description}`).join("\n")}`);
  }

  return parts.join("\n\n---\n\n");
}
```

### 2.8 安全阀

| 安全阀 | 默认值 | 行为 |
|--------|--------|------|
| `maxTurns` | 200 | yield done + reason |
| `maxBudgetUsd` | 5.0 | yield done + reason |
| `timeoutMs` | 600_000 | yield done + reason |
| `abortController` | Esc 键触发 | 中断流 + yield done |
| `contextCompact` | @95% 自动触发 | 压缩 + hook 注入 |

### 2.9 Session 管理

```typescript
class SessionManager {
  private baseDir = path.join(os.homedir(), ".codeterm", "sessions");

  async save(loop: AgentLoop): Promise<void> {
    const session = {
      id: loop.sessionId,
      cwd: process.cwd(),
      messages: loop.messages.map(m => m.toJSON()),
      checkpoints: loop.checkpoints,
      metadata: {
        totalTurns: loop.turnCount,
        totalCostUsd: loop.totalCostUsd,
        model: loop.config.model,
        lastActive: new Date(),
      },
    };
    await fs.writeFile(path.join(this.baseDir, `${session.id}.json`), JSON.stringify(session));
  }

  async resume(sessionId: string): Promise<AgentLoop> {
    const data = JSON.parse(await fs.readFile(path.join(this.baseDir, `${sessionId}.json`), "utf-8"));
    const loop = new AgentLoop(data.metadata.model);
    loop.messages = data.messages.map(deserializeMessage);
    loop.checkpoints = data.checkpoints;
    loop.turnCount = data.metadata.totalTurns;
    loop.totalCostUsd = data.metadata.totalCostUsd;
    loop.sessionId = data.id;
    return loop;
  }
}
```

<!-- SECTION_END: agent-loop -->

---

## 3. Tool System

> 参考: Claude Code 内置工具、MCP 协议、LangChain StructuredTool

### 3.1 工具注册表

```typescript
// src/tools/registry.ts
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

class ToolRegistry {
  private tools = new Map<string, StructuredTool>();

  register(tool: StructuredTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): StructuredTool {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  getToolDefinitions(): StructuredTool[] {
    return Array.from(this.tools.values());
  }

  list(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const toolRegistry = new ToolRegistry();
```

### 3.2 内置工具清单

| 工具名 | 功能 | 参数 |
|--------|------|------|
| `Bash` | 执行 shell 命令 | `command`, `timeout?`, `cwd?` |
| `Read` | 读取文件内容 | `filePath`, `offset?`, `limit?` |
| `Write` | 创建/覆盖文件 | `filePath`, `content` |
| `Edit` | 精确字符串替换 | `filePath`, `oldString`, `newString` |
| `Glob` | 文件模式匹配 | `pattern`, `path?` |
| `Grep` | 内容搜索 | `pattern`, `path?`, `glob?` |
| `WebSearch` | 网络搜索 | `query` |
| `WebFetch` | 抓取网页内容 | `url`, `prompt` |
| `AskUserQuestion` | Agent 向用户提问 | `questions[]` (单选/多选) |
| `Task` | Subagent 派发 | `prompt`, `subagent_type`, `model?`, `max_turns?` |

### 3.x AskUserQuestion — Agent 向用户提问

> 参考 Claude Code: Agent 执行中需要用户决策时，弹出交互式选择界面

**设计**: 此工具不真正执行——它 yield 一个事件给 TUI，TUI 渲染 `QuestionDialog` 交互组件，
用户回答后把结果返回给 agent。

```typescript
// src/tools/definitions/ask-user.ts
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const OptionSchema = z.object({
  label: z.string().describe("Display text for this option (1-5 words)"),
  description: z.string().describe("Explanation of what this option means"),
  markdown: z.string().optional().describe("Optional preview content shown when focused"),
});

const QuestionSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  header: z.string().optional().describe("Short label displayed as a chip (max 12 chars)"),
  options: z.array(OptionSchema).min(2).max(4).describe("Available choices (2-4 options)"),
  multiSelect: z.boolean().optional().describe("Allow multiple selections (default: false)"),
});

export class AskUserQuestionTool extends StructuredTool {
  name = "AskUserQuestion";
  description = `Ask the user questions during execution. Use this to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices
4. Offer choices to the user about what direction to take.

Users will always be able to select "Other" to provide custom text input.
Use multiSelect: true to allow multiple answers.`;

  schema = z.object({
    questions: z.array(QuestionSchema).min(1).max(4).describe("Questions to ask (1-4)"),
  });

  // 事件发射器: AgentLoop 设置此回调，TUI 渲染交互并返回答案
  private onAskUser?: (event: AskUserEvent) => void;

  setEventHandler(handler: (event: AskUserEvent) => void): void {
    this.onAskUser = handler;
  }

  async _call(input): Promise<string> {
    if (!this.onAskUser) {
      return "Error: AskUserQuestion is not available in non-interactive mode.";
    }
    // 通过 Promise 等待用户回答
    const answers = await new Promise<Record<string, string>>((resolve) => {
      this.onAskUser!({ type: "ask_user", questions: input.questions, resolve });
    });
    return Object.entries(answers)
      .map(([q, a]) => `Q: ${q}\nA: ${a}`)
      .join("\n\n") || "(No answer provided)";
  }
}
```

**交互流程**:
```
Agent 调用 AskUserQuestion({ questions: [...] })
  │
  ├─ AskUserQuestionTool._call()
  │   └─ yield AskUserEvent → TUI 接收
  │
  ├─ TUI 渲染 QuestionDialog 组件
  │   ├─ 单选: ○/● 标记, Tab 切换, Enter 提交
  │   ├─ 多选: □/■ 标记, Tab 切换, Space 选中, Enter 提交
  │   ├─ 每个选项有 label + description + 可选 markdown 预览
  │   └─ 自动附加 "Other" 选项供用户自由输入
  │
  ├─ 用户回答 → resolve(answers)
  │
  └─ 格式化为 "Q: xxx\nA: yyy" 返回给 Agent
```

**非交互模式**: 如果 `onAskUser` 未设置（headless/CLI `-p` 模式），返回错误信息让 Agent 自行决策。

### 3.3 工具定义模式

```typescript
// src/tools/definitions/read.ts
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import * as fs from "fs/promises";

export class ReadTool extends StructuredTool {
  name = "Read";
  description = "读取文件内容。返回带行号的文件内容。";

  schema = z.object({
    filePath: z.string().describe("文件的绝对路径"),
    offset: z.number().optional().describe("起始行号"),
    limit: z.number().optional().describe("读取行数，默认 2000"),
  });

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const content = await fs.readFile(input.filePath, "utf-8");
    const lines = content.split("\n");
    const start = input.offset ?? 0;
    const end = start + (input.limit ?? 2000);
    return lines
      .slice(start, end)
      .map((line, i) => `${String(start + i + 1).padStart(6)}│${line}`)
      .join("\n");
  }
}
```

### 3.4 权限系统

> 参考 Claude Code: 五种模式 + deny→allow→ask 优先级 + glob 匹配

#### 权限模式

| 模式 | 行为 | 切换方式 |
|------|------|---------|
| `default` | 首次使用每个工具时询问 | 默认 |
| `acceptEdits` | 自动批准文件操作，Bash 仍需确认 | Shift+Tab |
| `plan` | 只读模式，不执行任何修改 | Shift+Tab |
| `dontAsk` | 自动拒绝未预批准的工具 | CLI flag |
| `bypassPermissions` | 跳过所有权限检查（仅限容器/VM） | `--dangerously-skip-permissions` |

#### 工具权限层级

| 工具类型 | 示例 | 是否需要批准 | "不再询问" 持续时间 |
|---------|------|-------------|------------------|
| 只读 | Read, Glob, Grep | 不需要 | — |
| Bash 命令 | shell 执行 | 需要 | 永久（per project+command） |
| 文件修改 | Write, Edit | 需要 | 仅当前会话 |

#### 规则匹配语法

```
规则评估顺序: deny → allow → ask（第一个匹配生效）

匹配所有:
  "Bash"         = 所有 bash 命令
  "Read"         = 所有文件读取

带 specifier:
  "Bash(npm run build)"   = 精确匹配
  "Bash(git *)"           = git 开头的命令（注意空格！）
  "Bash(npm *)"           = npm 开头的命令
  "Bash(*)"               = 等价于 "Bash"
  "Read(.env)"            = 特定文件
  "Edit(src/**)"          = src 下所有文件
  "mcp__server__tool"     = 特定 MCP 工具

安全性:
  "Bash(safe-cmd *)" 不会放行 "safe-cmd && rm -rf /"
  Claude Code 能识别 shell 操作符
```

#### 设置优先级（高到低）

1. Managed settings（组织管理员，不可覆盖）
2. CLI 参数
3. `.codeterm/settings.local.json`（项目本地，gitignored）
4. `.codeterm/settings.json`（项目共享，提交到 git）
5. `~/.codeterm/settings.json`（用户全局）

如果用户 allow 但项目 deny，**deny 赢**。

#### 实现

```typescript
// src/permissions/index.ts
type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
type PermissionResult = "allow" | "deny" | "ask";

class PermissionManager {
  private mode: PermissionMode;
  private rules: { allow: string[]; deny: string[] };

  // 评估顺序: deny → allow → mode-specific → ask
  check(toolName: string, args: Record<string, unknown>): PermissionResult {
    // bypass 模式
    if (this.mode === "bypassPermissions") return "allow";
    if (this.mode === "plan") return "deny";

    // 生成 specifier（如 "Bash(git status)"）
    const specifier = this.buildSpecifier(toolName, args);

    // 1. deny 规则（最高优先级）
    if (this.matchesAny(this.rules.deny, toolName, specifier)) return "deny";

    // 2. allow 规则
    if (this.matchesAny(this.rules.allow, toolName, specifier)) return "allow";

    // 3. 只读工具免检
    if (["Read", "Glob", "Grep"].includes(toolName)) return "allow";

    // 4. acceptEdits 模式
    if (this.mode === "acceptEdits" && ["Write", "Edit"].includes(toolName)) return "allow";

    // 5. dontAsk 模式：未预批准的直接拒绝
    if (this.mode === "dontAsk") return "deny";

    // 6. 默认：询问用户
    return "ask";
  }

  // glob 匹配
  private matchesAny(rules: string[], toolName: string, specifier: string): boolean {
    for (const rule of rules) {
      // "Bash" 匹配所有 Bash
      if (rule === toolName) return true;
      // "Bash(*)" 匹配所有 Bash
      if (rule === `${toolName}(*)`) return true;
      // "Bash(git *)" glob 匹配
      const match = rule.match(/^(\w+)\((.+)\)$/);
      if (match && match[1] === toolName) {
        if (minimatch(specifier, match[2])) return true;
      }
    }
    return false;
  }

  // "Always allow" → 追加到 allow 规则并持久化
  addAllow(toolName: string, args: Record<string, unknown>): void {
    const rule = `${toolName}(${this.buildSpecifier(toolName, args)})`;
    this.rules.allow.push(rule);
    // Bash: 永久保存到 settings.json
    // Edit/Write: 仅保存到内存（会话结束清除）
  }
}
```

<!-- SECTION_END: tool-system -->

---

## 4. Bash Executor

> 参考: Claude Code Bash tool, Codex sandbox, OpenCode shell executor

### 4.1 核心设计原则

- **持久工作目录**: cwd 在命令之间保持不变
- **非持久 Shell 状态**: 每个命令是独立的 `child_process.spawn`
- **超时保护**: 默认 120s，最大 600s
- **输出截断**: 超长输出自动截断，保留头尾
- **信号处理**: 超时先 SIGTERM，5s 后 SIGKILL

### 4.2 实现

```typescript
// src/tools/definitions/bash.ts
import { spawn } from "child_process";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";

export class BashTool extends StructuredTool {
  name = "Bash";
  description = "执行 shell 命令并返回输出。";

  schema = z.object({
    command: z.string().describe("要执行的命令"),
    timeout: z.number().optional().describe("超时毫秒数，默认 120000"),
    cwd: z.string().optional().describe("工作目录"),
  });

  private currentCwd: string;
  private readonly MAX_OUTPUT = 100_000; // 字符

  async _call(input: z.infer<typeof this.schema>): Promise<string> {
    const timeout = input.timeout ?? 120_000;
    const cwd = input.cwd ?? this.currentCwd;

    return new Promise((resolve) => {
      const proc = spawn("bash", ["-c", input.command], {
        cwd,
        env: { ...process.env, TERM: "dumb" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let killed = false;

      proc.stdout.on("data", (d) => { stdout += d.toString(); });
      proc.stderr.on("data", (d) => { stderr += d.toString(); });

      // 超时处理
      const timer = setTimeout(() => {
        killed = true;
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!proc.killed) proc.kill("SIGKILL");
        }, 5000);
      }, timeout);

      proc.on("close", (code) => {
        clearTimeout(timer);
        let output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : "");

        // 输出截断
        if (output.length > this.MAX_OUTPUT) {
          const half = Math.floor(this.MAX_OUTPUT / 2);
          output = output.slice(0, half)
            + `\n\n... [截断 ${output.length - this.MAX_OUTPUT} 字符] ...\n\n`
            + output.slice(-half);
        }

        if (killed) output += "\n[命令超时被终止]";
        if (code !== 0) output += `\n[退出码: ${code}]`;

        resolve(output || "(无输出)");
      });

      // 关闭 stdin
      proc.stdin.end();
    });
  }
}
```

### 4.3 安全措施

| 措施 | 实现 |
|------|------|
| 超时 | 120s 默认，SIGTERM → 5s → SIGKILL |
| 输出截断 | 100K 字符上限，保留头尾 |
| 环境隔离 | `TERM=dumb` 防止交互式程序 |
| cwd 跟踪 | 命令间保持 cwd，忽略 `cd` |
| 危险命令检测 | `rm -rf /`, `mkfs`, `dd` 等触发权限确认 |

### 4.4 后台执行

```typescript
// 长时间命令 → 后台运行，返回 task_id
interface BackgroundTask {
  id: string;
  command: string;
  pid: number;
  startedAt: Date;
  status: "running" | "completed" | "failed";
  output?: string;
}

class TaskManager {
  private tasks = new Map<string, BackgroundTask>();

  async runInBackground(command: string, cwd: string): Promise<string> {
    const id = crypto.randomUUID().slice(0, 8);
    // spawn detached process, store handle
    // return id for later retrieval
    return id;
  }

  async getOutput(id: string): Promise<BackgroundTask> {
    return this.tasks.get(id)!;
  }
}
```

<!-- SECTION_END: bash -->

---

## 5. Hooks

> 参考: Claude Code hooks 系统、Webpack plugin tapable、Git hooks

### 5.1 Hook 生命周期

```
用户输入
  │
  ├─→ [Hook] SessionStart         — 会话开始
  │
  ├─→ [Hook] PreMessage            — LLM 调用前
  │     ├─ 可修改 system prompt
  │     └─ 可注入额外上下文
  │
  ├─→ LLM 推理
  │
  ├─→ [Hook] PostMessage           — LLM 回复后
  │     └─ 可修改/过滤回复内容
  │
  ├─→ [Hook] PreToolUse            — 工具执行前 ★核心
  │     ├─ 参数: { tool, input }
  │     ├─ 返回: approve / deny / modify(newInput)
  │     └─ 用途: 自动批准、日志、输入改写
  │
  ├─→ 工具执行
  │
  ├─→ [Hook] PostToolUse           — 工具执行后
  │     ├─ 参数: { tool, input, output, duration }
  │     └─ 用途: 日志、输出过滤、指标收集
  │
  ├─→ [Hook] Notification          — 需要通知用户时
  │     └─ 用途: 桌面通知、声音提示
  │
  └─→ [Hook] SessionEnd            — 会话结束
        └─ 用途: 清理、统计汇总

```

### 5.2 Hook 定义格式

```typescript
// src/hooks/types.ts
type HookEvent =
  | "SessionStart"
  | "PreMessage"
  | "PostMessage"
  | "PreToolUse"
  | "PostToolUse"
  | "Notification"
  | "SessionEnd";

interface HookMatcher {
  matcher: string;  // 工具名 glob 模式，空字符串=匹配所有
  hooks: HookAction[];
}

type HookAction =
  | { type: "command"; command: string }         // 执行 shell 命令
  | { type: "callback"; handler: HookCallback }  // 程序化回调

interface HookCallback {
  (context: HookContext): Promise<HookResult>;
}

interface HookContext {
  event: HookEvent;
  tool?: string;
  input?: Record<string, unknown>;
  output?: string;
  sessionId: string;
  cwd: string;
}

interface HookResult {
  action: "approve" | "deny" | "modify";
  reason?: string;
  modifiedInput?: Record<string, unknown>;
}
```

### 5.3 Hook 引擎

```typescript
// src/hooks/engine.ts
class HookEngine {
  private registry = new Map<HookEvent, HookMatcher[]>();

  loadFromConfig(config: Record<string, HookMatcher[]>): void {
    for (const [event, matchers] of Object.entries(config)) {
      this.registry.set(event as HookEvent, matchers);
    }
  }

  async emit(event: HookEvent, context: HookContext): Promise<HookResult> {
    const matchers = this.registry.get(event) ?? [];

    for (const matcher of matchers) {
      // matcher.matcher 为空 → 匹配所有
      if (matcher.matcher && !this.matchTool(matcher.matcher, context.tool)) {
        continue;
      }

      for (const action of matcher.hooks) {
        const result = await this.executeAction(action, context);
        if (result.action === "deny") return result;   // 短路: 第一个 deny 生效
        if (result.action === "modify") {
          context.input = result.modifiedInput;         // 修改传递给下一个 hook
        }
      }
    }

    return { action: "approve" };
  }

  private async executeAction(action: HookAction, ctx: HookContext): Promise<HookResult> {
    if (action.type === "command") {
      // 执行 shell 命令，exit 0 = approve, exit 1 = deny
      // 传递 TOOL_NAME, TOOL_INPUT 等环境变量
      const env = {
        ...process.env,
        HOOK_EVENT: ctx.event,
        TOOL_NAME: ctx.tool ?? "",
        TOOL_INPUT: JSON.stringify(ctx.input ?? {}),
      };
      const { exitCode } = await execCommand(action.command, { env });
      return { action: exitCode === 0 ? "approve" : "deny" };
    }

    if (action.type === "callback") {
      return await action.handler(ctx);
    }

    return { action: "approve" };
  }
}
```

### 5.4 配置文件示例

```jsonc
// .claude/settings.local.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",          // 所有工具
        "hooks": [{ "type": "command", "command": "exit 0" }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",      // 仅 Bash
        "hooks": [{ "type": "command", "command": "echo $TOOL_INPUT | jq -r .command | grep -qv 'rm -rf /' && exit 0 || exit 1" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "echo \"[$(date)] $TOOL_NAME\" >> ~/.codeterm/hooks.log" }]
      }
    ]
  }
}
```

<!-- SECTION_END: hooks -->

---

## 6. Skills

> 参考: Claude Code 标准 skill 目录结构 (SKILL.md + YAML frontmatter)

### 6.1 概念

Skill = **一个目录**，包含 `SKILL.md` 入口文件 + 可选的辅助文件。
用户通过 `/skill-name args` 触发，系统读取 `SKILL.md`、替换参数变量、注入 Agent Loop。

**不是 JSON，不是 TypeScript class**，是纯 Markdown + YAML frontmatter。

### 6.2 目录结构标准

```
.codeterm/skills/
├── commit/
│   └── SKILL.md              # 入口文件（必需）
├── review/
│   ├── SKILL.md              # 入口文件
│   └── checklist.md          # 辅助参考文件
├── fix-issue/
│   ├── SKILL.md
│   ├── conventions.md        # 编码规范参考
│   └── scripts/
│       └── fetch-issue.sh    # 可执行脚本
└── deploy/
    ├── SKILL.md
    └── environments.md
```

### 6.3 SKILL.md 格式

每个 `SKILL.md` 由两部分组成：

1. **YAML frontmatter** — 元数据（`---` 包围）
2. **Markdown 正文** — Agent 执行指令

```yaml
---
name: fix-issue
description: 根据 GitHub Issue 编号自动修复问题
argument-hint: [issue-number]
allowed-tools: Bash(gh *), Read, Write, Edit, Grep, Glob
disable-model-invocation: true
---

# 修复 GitHub Issue

修复 Issue #$ARGUMENTS，遵循项目编码规范。

## 当前分支信息
- 分支: !`git branch --show-current`
- 最近提交: !`git log --oneline -5`

## 执行步骤

1. 读取 Issue 详情: `gh issue view $ARGUMENTS`
2. 理解需求和验收标准
3. 用 Grep/Glob 定位相关代码
4. 按 [conventions.md](conventions.md) 规范实现修复
5. 编写或更新测试
6. 运行测试套件验证
7. 创建 commit: `fix: resolve #$ARGUMENTS - <简要描述>`

## 质量检查
- [ ] 找到根因，不是绕过症状
- [ ] 测试通过
- [ ] 没有无关改动
- [ ] commit message 引用了 issue 编号
```

### 6.4 Frontmatter 字段一览

| 字段 | 必需 | 默认值 | 说明 |
|------|------|--------|------|
| `name` | 否 | 目录名 | slash command 名称，小写字母+数字+连字符 |
| `description` | 推荐 | 正文第一段 | 描述 skill 功能，Agent 据此判断何时自动调用 |
| `argument-hint` | 否 | 无 | 自动补全提示，如 `[issue-number]` |
| `allowed-tools` | 否 | 全部 | 激活时自动放行的工具，逗号分隔 |
| `disable-model-invocation` | 否 | `false` | `true` = 仅手动 `/name` 可调用，Agent 不会自动触发 |
| `user-invocable` | 否 | `true` | `false` = 用户不可调用，仅 Agent 背景知识 |
| `model` | 否 | 会话模型 | 执行此 skill 时使用的模型 |
| `context` | 否 | inline | `fork` = 在隔离子 agent 中执行 |
| `agent` | 否 | general-purpose | `context: fork` 时的子 agent 类型 |

### 6.5 参数替换变量

| 变量 | 说明 |
|------|------|
| `$ARGUMENTS` | 所有参数的完整字符串 |
| `$ARGUMENTS[N]` | 第 N 个参数（0-based） |
| `$0`, `$1`, `$2` | `$ARGUMENTS[N]` 的简写 |
| `${SESSION_ID}` | 当前会话 ID |

如果 SKILL.md 中没有出现 `$ARGUMENTS`，系统自动在末尾追加 `ARGUMENTS: <用户输入>`。

### 6.6 动态上下文注入

用 `` !`command` `` 语法在 skill 加载时执行 shell 命令，输出内联替换：

```markdown
## 当前状态
- 分支: !`git branch --show-current`
- 改动文件: !`git diff --name-only`
- Node 版本: !`node -v`
```

### 6.7 内置 Skills

```
.codeterm/skills/
├── commit/SKILL.md         # /commit — 自动 git commit
├── review/SKILL.md         # /review [file] — 代码审查
├── fix/SKILL.md            # /fix [error] — 分析并修复错误
├── test/SKILL.md           # /test [file] — 运行测试并修复失败
├── explain/SKILL.md        # /explain [code] — 解释代码逻辑
├── refactor/SKILL.md       # /refactor [file] — 重构建议+执行
├── help/SKILL.md           # /help — 显示所有可用 skills
├── compact/SKILL.md        # /compact — 压缩上下文
└── model/SKILL.md          # /model [name] — 切换模型
```

内置 skill 示例 — `/commit`:

```yaml
---
name: commit
description: 检查 git 改动，生成规范的 commit message 并提交
allowed-tools: Bash(git *), Read
---

# Git Commit

## 当前状态
- 分支: !`git branch --show-current`

## 步骤

1. 运行 `git status` 查看所有改动
2. 运行 `git diff` 和 `git diff --staged` 分析改动内容
3. 运行 `git log --oneline -5` 了解 commit 风格
4. 生成简洁的 commit message（1-2 句话，关注 "why" 而非 "what"）
5. 用 `git add` 暂存相关文件（不要 `git add -A`）
6. 执行 `git commit`
7. 运行 `git status` 验证提交成功

$ARGUMENTS
```

### 6.8 Skill 发现机制

```typescript
// src/skills/loader.ts
class SkillLoader {
  // 扫描优先级: 项目级 > 用户级
  private readonly searchPaths = [
    path.join(cwd, ".codeterm", "skills"),         // 项目级
    path.join(os.homedir(), ".codeterm", "skills"), // 用户级
  ];

  async discover(): Promise<SkillDefinition[]> {
    const skills: SkillDefinition[] = [];

    for (const base of this.searchPaths) {
      if (!await exists(base)) continue;

      const dirs = await fs.readdir(base, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue;

        const skillMd = path.join(base, dir.name, "SKILL.md");
        if (!await exists(skillMd)) continue;

        const content = await fs.readFile(skillMd, "utf-8");
        const { frontmatter, body } = this.parseFrontmatter(content);

        skills.push({
          name: frontmatter.name ?? dir.name,
          description: frontmatter.description ?? this.extractFirstParagraph(body),
          argumentHint: frontmatter["argument-hint"],
          allowedTools: this.parseAllowedTools(frontmatter["allowed-tools"]),
          disableModelInvocation: frontmatter["disable-model-invocation"] ?? false,
          userInvocable: frontmatter["user-invocable"] ?? true,
          model: frontmatter.model,
          context: frontmatter.context,     // "fork" | undefined
          agent: frontmatter.agent,
          body,
          basePath: path.join(base, dir.name),
        });
      }
    }

    return skills;
  }
}
```

### 6.9 Skill 执行流程

```
用户输入 "/fix-issue 42"
  │
  ├─ SkillLoader.resolve("fix-issue")
  │   └─ 找到 .codeterm/skills/fix-issue/SKILL.md
  │
  ├─ 参数替换
  │   └─ $ARGUMENTS → "42", $0 → "42"
  │
  ├─ 动态上下文注入
  │   └─ !`git branch --show-current` → "feat/auth"
  │
  ├─ 读取辅助文件
  │   └─ conventions.md → 注入上下文
  │
  ├─ 构建完整 prompt
  │   └─ frontmatter.allowed-tools → 临时放行这些工具
  │
  ├─ 注入 Agent Loop
  │   ├─ context: "inline" → 直接作为 HumanMessage
  │   └─ context: "fork" → 启动隔离子 agent 执行
  │
  └─ Agent 自动执行 → 输出结果
```

### 6.10 自定义 Skill 示例

用户在项目中创建 `.codeterm/skills/deploy/SKILL.md`:

```yaml
---
name: deploy
description: 构建、测试并部署到指定环境
argument-hint: [environment]
allowed-tools: Bash(npm *), Bash(docker *), Read
disable-model-invocation: true
---

# 部署到 $0

目标环境: $0 (默认 staging)

## 前置检查
- 当前分支: !`git branch --show-current`
- 是否有未提交改动: !`git status --porcelain`

## 步骤
1. 运行 `npm run build` 构建
2. 运行 `npm test` 确保测试通过
3. 执行 `npm run deploy:$0`
4. 验证部署状态
5. 如果失败，回滚并报告原因
```

用法: `/deploy production`

<!-- SECTION_END: skills -->

---

## 7. Memory

> 严格参考 Claude Code 的 memory 架构：六层指令记忆 + 自动记忆 + 上下文压缩

### 7.1 Memory 系统总览

```
┌──────────────────────────────────────────────────────────────┐
│                      Memory System                           │
├──────────────────┬────────────────────┬──────────────────────┤
│  A. 指令记忆      │  B. 对话窗口记忆    │  C. 自动记忆         │
│  (CODETERM.md)   │  (Context Window)  │  (Auto Memory)      │
│                  │                    │                      │
│  6 层层级加载：    │  messages[]        │  跨会话持久化：       │
│  managed →       │  + 自动压缩 @95%   │  MEMORY.md (索引)    │
│  user →          │  + 压缩后 hook 注入 │  topic-*.md (详情)   │
│  project →       │  + token 追踪      │  agent 自主写入      │
│  local →         │                    │                      │
│  rules →         │                    │                      │
│  auto memory     │                    │                      │
└──────────────────┴────────────────────┴──────────────────────┘
```

---

### 7.2 指令记忆 — 六层层级加载

参考 Claude Code 的 CLAUDE.md 机制，我们用 `CODETERM.md` 作为指令记忆文件：

```
加载顺序（全部 additive，更具体的优先级更高）:

Layer 1: Managed (组织级)
  │  /etc/codeterm/CODETERM.md (Linux)
  │  IT 管理员部署，不可覆盖
  │
Layer 2: User (用户级)
  │  ~/.codeterm/CODETERM.md
  │  个人偏好，所有项目共享
  │
Layer 3: Project (项目级，团队共享)
  │  <project>/CODETERM.md 或 <project>/.codeterm/CODETERM.md
  │  提交到 git，团队成员共享
  │
Layer 4: Project Local (项目级，个人)
  │  <project>/CODETERM.local.md
  │  gitignore，个人项目偏好
  │
Layer 5: Rules (模块化规则)
  │  <project>/.codeterm/rules/*.md
  │  按主题拆分的规则文件
  │  支持 YAML frontmatter 中 paths 字段做路径匹配
  │
Layer 6: Auto Memory (自动记忆)
  │  ~/.codeterm/projects/<project-hash>/memory/MEMORY.md
  │  Agent 自主写入，仅加载前 200 行
  │
  ▼
最终 System Prompt = Layer1 + Layer2 + ... + Layer6 合并
```

**关键特性**：

| 特性 | 实现 |
|------|------|
| **向上遍历** | 从 cwd 递归向上到 git root，加载每层的 CODETERM.md |
| **按需加载** | 子目录的 CODETERM.md 只在读取该子目录文件时才加载 |
| **additive** | 所有层级内容叠加，不是覆盖。冲突时更具体的优先 |
| **import 语法** | `@path/to/file.md` 导入其他文件，最深 5 层 |
| **500 行上限** | 建议每个文件不超过 500 行，超长则拆到 rules/ 或 skills/ |

### 7.3 指令记忆加载器

```typescript
// src/memory/loader.ts

interface MemoryLayer {
  scope: "managed" | "user" | "project" | "local" | "rules" | "auto";
  path: string;
  content: string;
}

class MemoryLoader {
  async load(cwd: string): Promise<{ systemPrompt: string; layers: MemoryLayer[] }> {
    const layers: MemoryLayer[] = [];

    // Layer 1: Managed
    const managedPath = this.getManagedPath();
    const managed = await this.readSafe(managedPath);
    if (managed) layers.push({ scope: "managed", path: managedPath, content: managed });

    // Layer 2: User
    const userPath = path.join(os.homedir(), ".codeterm", "CODETERM.md");
    const user = await this.readSafe(userPath);
    if (user) layers.push({ scope: "user", path: userPath, content: user });

    // Layer 2.5: User rules
    const userRulesDir = path.join(os.homedir(), ".codeterm", "rules");
    const userRules = await this.loadRules(userRulesDir, cwd);
    layers.push(...userRules);

    // Layer 3+4: Project + Local — 向上遍历
    const projectLayers = await this.walkUpForMemory(cwd);
    layers.push(...projectLayers);

    // Layer 5: Project rules
    const projectRulesDir = path.join(cwd, ".codeterm", "rules");
    const projectRules = await this.loadRules(projectRulesDir, cwd);
    layers.push(...projectRules);

    // Layer 6: Auto memory (仅前 200 行)
    const autoMemPath = this.getAutoMemoryPath(cwd);
    const autoMem = await this.readSafe(autoMemPath, 200); // 最多 200 行
    if (autoMem) layers.push({ scope: "auto", path: autoMemPath, content: autoMem });

    // 处理 @import 语法
    for (const layer of layers) {
      layer.content = await this.resolveImports(layer.content, path.dirname(layer.path), 0);
    }

    // 组装 system prompt
    const systemPrompt = this.buildSystemPrompt(layers);
    return { systemPrompt, layers };
  }

  // 向上遍历到 git root
  private async walkUpForMemory(cwd: string): Promise<MemoryLayer[]> {
    const results: MemoryLayer[] = [];
    let dir = cwd;

    while (dir !== path.dirname(dir)) {
      // Project (团队共享)
      for (const name of ["CODETERM.md", ".codeterm/CODETERM.md"]) {
        const p = path.join(dir, name);
        const content = await this.readSafe(p);
        if (content) results.unshift({ scope: "project", path: p, content });
      }
      // Local (个人)
      const localPath = path.join(dir, "CODETERM.local.md");
      const local = await this.readSafe(localPath);
      if (local) results.unshift({ scope: "local", path: localPath, content: local });

      // 到 git root 停止
      if (await this.exists(path.join(dir, ".git"))) break;
      dir = path.dirname(dir);
    }

    return results;
  }

  // 加载 rules/*.md，支持 paths frontmatter 过滤
  private async loadRules(rulesDir: string, cwd: string): Promise<MemoryLayer[]> {
    if (!await this.exists(rulesDir)) return [];
    const files = await this.globMd(rulesDir); // 递归找所有 .md
    const results: MemoryLayer[] = [];

    for (const file of files) {
      const raw = await fs.readFile(file, "utf-8");
      const { frontmatter, body } = this.parseFrontmatter(raw);

      // paths 过滤：仅当当前文件匹配 glob 时才加载
      if (frontmatter.paths) {
        // 延迟加载，由 agent loop 在读取文件时触发
        continue; // TODO: 按需加载实现
      }

      results.push({ scope: "rules", path: file, content: body });
    }
    return results;
  }

  // @import 语法解析（最深 5 层）
  private async resolveImports(content: string, baseDir: string, depth: number): Promise<string> {
    if (depth >= 5) return content;

    // 匹配 @path/to/file（不在代码块内）
    return content.replace(/(?<!`[^`]*)@([\w./-]+)/g, async (_, importPath) => {
      const resolved = importPath.startsWith("~")
        ? path.join(os.homedir(), importPath.slice(1))
        : path.resolve(baseDir, importPath);
      const imported = await this.readSafe(resolved);
      if (!imported) return `@${importPath} (not found)`;
      return this.resolveImports(imported, path.dirname(resolved), depth + 1);
    });
  }

  // Auto memory 路径：基于 git root 的 hash
  private getAutoMemoryPath(cwd: string): string {
    const gitRoot = this.findGitRoot(cwd) ?? cwd;
    const hash = crypto.createHash("md5").update(gitRoot).digest("hex").slice(0, 12);
    return path.join(os.homedir(), ".codeterm", "projects", hash, "memory", "MEMORY.md");
  }
}
```

### 7.4 指令记忆文件示例

**`CODETERM.md`（项目级，提交到 git）：**

```markdown
## 项目约定
- TypeScript strict mode + ESM
- 测试: vitest
- 包管理: pnpm
- 代码风格: prettier + eslint

## 常见命令
- `pnpm dev` — 开发服务器
- `pnpm test` — 运行测试
- `pnpm build` — 构建

## 注意事项
- src/core/ 是核心模块，修改需谨慎
- 不要直接修改 generated/ 目录
- 参考 @docs/architecture.md 了解整体架构

## Compact Instructions
压缩上下文时，必须保留：修改过的文件列表、测试命令、未完成的任务
```

**`.codeterm/rules/testing.md`（模块化规则）：**

```yaml
---
paths: ["src/**/*.test.ts", "tests/**"]
---

# 测试规范
- 每个测试文件放在 __tests__/ 目录
- 使用 describe/it 结构
- mock 外部依赖，不 mock 内部模块
```

---

### 7.5 自动记忆 — Agent 自主学习

Agent 可以主动将重要信息写入持久记忆，跨会话保留。

#### 7.5.1 存储结构

```
~/.codeterm/projects/<project-hash>/memory/
├── MEMORY.md              # 索引文件（启动时加载前 200 行）
├── debugging-patterns.md  # 主题文件（按需读取，启动时不加载）
├── api-conventions.md
└── deployment-notes.md
```

**MEMORY.md** 是简洁索引，Agent 被指示保持精简，详细内容移到主题文件：

```markdown
## 项目要点
- 使用 pnpm，不要用 npm
- 数据库是 PostgreSQL，连接字符串在 .env
- CI 在 GitHub Actions，见 .github/workflows/

## 常见问题
- 见 [debugging-patterns.md](debugging-patterns.md)
- API 规范见 [api-conventions.md](api-conventions.md)
```

#### 7.5.2 自动记忆管理器

```typescript
// src/memory/auto-memory.ts
class AutoMemory {
  private memoryDir: string; // ~/.codeterm/projects/<hash>/memory/

  constructor(cwd: string) {
    const gitRoot = findGitRoot(cwd) ?? cwd;
    const hash = crypto.createHash("md5").update(gitRoot).digest("hex").slice(0, 12);
    this.memoryDir = path.join(os.homedir(), ".codeterm", "projects", hash, "memory");
  }

  // Agent 调用：写入记忆
  async remember(content: string, topic?: string): Promise<void> {
    await fs.mkdir(this.memoryDir, { recursive: true });

    if (topic) {
      // 写入主题文件
      const topicFile = path.join(this.memoryDir, `${topic}.md`);
      await fs.appendFile(topicFile, `\n${content}\n`);
    } else {
      // 写入 MEMORY.md 索引
      const indexFile = path.join(this.memoryDir, "MEMORY.md");
      await fs.appendFile(indexFile, `\n- ${content}\n`);
    }
  }

  // 用户 /remember 命令
  async userRemember(input: string): Promise<void> {
    await this.remember(input);
  }

  // 读取索引（仅前 200 行）
  async loadIndex(): Promise<string> {
    const indexFile = path.join(this.memoryDir, "MEMORY.md");
    try {
      const content = await fs.readFile(indexFile, "utf-8");
      return content.split("\n").slice(0, 200).join("\n");
    } catch {
      return "";
    }
  }

  // 读取主题文件（按需，不在启动时加载）
  async loadTopic(topic: string): Promise<string | null> {
    const topicFile = path.join(this.memoryDir, `${topic}.md`);
    try {
      return await fs.readFile(topicFile, "utf-8");
    } catch {
      return null;
    }
  }
}
```

---

### 7.6 对话窗口记忆 — 上下文管理

#### 7.6.1 上下文组成

```
Context Window 内容组成:
┌─────────────────────────────────────┐
│  System Prompt                      │  ← CODETERM.md 层级合并
│  + Auto Memory (前 200 行)          │
│  + Skill 描述摘要                    │
│  + 工具定义 (tool schemas)           │
│  + 环境信息 (git status, cwd, OS)   │
├─────────────────────────────────────┤
│  对话历史 messages[]                 │
│  ├─ HumanMessage                    │
│  ├─ AIMessage (可能含 tool_calls)    │
│  ├─ ToolMessage (工具结果)           │
│  └─ ... 循环 ...                    │
├─────────────────────────────────────┤
│  [CompactBoundary]                  │  ← 压缩发生时插入的边界标记
│  压缩后的摘要 + 最近对话             │
└─────────────────────────────────────┘
```

#### 7.6.2 自动压缩 (Auto Compaction)

**触发时机**：上下文达到 **95%** 容量时自动触发（可配置）。

```typescript
// src/memory/compactor.ts
class ContextCompactor {
  // 默认 95%，可通过环境变量覆盖
  private compactAt = parseFloat(process.env.CODETERM_AUTOCOMPACT_PCT ?? "95") / 100;
  private maxTokens: number; // 模型上下文窗口大小

  async shouldCompact(messages: BaseMessage[]): Promise<boolean> {
    const used = this.estimateTokens(messages);
    return used > this.maxTokens * this.compactAt;
  }

  async compact(
    messages: BaseMessage[],
    model: BaseChatModel,
    focusHint?: string, // 手动 /compact 可传入关注重点
  ): Promise<{ messages: BaseMessage[]; preTokens: number }> {
    const preTokens = this.estimateTokens(messages);

    // 1. 先清除旧的工具输出（体积最大的部分）
    const trimmed = this.trimToolOutputs(messages);

    // 2. 如果仍然超限，用 LLM 总结对话
    if (this.estimateTokens(trimmed) > this.maxTokens * 0.6) {
      const systemMsg = trimmed[0];
      const toSummarize = trimmed.slice(1, -20);
      const recent = trimmed.slice(-20);

      const summaryPrompt = focusHint
        ? `总结以下对话，重点关注: ${focusHint}`
        : COMPACTION_PROMPT;

      const summary = await model.invoke([
        new SystemMessage(summaryPrompt),
        ...toSummarize,
      ]);

      // 3. 插入压缩边界标记
      const compactBoundary = new SystemMessage(JSON.stringify({
        type: "compact_boundary",
        trigger: focusHint ? "manual" : "auto",
        preTokens,
        timestamp: new Date().toISOString(),
      }));

      return {
        messages: [
          systemMsg,
          compactBoundary,
          new SystemMessage(`[上下文已压缩]\n${summary.content}`),
          ...recent,
        ],
        preTokens,
      };
    }

    return { messages: trimmed, preTokens };
  }

  // 截断工具输出（保留前 500 字符 + 末尾 200 字符）
  private trimToolOutputs(messages: BaseMessage[]): BaseMessage[] {
    return messages.map(m => {
      if (m instanceof ToolMessage && typeof m.content === "string" && m.content.length > 1000) {
        const trimmed = m.content.slice(0, 500) + "\n...[truncated]...\n" + m.content.slice(-200);
        return new ToolMessage({ ...m, content: trimmed });
      }
      return m;
    });
  }

  private estimateTokens(messages: BaseMessage[]): number {
    return messages.reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + Math.ceil(content.length / 3.5);
    }, 0);
  }
}
```

#### 7.6.3 压缩后 Hook 注入

压缩后会触发 `SessionStart` hook（matcher = `"compact"`），可以重新注入关键上下文：

```jsonc
// .codeterm/settings.json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "compact",
      "hooks": [{
        "type": "command",
        "command": "echo '提醒: 用 pnpm，不要用 npm。提交前运行 pnpm test。'"
      }]
    }]
  }
}
```

**这样做的好处**：CODETERM.md 内容在 system prompt 中，压缩不会丢。但对话中提到的临时规则可能被压缩掉，hook 可以补回来。

#### 7.6.4 Token 追踪

```typescript
// src/memory/token-tracker.ts
class TokenTracker {
  private history: { input: number; output: number; timestamp: Date }[] = [];

  record(usage: { input_tokens: number; output_tokens: number }): void {
    this.history.push({
      input: usage.input_tokens,
      output: usage.output_tokens,
      timestamp: new Date(),
    });
  }

  getTotalCost(model: string): number {
    const pricing = MODEL_PRICING[model];
    return this.history.reduce((sum, u) =>
      sum + (u.input * pricing.input + u.output * pricing.output) / 1_000_000, 0);
  }

  getContextUtilization(maxTokens: number): number {
    const last = this.history.at(-1);
    return last ? last.input / maxTokens : 0;
  }

  getSummary(model: string): string {
    const totalIn = this.history.reduce((s, u) => s + u.input, 0);
    const totalOut = this.history.reduce((s, u) => s + u.output, 0);
    return `${totalIn} in / ${totalOut} out / $${this.getTotalCost(model).toFixed(4)}`;
  }
}
```

---

### 7.7 会话持久化

```typescript
// src/memory/session-store.ts
interface Session {
  id: string;
  createdAt: Date;
  lastActive: Date;
  cwd: string;
  messages: SerializedMessage[];
  metadata: {
    totalTurns: number;
    totalCostUsd: number;
    model: string;
    summary?: string;
  };
}

class SessionStore {
  private baseDir = path.join(os.homedir(), ".codeterm", "sessions");

  async save(session: Session): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.writeFile(
      path.join(this.baseDir, `${session.id}.json`),
      JSON.stringify(session, null, 2),
    );
  }

  async load(id: string): Promise<Session | null> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.baseDir, `${id}.json`), "utf-8"));
    } catch {
      return null;
    }
  }

  async listRecent(limit = 20): Promise<SessionSummary[]> {
    const files = await fs.readdir(this.baseDir);
    const sessions = await Promise.all(
      files.filter(f => f.endsWith(".json")).map(async f => ({
        file: f,
        mtime: (await fs.stat(path.join(this.baseDir, f))).mtimeMs,
      }))
    );
    return sessions.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
  }

  async cleanup(keepCount = 100): Promise<void> {
    const all = await this.listRecent(keepCount + 100);
    for (const s of all.slice(keepCount)) {
      await fs.unlink(path.join(this.baseDir, s.file));
    }
  }
}
```

---

### 7.8 Memory 全景图

```
启动时:
  MemoryLoader.load(cwd)
    ├─ Layer 1: /etc/codeterm/CODETERM.md          (managed)
    ├─ Layer 2: ~/.codeterm/CODETERM.md            (user)
    ├─ Layer 2.5: ~/.codeterm/rules/*.md           (user rules)
    ├─ Layer 3: 向上遍历 CODETERM.md               (project, 每层都读)
    ├─ Layer 4: CODETERM.local.md                  (local, gitignored)
    ├─ Layer 5: .codeterm/rules/*.md               (project rules)
    └─ Layer 6: ~/.codeterm/projects/<hash>/MEMORY.md (auto, 前200行)
    → 合并为 SystemMessage (每次 LLM 调用都带上，压缩不丢)

对话中:
  messages[] 增长
    ├─ TokenTracker 记录每次 input/output tokens
    ├─ 达到 95% → ContextCompactor 自动压缩
    │   ├─ 先截断工具输出
    │   ├─ 再 LLM 总结旧对话
    │   ├─ 插入 compact_boundary 标记
    │   └─ 触发 SessionStart(compact) hook → 重新注入关键上下文
    └─ Agent 可主动调用 AutoMemory.remember() 写入持久记忆

对话后:
  SessionStore.save()     → ~/.codeterm/sessions/<id>.json
  AutoMemory 自动清理     → 保持 MEMORY.md < 200 行
  SessionStore.cleanup()  → 保留最近 100 个会话
```

<!-- SECTION_END: memory -->

---

## 8. TUI — 终端界面

> 技术选型: **Ink (React for CLI)** + chalk + marked (自定义 ANSI 渲染器) + highlight.js
>
> 参考: Claude Code 的 TUI 实现 — 不使用 marked-terminal，而是自己实现 marked lexer → ANSI renderer 管线

### 8.1 设计理念

Claude Code 的 TUI 核心思想:
- **非 blessed/curses 全屏模式** — 使用 Ink 的 React 组件模型，滚动式输出
- **Markdown 渲染自主控制** — 不用 marked-terminal，用 marked lexer 解析 + 自写 ANSI renderer
- **主题语义化** — 颜色不直接用 "red"/"blue"，而是语义 token: `text`, `secondaryText`, `success`, `error` 等
- **工具展示生命周期** — 每个工具有 5 个渲染函数控制展示的每个阶段
- **spinner 精心设计** — star sparkle (✢✳✶) 120ms + braille dots 80ms 双模式

### 8.2 主题系统

```ts
// src/tui/theme.ts

/**
 * 语义化颜色 token — 所有组件通过 token 引用颜色，不直接写 hex/ANSI
 * Claude Code 使用 4 套主题: light / dark / light-daltonized / dark-daltonized
 */
interface ThemeColors {
  // === 文本 ===
  text: string;              // 主文本
  secondaryText: string;     // 次要文本 (工具输出等)
  mutedText: string;         // 极淡文本 (时间戳等)

  // === 语义 ===
  success: string;           // 成功/完成
  error: string;             // 错误/拒绝
  warning: string;           // 警告
  info: string;              // 信息/提示
  accent: string;            // 强调色 (链接、高亮)

  // === UI 元素 ===
  border: string;            // 边框
  activeBorder: string;      // 活跃边框 (聚焦态)
  toolTitle: string;         // 工具标题
  toolBorder: string;        // 工具卡片边框
  inputBorder: string;       // 输入框边框
  permissionBorder: string;  // 权限弹窗边框

  // === Diff ===
  diffAdd: string;           // diff 增加行
  diffRemove: string;        // diff 删除行
  diffContext: string;        // diff 上下文行
}

/** Dark 主题 (默认) — 参考 Claude Code 的实际配色 */
const DARK: ThemeColors = {
  text:             "#D4D4D4",
  secondaryText:    "#9CA3AF",
  mutedText:        "#6B7280",
  success:          "#10B981",
  error:            "#EF4444",
  warning:          "#F59E0B",
  info:             "#60A5FA",
  accent:           "#818CF8",
  border:           "#374151",
  activeBorder:     "#60A5FA",
  toolTitle:        "#818CF8",
  toolBorder:       "#4B5563",
  inputBorder:      "#60A5FA",
  permissionBorder: "#60A5FA",
  diffAdd:          "#10B981",
  diffRemove:       "#EF4444",
  diffContext:       "#6B7280",
};

/** Light 主题 */
const LIGHT: ThemeColors = {
  text:             "#1F2937",
  secondaryText:    "#6B7280",
  mutedText:        "#9CA3AF",
  success:          "#059669",
  error:            "#DC2626",
  warning:          "#D97706",
  info:             "#2563EB",
  accent:           "#6366F1",
  border:           "#D1D5DB",
  activeBorder:     "#2563EB",
  toolTitle:        "#6366F1",
  toolBorder:       "#D1D5DB",
  inputBorder:      "#2563EB",
  permissionBorder: "#2563EB",
  diffAdd:          "#059669",
  diffRemove:       "#DC2626",
  diffContext:       "#9CA3AF",
};

/** 主题切换 — 检测终端背景或读取用户配置 */
type ThemeName = "dark" | "light" | "dark-daltonized" | "light-daltonized";

function loadTheme(name: ThemeName = "dark"): ThemeColors {
  // daltonized 主题对 red/green 做色盲友好调整
  const themes: Record<ThemeName, ThemeColors> = {
    dark: DARK,
    light: LIGHT,
    "dark-daltonized":  { ...DARK,  diffAdd: "#38BDF8", diffRemove: "#FB923C" },
    "light-daltonized": { ...LIGHT, diffAdd: "#0284C7", diffRemove: "#EA580C" },
  };
  return themes[name];
}
```

### 8.3 Spinner 组件

```ts
// src/tui/Spinner.ts

/**
 * Claude Code 使用两种 spinner:
 * 1. Star Sparkle — 主 spinner，用于 "thinking" 状态
 * 2. Braille Dots — 次 spinner，用于工具执行中
 */

/** Star Sparkle: 120ms 间隔，模仿 Claude Code 的实际帧序列 */
const STAR_SPARKLE = {
  frames: ["·", "✢", "✳", "✶", "✻", "✽"],
  interval: 120,  // ms
};

/** Braille Dots: 80ms 间隔，快速旋转感 */
const BRAILLE_DOTS = {
  frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  interval: 80,
};

/** Spinner React 组件 */
function Spinner({ type = "star", label }: { type?: "star" | "braille"; label?: string }) {
  const config = type === "star" ? STAR_SPARKLE : BRAILLE_DOTS;
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % config.frames.length);
    }, config.interval);
    return () => clearInterval(timer);
  }, []);

  const theme = useTheme();
  return (
    <Text color={theme.accent}>
      {config.frames[frame]}{label ? ` ${label}` : ""}
    </Text>
  );
}
```

### 8.4 界面布局

```
┌─────────────────────────────────────────────────────────┐
│  CodeTerm v0.1.0 │ claude-sonnet-4-6 │ $0.03 │ 1.2k ▸  │  ← StatusBar
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ✢ Thinking...                                          │  ← Star Spinner
│                                                         │
│  我来帮你修复这个测试。先看看失败的测试输出:               │  ← Markdown 渲染
│                                                         │
│  ⎡ Bash ⎤──────────────────────────────────────────     │  ← ToolBlock
│  │ $ npm test -- --filter auth.test.ts             │    │
│  │ FAIL src/auth.test.ts                           │    │
│  │   ✕ should validate token (3ms)                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ⎡ Edit: src/auth.ts ⎤─────────────────────────────    │  ← Diff 渲染
│  │ -  return decoded.valid;                        │    │
│  │ +  return decoded.valid && decoded.exp > now(); │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  > 请帮我修复 auth 模块的测试 _                    [↵]   │  ← InputArea
└─────────────────────────────────────────────────────────┘
```

### 8.5 核心 App 组件

```tsx
// src/tui/App.tsx
import React, { useState, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { ThemeProvider, useTheme } from "./theme.js";
import { StatusBar } from "./StatusBar.js";
import { MessageStream } from "./MessageStream.js";
import { InputArea } from "./InputArea.js";
import { PermissionDialog } from "./PermissionDialog.js";
import { AgentLoop, AgentEvent } from "../agent/loop.js";

interface AppProps {
  agent: AgentLoop;
  initialTheme?: ThemeName;
}

export function App({ agent, initialTheme = "dark" }: AppProps) {
  const { exit } = useApp();

  // === 状态 ===
  const [messages, setMessages] = useState<RenderMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<StatusData>({
    model: agent.modelName,
    tokensUsed: 0,
    cost: 0,
    turnsUsed: 0,
  });
  const [pendingPerm, setPendingPerm] = useState<PermissionRequest | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // === 全局快捷键 ===
  useInput((input, key) => {
    // Esc + Esc: 中断当前执行 (类 Claude Code 的双击 Esc)
    if (key.escape && isRunning) {
      abortRef.current?.abort();
      setIsRunning(false);
    }
    // Ctrl+C: 退出
    if (input === "c" && key.ctrl) {
      exit();
    }
  });

  // === 消息提交处理 ===
  const handleSubmit = useCallback(async (input: string) => {
    // Slash command / skill 检测
    if (input.startsWith("/")) {
      const skill = agent.skillRegistry.resolve(input);
      if (skill) input = skill.expandedPrompt;
    }

    setMessages(prev => [...prev, { role: "user", content: input }]);
    setIsRunning(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      for await (const event of agent.run(input, { signal: abort.signal })) {
        handleAgentEvent(event);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [agent]);

  // === Agent 事件分发 ===
  const handleAgentEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case "text_delta":
        setMessages(prev => appendTextDelta(prev, event.text));
        break;
      case "tool_start":
        setMessages(prev => [...prev, {
          role: "tool",
          tool: event.tool,
          input: event.input,
          status: "running",
        }]);
        break;
      case "tool_end":
        setMessages(prev => updateToolStatus(prev, event.tool, event.output, event.isError));
        break;
      case "permission_request":
        setPendingPerm(event);
        break;
      case "status_update":
        setStatus(event.data);
        break;
      case "compact":
        // 压缩后显示 system 提示
        setMessages(prev => [...prev, {
          role: "system",
          content: "⟳ Context compacted",
        }]);
        break;
    }
  }, []);

  return (
    <ThemeProvider theme={initialTheme}>
      <Box flexDirection="column" height="100%">
        <StatusBar data={status} isRunning={isRunning} />
        <MessageStream messages={messages} isRunning={isRunning} />
        {pendingPerm && (
          <PermissionDialog
            request={pendingPerm}
            onResolve={(result) => {
              pendingPerm.resolve(result);
              setPendingPerm(null);
            }}
          />
        )}
        <InputArea
          onSubmit={handleSubmit}
          disabled={isRunning}
          placeholder="Type a message or /help..."
        />
      </Box>
    </ThemeProvider>
  );
}
```

### 8.6 Markdown 渲染管线

```ts
// src/tui/markdown.ts

/**
 * Claude Code 的 Markdown 渲染 **不用** marked-terminal。
 * 它用 marked 的 lexer 解析成 token 树，然后自己写 ANSI 渲染器。
 * 这样可以精确控制每种 token 的终端显示效果。
 *
 * 管线: raw markdown → marked.lexer() → Token[] → renderTokens() → ANSI string
 */

import { marked } from "marked";
import hljs from "highlight.js";
import chalk from "chalk";

/** 将 Markdown 文本渲染为 ANSI 终端字符串 */
export function renderMarkdown(md: string, theme: ThemeColors): string {
  const tokens = marked.lexer(md);
  return renderTokens(tokens, theme);
}

/** 递归渲染 token 树 */
function renderTokens(tokens: marked.Token[], theme: ThemeColors): string {
  return tokens.map(token => renderToken(token, theme)).join("");
}

function renderToken(token: marked.Token, theme: ThemeColors): string {
  switch (token.type) {
    case "heading": {
      const text = renderInline(token.tokens!, theme);
      const prefix = "#".repeat(token.depth);
      return chalk.bold.hex(theme.accent)(`${prefix} ${text}`) + "\n\n";
    }

    case "paragraph":
      return renderInline(token.tokens!, theme) + "\n\n";

    case "code": {
      // 代码块: highlight.js 语法高亮
      const highlighted = token.lang
        ? highlightCode(token.text, token.lang, theme)
        : chalk.hex(theme.secondaryText)(token.text);
      const header = token.lang
        ? chalk.hex(theme.mutedText)(`  ${token.lang}`) + "\n"
        : "";
      return header + boxWrap(highlighted, theme.border) + "\n\n";
    }

    case "codespan":
      return chalk.hex(theme.accent).bgHex("#1E293B")(` ${token.text} `);

    case "list": {
      return token.items.map((item, i) => {
        const bullet = token.ordered
          ? chalk.hex(theme.accent)(`${token.start! + i}.`)
          : chalk.hex(theme.accent)("•");
        const content = renderInline(item.tokens!, theme);
        return `  ${bullet} ${content}`;
      }).join("\n") + "\n\n";
    }

    case "blockquote": {
      const inner = renderTokens(token.tokens!, theme);
      return inner.split("\n").map(line =>
        chalk.hex(theme.border)("│ ") + chalk.italic.hex(theme.secondaryText)(line)
      ).join("\n") + "\n\n";
    }

    case "hr":
      return chalk.hex(theme.border)("─".repeat(60)) + "\n\n";

    case "table": {
      // 简化表格渲染
      const headers = token.header.map(h => renderInline(h.tokens!, theme));
      const rows = token.rows.map(row =>
        row.map(cell => renderInline(cell.tokens!, theme))
      );
      return renderTable(headers, rows, theme) + "\n\n";
    }

    default:
      return token.raw || "";
  }
}

/** 内联 token 渲染 (bold, italic, link, code 等) */
function renderInline(tokens: marked.Token[], theme: ThemeColors): string {
  return tokens.map(t => {
    switch (t.type) {
      case "strong": return chalk.bold(renderInline(t.tokens!, theme));
      case "em":     return chalk.italic(renderInline(t.tokens!, theme));
      case "del":    return chalk.strikethrough(renderInline(t.tokens!, theme));
      case "link":   return chalk.hex(theme.accent).underline(t.text) +
                            chalk.hex(theme.mutedText)(` (${t.href})`);
      case "codespan": return chalk.hex(theme.accent)(` ${t.text} `);
      case "text":   return chalk.hex(theme.text)(t.text);
      default:       return t.raw || "";
    }
  }).join("");
}

/** 代码块语法高亮 — 使用 highlight.js → ANSI 映射 */
function highlightCode(code: string, lang: string, theme: ThemeColors): string {
  try {
    const result = hljs.highlight(code, { language: lang });
    // 将 highlight.js 的 <span class="hljs-xxx"> 映射到 chalk 颜色
    return hljsToAnsi(result.value, theme);
  } catch {
    return chalk.hex(theme.secondaryText)(code);
  }
}

/** 简易 hljs HTML → ANSI 转换 */
function hljsToAnsi(html: string, theme: ThemeColors): string {
  const classColorMap: Record<string, string> = {
    "hljs-keyword":  theme.accent,
    "hljs-string":   theme.success,
    "hljs-number":   theme.warning,
    "hljs-comment":  theme.mutedText,
    "hljs-function": theme.info,
    "hljs-title":    theme.info,
    "hljs-built_in": theme.accent,
    "hljs-type":     theme.warning,
    "hljs-params":   theme.text,
  };

  return html
    .replace(/<span class="(.*?)">/g, (_, cls) => {
      const color = classColorMap[cls] || theme.text;
      return `\x1b[38;2;${hexToRgb(color)}m`;
    })
    .replace(/<\/span>/g, "\x1b[0m")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
```

### 8.7 工具展示生命周期

```ts
// src/tui/tool-renderers.ts

/**
 * Claude Code 的核心设计: 每个工具有 **5 个渲染函数** 控制 TUI 展示的每个阶段。
 * 这比简单的 "running/done/error" 三态要精细得多。
 *
 * 5 个渲染阶段:
 * 1. getToolTitle(input)       → 工具标题行 (展示时始终可见)
 * 2. renderToolInput(input)    → 工具调用参数的展示
 * 3. renderToolProgress()      → 执行中的中间态展示 (spinner + 进度)
 * 4. renderToolResult(output)  → 执行完成后的结果展示
 * 5. renderToolError(error)    → 失败时的错误展示
 */

interface ToolRenderer {
  /** 标题行: 始终显示在工具卡片顶部 */
  getToolTitle(input: Record<string, unknown>): string;

  /** 参数展示: 紧跟标题，展示关键参数 */
  renderToolInput(input: Record<string, unknown>): string;

  /** 执行中: spinner + 可选的进度信息 */
  renderToolProgress?(state: unknown): string;

  /** 结果: 执行成功后展示 */
  renderToolResult(output: string, input: Record<string, unknown>): string;

  /** 错误: 执行失败时展示 */
  renderToolError(error: string): string;
}

/** ===== Bash 工具渲染器 ===== */
const BashRenderer: ToolRenderer = {
  getToolTitle(input) {
    const cmd = (input.command as string) || "";
    // 显示前 80 字符，截断则加 ...
    return `Bash: ${cmd.length > 80 ? cmd.slice(0, 80) + "..." : cmd}`;
  },

  renderToolInput(input) {
    const cmd = (input.command as string) || "";
    return chalk.hex(theme.secondaryText)(`$ ${cmd}`);
  },

  renderToolProgress() {
    return ""; // Bash 执行中由 stdout 流式输出覆盖
  },

  renderToolResult(output) {
    if (!output.trim()) return chalk.hex(theme.mutedText)("(no output)");
    // 截断长输出
    const lines = output.split("\n");
    if (lines.length > 20) {
      return lines.slice(0, 20).join("\n") +
        chalk.hex(theme.mutedText)(`\n... (${lines.length - 20} more lines)`);
    }
    return output;
  },

  renderToolError(error) {
    return chalk.hex(theme.error)(`✗ ${error}`);
  },
};

/** ===== Read 工具渲染器 ===== */
const ReadRenderer: ToolRenderer = {
  getToolTitle(input) {
    return `Read: ${input.file_path}`;
  },

  renderToolInput(input) {
    const range = input.offset
      ? ` (lines ${input.offset}-${(input.offset as number) + (input.limit as number || 200)})`
      : "";
    return chalk.hex(theme.secondaryText)(`${input.file_path}${range}`);
  },

  renderToolResult(output, input) {
    const lines = output.split("\n");
    const lineCount = chalk.hex(theme.mutedText)(`${lines.length} lines`);
    // 显示前 10 行预览
    const preview = lines.slice(0, 10).join("\n");
    return `${lineCount}\n${preview}` +
      (lines.length > 10 ? chalk.hex(theme.mutedText)("\n...") : "");
  },

  renderToolError: (error) => chalk.hex(theme.error)(`✗ ${error}`),
};

/** ===== Edit 工具渲染器 — diff 展示 ===== */
const EditRenderer: ToolRenderer = {
  getToolTitle(input) {
    return `Edit: ${input.file_path}`;
  },

  renderToolInput(input) {
    const old_str = (input.old_string as string) || "";
    const new_str = (input.new_string as string) || "";
    // 渲染为 unified diff 格式
    return renderDiff(old_str, new_str, theme);
  },

  renderToolResult() {
    return chalk.hex(theme.success)("✓ Applied");
  },

  renderToolError: (error) => chalk.hex(theme.error)(`✗ ${error}`),
};

/** Diff 渲染辅助 */
function renderDiff(oldStr: string, newStr: string, theme: ThemeColors): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const result: string[] = [];

  for (const line of oldLines) {
    result.push(chalk.hex(theme.diffRemove)(`- ${line}`));
  }
  for (const line of newLines) {
    result.push(chalk.hex(theme.diffAdd)(`+ ${line}`));
  }
  return result.join("\n");
}

/** ===== 工具渲染器注册表 ===== */
const TOOL_RENDERERS: Record<string, ToolRenderer> = {
  Bash: BashRenderer,
  Read: ReadRenderer,
  Edit: EditRenderer,
  Write: WriteRenderer,   // 类似 Edit
  Glob: GlobRenderer,     // 显示匹配文件列表
  Grep: GrepRenderer,     // 显示匹配行
  // MCP 工具使用通用渲染器
};

/** 通用渲染器 — 用于未注册的工具 (如 MCP 工具) */
const GenericRenderer: ToolRenderer = {
  getToolTitle(input) {
    return `Tool`;
  },
  renderToolInput(input) {
    return chalk.hex(theme.secondaryText)(JSON.stringify(input, null, 2));
  },
  renderToolResult(output) {
    return output.length > 500 ? output.slice(0, 500) + "..." : output;
  },
  renderToolError: (error) => chalk.hex(theme.error)(error),
};
```

### 8.8 ToolBlock 组件

```tsx
// src/tui/ToolBlock.tsx
import React, { useState } from "react";
import { Box, Text } from "ink";
import { Spinner } from "./Spinner.js";

interface ToolBlockProps {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  status: "running" | "done" | "error";
  isError?: boolean;
}

export function ToolBlock({ tool, input, output, status, isError }: ToolBlockProps) {
  const theme = useTheme();
  const renderer = TOOL_RENDERERS[tool] || GenericRenderer;

  // 状态图标
  const StatusIcon = () => {
    if (status === "running") return <Spinner type="braille" />;
    if (isError)              return <Text color={theme.error}>✗</Text>;
    return                           <Text color={theme.success}>✓</Text>;
  };

  // 边框颜色跟随状态
  const borderColor = status === "running"
    ? theme.toolBorder
    : isError ? theme.error : theme.success;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={1}>
      {/* 标题行 */}
      <Box>
        <StatusIcon />
        <Text color={theme.toolTitle}> {renderer.getToolTitle(input)}</Text>
      </Box>

      {/* 参数展示 */}
      <Box marginLeft={2} marginTop={0}>
        <Text>{renderer.renderToolInput(input)}</Text>
      </Box>

      {/* 结果 / 错误 */}
      {status !== "running" && output != null && (
        <Box marginLeft={2} marginTop={1}>
          <Text>
            {isError
              ? renderer.renderToolError(output)
              : renderer.renderToolResult(output, input)
            }
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

### 8.9 权限确认对话框 (增强版)

> 已重构: 从简单的 Enter/Esc/A 三键式升级为 **4 选项 Tab 导航** 模式

```tsx
// src/tui/PermissionDialog.tsx

/**
 * 增强版权限确认弹窗 — 4 选项 + Tab/Arrow 导航
 *
 * 参考 Claude Code:
 * - Tab/↑↓ 在选项间切换
 * - 4 个选项: Allow once / Allow for session / Always allow / Deny
 * - Enter 提交当前选项
 * - Esc 快速拒绝
 * - 快捷键: Y=allow, A=always, N=deny
 * - 工具参数展示 (Bash 显示命令, Edit 显示 diff)
 */

export type PermissionChoice =
  | "allow_once"
  | "allow_session"
  | "always_allow"
  | "deny";

const CHOICES = [
  { key: "allow_once",    label: "Allow once",        hint: "Allow this single invocation" },
  { key: "allow_session", label: "Allow for session",  hint: "Don't ask again this session" },
  { key: "always_allow",  label: "Always allow",       hint: "Add to settings (persists)" },
  { key: "deny",          label: "Deny",               hint: "Reject this tool call" },
];

export function PermissionDialog({ tool, input, onResolve }: PermissionDialogProps) {
  const theme = useTheme();
  const [focusIdx, setFocusIdx] = useState(0);

  useInput((ch, key) => {
    if (key.tab || key.downArrow) setFocusIdx(f => (f + 1) % CHOICES.length);
    if (key.upArrow) setFocusIdx(f => (f - 1 + CHOICES.length) % CHOICES.length);
    if (key.return) onResolve(CHOICES[focusIdx].key);
    if (key.escape) onResolve("deny");
    if (ch === "y" || ch === "Y") onResolve("allow_once");
    if (ch === "a" || ch === "A") onResolve("always_allow");
    if (ch === "n" || ch === "N") onResolve("deny");
  });

  return (
    <Box borderStyle="round" borderColor={theme.permissionBorder} paddingX={2} paddingY={1}>
      <Text bold color={theme.info}>CodeTerm wants to use: {tool}</Text>
      <Box marginTop={1}><Text color={theme.secondaryText}>{getParamSummary(tool, input)}</Text></Box>
      {/* 选项列表: ▸ 指示聚焦项, deny 用 error 色 */}
      {CHOICES.map((c, i) => (
        <Box key={c.key}>
          <Text color={i === focusIdx ? theme.accent : theme.secondaryText}>
            {i === focusIdx ? "▸ " : "  "}
          </Text>
          <Text bold={i === focusIdx} color={
            i === focusIdx ? (c.key === "deny" ? theme.error : theme.text) : theme.secondaryText
          }>{c.label}</Text>
          <Text color={theme.mutedText}> — {c.hint}</Text>
        </Box>
      ))}
      <Text color={theme.mutedText}>Tab/↑↓ navigate · Enter select · Esc deny · Y allow · A always · N deny</Text>
    </Box>
  );
}

/** 工具参数摘要 — 不同工具展示不同格式 */
function getParamSummary(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "Bash": return `$ ${input.command}`;
    case "Read": return `${input.file_path ?? input.filePath}`;
    case "Edit": return `${input.file_path}\n- ${oldLine}\n+ ${newLine}`;  // diff 格式
    default: return JSON.stringify(input, null, 2).slice(0, 300);
  }
}
```

**关键变化** (vs 旧版):
- 旧版: Enter=approve, Esc=deny, A=always — 只有 3 种选择
- 新版: 4 个选项 + Tab 导航 + 快捷键，对齐 Claude Code 的完整交互

### 8.9b QuestionDialog — AskUserQuestion 渲染

> 新增组件: 渲染 AskUserQuestion 工具的交互界面

```tsx
// src/tui/QuestionDialog.tsx

/**
 * 单选: ○/● 标记, Tab 切换, Enter 提交
 * 多选: □/■ 标记, Tab 切换, Space 选中/取消, Enter 提交
 * 每个选项有 label + description
 * markdown 预览 (可选，选中时右侧显示)
 * 底部自动有 "Other" 选项供自由输入
 */

export function QuestionDialog({ questions, onSubmit }: QuestionDialogProps) {
  const [questionIdx, setQuestionIdx] = useState(0);
  // 逐题回答，所有回答后调用 onSubmit(answers)
  const currentQ = questions[questionIdx];

  return (
    <Box borderStyle="round" borderColor={theme.permissionBorder}>
      {questions.length > 1 && <Text>Question {questionIdx + 1} of {questions.length}</Text>}
      {currentQ.header && <Text bold>[{currentQ.header}]</Text>}
      <Text bold>{currentQ.question}</Text>
      {currentQ.multiSelect
        ? <MultiSelectOptions options={currentQ.options} onSubmit={handleAnswer} />
        : <SingleSelectOptions options={currentQ.options} onSubmit={handleAnswer} />
      }
    </Box>
  );
}

// SingleSelectOptions: ○/● + Tab/Enter + markdown 预览面板
// MultiSelectOptions: □/■ + Tab/Space/Enter
// 两者都自动附加 "Other" 选项 → 展开 TextInput
```

**App.tsx 集成**:
```tsx
// App.tsx 现在管理两种弹窗状态:
const [pendingPerm, setPendingPerm] = useState<...>(null);      // 权限弹窗
const [pendingQuestion, setPendingQuestion] = useState<...>(null); // AskUser 弹窗
const hasDialog = !!pendingPerm || !!pendingQuestion;

// Esc 中断仅在无弹窗时生效
useInput((_input, key) => {
  if (key.escape && isRunning && !pendingPerm && !pendingQuestion) {
    abortRef.current?.abort();
  }
});

// InputArea 在弹窗显示时禁用
<InputArea disabled={isRunning || hasDialog} />
```

### 8.10 InputArea 输入区域

```tsx
// src/tui/InputArea.tsx
import React, { useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

interface InputAreaProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function InputArea({ onSubmit, disabled, placeholder }: InputAreaProps) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [multiline, setMultiline] = useState(false);

  const handleSubmit = (text: string) => {
    if (!text.trim() || disabled) return;
    setHistory(prev => [text, ...prev]);
    setHistIdx(-1);
    setValue("");
    onSubmit(text);
  };

  useInput((input, key) => {
    if (disabled) return;

    // 历史导航
    if (key.upArrow && history.length > 0) {
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setValue(history[idx]);
    }
    if (key.downArrow && histIdx > 0) {
      const idx = histIdx - 1;
      setHistIdx(idx);
      setValue(history[idx]);
    }
  });

  // disabled 时显示 spinner 而非输入框
  if (disabled) {
    return (
      <Box paddingX={1}>
        <Spinner type="star" label="Working..." />
      </Box>
    );
  }

  return (
    <Box borderStyle="round" borderColor={theme.inputBorder} paddingX={1}>
      <Text color={theme.accent}>&gt; </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={placeholder || "Type a message or /help..."}
      />
    </Box>
  );
}
```

### 8.11 StatusBar 状态栏

```tsx
// src/tui/StatusBar.tsx

/**
 * 顶部状态栏: 显示版本 / 模型名 / 花费 / token 用量 / 模式
 *
 * 布局: [品牌] │ [模型] │ [花费] │ [tokens] │ [模式]
 */
import React from "react";
import { Box, Text } from "ink";

interface StatusData {
  model: string;
  tokensUsed: number;
  cost: number;
  turnsUsed: number;
  permissionMode?: string;
}

export function StatusBar({ data, isRunning }: { data: StatusData; isRunning: boolean }) {
  const theme = useTheme();
  const sep = chalk.hex(theme.border)(" │ ");

  return (
    <Box paddingX={1}>
      <Text bold color={theme.accent}>CodeTerm</Text>
      {sep}
      <Text color={theme.secondaryText}>{data.model}</Text>
      {sep}
      <Text color={theme.warning}>${data.cost.toFixed(4)}</Text>
      {sep}
      <Text color={theme.secondaryText}>
        {formatTokens(data.tokensUsed)} tokens
      </Text>
      {sep}
      <Text color={data.permissionMode === "bypassPermissions"
        ? theme.warning : theme.success
      }>
        {data.permissionMode || "default"}
      </Text>
      {isRunning && (
        <>
          {sep}
          <Spinner type="braille" />
        </>
      )}
    </Box>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + "k";
  return String(n);
}
```

### 8.12 快捷键体系

```
┌────────────────────────────────────────────────────────────┐
│  全局快捷键                                                 │
├──────────────┬─────────────────────────────────────────────┤
│  Esc         │ 中断当前 Agent 执行 (单次: 软中断)            │
│  Esc + Esc   │ 强制中断并 rewind 最后一次文件修改             │
│  Ctrl+C      │ 退出 CodeTerm                                │
│  Ctrl+L      │ 清屏                                         │
│  ↑ / ↓       │ 输入历史导航                                  │
├──────────────┼─────────────────────────────────────────────┤
│  权限对话框 (4 选项 Tab 导航)                                  │
├──────────────┼─────────────────────────────────────────────┤
│  Tab / ↑↓    │ 在 4 个选项间切换                               │
│  Enter       │ 提交当前聚焦的选项                               │
│  Esc         │ 快速拒绝                                      │
│  Y           │ 快捷: Allow once                               │
│  A           │ 快捷: Always allow (写入 settings)              │
│  N           │ 快捷: Deny                                     │
├──────────────┼─────────────────────────────────────────────┤
│  AskUser 对话框 (QuestionDialog)                               │
├──────────────┼─────────────────────────────────────────────┤
│  Tab / ↑↓    │ 在选项间切换                                    │
│  Enter       │ 单选: 提交选中项                                │
│  Space       │ 多选: 切换选中/取消                              │
│  Esc         │ 退出 Other 输入模式                             │
└──────────────┴─────────────────────────────────────────────┘
```

### 8.13 MessageStream 消息流组件

```tsx
// src/tui/MessageStream.tsx

/**
 * 消息流: 渲染所有 RenderMessage，包括:
 * - user: 用户输入 (原始文本)
 * - assistant: LLM 输出 (Markdown 渲染)
 * - tool: 工具调用卡片 (ToolBlock)
 * - system: 系统消息 (压缩提示等)
 */
import React from "react";
import { Box, Text, Static } from "ink";

type RenderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool"; tool: string; input: Record<string, unknown>;
      output?: string; status: "running" | "done" | "error"; isError?: boolean }
  | { role: "system"; content: string };

export function MessageStream({ messages, isRunning }: {
  messages: RenderMessage[];
  isRunning: boolean;
}) {
  const theme = useTheme();

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      {messages.map((msg, i) => {
        switch (msg.role) {
          case "user":
            return (
              <Box key={i} marginBottom={1}>
                <Text bold color={theme.info}>&gt; </Text>
                <Text color={theme.text}>{msg.content}</Text>
              </Box>
            );

          case "assistant":
            return (
              <Box key={i} marginBottom={1}>
                <Text>{renderMarkdown(msg.content, theme)}</Text>
              </Box>
            );

          case "tool":
            return (
              <Box key={i} marginBottom={1}>
                <ToolBlock
                  tool={msg.tool}
                  input={msg.input}
                  output={msg.output}
                  status={msg.status}
                  isError={msg.isError}
                />
              </Box>
            );

          case "system":
            return (
              <Box key={i} marginBottom={1}>
                <Text color={theme.mutedText} italic>
                  {msg.content}
                </Text>
              </Box>
            );
        }
      })}

      {/* Agent 思考中指示器 */}
      {isRunning && messages[messages.length - 1]?.role !== "tool" && (
        <Box>
          <Spinner type="star" label="Thinking..." />
        </Box>
      )}
    </Box>
  );
}
```

### 8.14 TUI 文件结构

```
src/tui/
├── App.tsx              # 根组件 — 权限弹窗 + AskUser 弹窗 + 事件分发
├── theme.ts             # 主题系统 (4 套主题 + 语义 token)
├── Spinner.tsx          # Star Sparkle / Braille Dots spinner
├── markdown.ts          # marked lexer → ANSI renderer 管线
├── StatusBar.tsx        # 顶部状态栏
├── MessageStream.tsx    # 消息流容器
├── ToolBlock.tsx        # 工具卡片组件
├── tool-renderers.ts    # 5 阶段工具渲染器注册表
├── PermissionDialog.tsx # 增强版权限弹窗 (4 选项 + Tab 导航)
├── QuestionDialog.tsx   # AskUserQuestion 交互 (单选/多选 + Other)
├── InputArea.tsx        # 输入区域 + 历史
└── index.tsx            # render(<App />) 入口
```

<!-- SECTION_END: tui -->

---

## 9. 项目结构

```
codeterm/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # CLI 入口: commander 解析参数
│   ├── config.ts                   # 全局配置加载（settings 层级合并）
│   │
│   ├── agent/                      # Agent Loop 核心
│   │   ├── loop.ts                 # while + stop_reason 核心循环
│   │   ├── model.ts                # initChatModel 封装
│   │   ├── events.ts               # AgentEvent + PermissionChoice 类型
│   │   ├── system-prompt.ts        # System prompt 组装
│   │   ├── checkpoint.ts           # File checkpointing / rewind
│   │   ├── subagent.ts             # Subagent 系统 (单文件: runner+types+loader)
│   │   └── session.ts              # Session 管理 / Resume
│   │
│   ├── tools/                      # 工具系统
│   │   ├── registry.ts             # 工具注册表
│   │   └── definitions/
│   │       ├── bash.ts             # Shell 执行 + 超时 + 后台任务
│   │       ├── read.ts             # 文件读取（带行号）
│   │       ├── write.ts            # 文件创建/覆盖
│   │       ├── edit.ts             # 精确字符串替换
│   │       ├── glob.ts             # 文件模式匹配
│   │       ├── grep.ts             # 内容搜索（ripgrep 风格）
│   │       ├── web-search.ts       # 网络搜索
│   │       ├── web-fetch.ts        # 网页抓取
│   │       ├── task.ts             # Subagent 派发
│   │       └── ask-user.ts         # AskUserQuestion — Agent 向用户提问
│   │
│   ├── hooks/                      # Hooks 生命周期引擎
│   │   ├── engine.ts               # 事件触发 + 规则匹配
│   │   └── types.ts                # HookEvent / HookAction 类型
│   │
│   ├── skills/                     # Skills 系统 (SKILL.md 标准)
│   │   ├── loader.ts               # 目录扫描 + frontmatter 解析
│   │   ├── executor.ts             # 参数替换 + 动态上下文注入
│   │   └── types.ts                # SkillDefinition 类型
│   │
│   ├── memory/                     # Memory 六层系统
│   │   ├── loader.ts               # 六层指令记忆加载
│   │   ├── auto-memory.ts          # 自动记忆 (MEMORY.md)
│   │   ├── compactor.ts            # 上下文压缩 @95%
│   │   ├── token-tracker.ts        # Token 追踪 + 成本计算
│   │   └── session-store.ts        # 会话持久化
│   │
│   ├── permissions/                # 权限系统
│   │   ├── manager.ts              # deny→allow→ask 规则引擎
│   │   └── matcher.ts              # glob 匹配 (Bash(git *) 语法)
│   │
│   ├── mcp/                        # MCP 客户端
│   │   ├── client.ts               # MCP server 连接管理
│   │   ├── tool-bridge.ts          # MCP tool → LangChain tool 转换
│   │   └── config.ts               # .mcp.json 解析
│   │
│   └── tui/                        # 终端界面 (Ink)
│       ├── App.tsx                  # 根组件，状态管理 + 事件分发 (权限+问答弹窗)
│       ├── theme.ts                 # 主题系统 (4 套主题 + 语义 token)
│       ├── Spinner.tsx              # Star Sparkle / Braille Dots spinner
│       ├── markdown.ts              # marked lexer → ANSI renderer 管线
│       ├── StatusBar.tsx            # 顶部状态栏 (模型/花费/tokens/模式)
│       ├── MessageStream.tsx        # 消息流容器
│       ├── ToolBlock.tsx            # 工具卡片组件 (5 阶段渲染)
│       ├── tool-renderers.ts        # 每工具 5 个渲染函数注册表
│       ├── PermissionDialog.tsx     # 4 选项 Tab 导航权限弹窗 (增强版)
│       ├── QuestionDialog.tsx       # AskUserQuestion 交互组件 (单选/多选)
│       ├── InputArea.tsx            # 输入 + 历史 + spinner 切换
│       └── index.tsx                # render(<App />) 入口
│
├── .codeterm/                       # 项目级配置
│   ├── CODETERM.md                  # 项目指令记忆（提交到 git）
│   ├── settings.json                # 项目设置（提交到 git）
│   ├── settings.local.json          # 本地设置（gitignored）
│   ├── rules/                       # 模块化规则
│   │   └── testing.md
│   ├── skills/                      # 自定义 skills
│   │   └── deploy/SKILL.md
│   └── agents/                      # 自定义 subagents
│       └── code-reviewer.md
│
├── .mcp.json                        # MCP server 配置
├── CODETERM.md                      # 项目指令记忆（顶层，等价位置）
├── CODETERM.local.md                # 本地指令记忆（gitignored）
│
└── tests/
    ├── agent/loop.test.ts
    ├── tools/bash.test.ts
    ├── hooks/engine.test.ts
    ├── permissions/matcher.test.ts
    └── memory/loader.test.ts
```

---

## 10. 技术栈

### 10.1 核心依赖

| 包 | 用途 | 版本 |
|----|------|------|
| `@langchain/core` | LLM 抽象、Tool 基类、Message 类型 | ^0.3 |
| `langchain` | `initChatModel` — 统一模型初始化 | ^0.3 |
| `@langchain/anthropic` | Claude 模型接入 | ^0.3 |
| `@langchain/openai` | OpenAI / DeepSeek 等兼容模型 | ^0.3 |
| `@modelcontextprotocol/sdk` | MCP 客户端 SDK | ^1 |
| `ink` | 终端 React 渲染 | ^5 |
| `ink-text-input` | 文本输入组件 | ^6 |
| `chalk` | 终端颜色 | ^5 |
| `marked` | Markdown lexer (不用 marked-terminal) | ^14 |
| `highlight.js` | 代码块语法高亮 → ANSI 映射 | ^11 |
| `zod` | 工具参数校验 | ^3 |
| `commander` | CLI 参数解析 | ^12 |
| `glob` | 文件匹配 | ^11 |
| `minimatch` | 权限规则 glob 匹配 | ^10 |
| `gray-matter` | YAML frontmatter 解析 | ^4 |

### 10.2 开发依赖

| 包 | 用途 |
|----|------|
| `typescript` | 类型系统 |
| `tsx` | TS 直接执行 |
| `vitest` | 测试框架 |
| `eslint` + `prettier` | 代码规范 |

### 10.3 CLI 入口设计

```typescript
// src/index.ts
import { Command } from "commander";
import { render } from "ink";
import { App } from "./tui/App.js";

const program = new Command()
  .name("codeterm")
  .description("AI Code Terminal — 你的终端编程助手")
  .version("0.1.0")
  .option("-m, --model <model>", "LLM 模型", "claude-sonnet-4-6")
  .option("-p, --prompt <prompt>", "非交互模式: 直接执行任务")
  .option("--max-turns <n>", "最大循环轮次", "100")
  .option("--max-budget <usd>", "预算上限(USD)", "5.0")
  .option("--resume <sessionId>", "恢复会话")
  .option("--dangerously-skip-permissions", "跳过所有权限确认")
  .option("--permission-mode <mode>", "权限模式", "default");

program.parse();
const opts = program.opts();

if (opts.prompt) {
  // 非交互模式 — 直接执行并输出结果
  await runNonInteractive(opts);
} else {
  // 交互模式 — 启动 TUI
  render(<App config={opts} />);
}
```

---

## 附录: 模块交互序列图

```
User    TUI         AgentLoop     Hooks       Permissions   Tools       Memory
 │       │            │             │            │            │           │
 │─input→│            │             │            │            │           │
 │       │──message──→│             │            │            │           │
 │       │            │─PreMessage─→│            │            │           │
 │       │            │←───ok───────│            │            │           │
 │       │            │──call LLM──→             │            │           │
 │       │←─stream────│             │            │            │           │
 │       │            │ (has tool_calls)         │            │           │
 │       │            │─PreToolUse─→│            │            │           │
 │       │            │←──approve───│            │            │           │
 │       │            │─────────────check───────→│            │           │
 │       │            │←────────────ok───────────│            │           │
 │       │            │──────────────────execute─────────────→│           │
 │       │            │←─────────────────result──────────────│           │
 │       │            │─PostToolUse→│            │            │           │
 │       │            │ (loop back to call LLM)  │            │           │
 │       │            │ ...                      │            │           │
 │       │            │ (no more tool_calls)     │            │           │
 │       │←─final─────│             │            │            │           │
 │       │            │──────────────────────────────────save────────────→│
 │←render│            │             │            │            │           │
```
