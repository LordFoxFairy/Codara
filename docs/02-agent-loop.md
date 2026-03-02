# 代理循环引擎

> [← 上一篇: 模型路由](./01-model-routing.md) | [目录](./README.md) | [下一篇: 工具 →](./03-tools.md)

代理循环是 Codara 的核心执行引擎。它接收用户输入，驱动 LLM 生成响应，处理工具调用，直到任务完成或达到安全边界。

> **设计理念：** 循环本身**零业务逻辑**——只做 Middleware 钩子调度。安全阀、上下文压缩、权限检查、钩子触发、检查点等所有关注点都通过 6 个中间件钩子接入（4 个生命周期 + 2 个环绕），循环不硬编码任何子系统。

## 在主线中的定位

- AgentLoop 负责“稳定执行”。
- Hooks 负责“可扩展拦截与事件响应”（见 [04-hooks](./04-hooks.md)）。
- Skills 负责“场景化策略编排”（见 [06-skills](./06-skills.md)）。

`permissions`、`security-check`、`audit` 等都不应作为循环内硬编码流程存在。

---

## 循环层契约

| 项 | 契约定义 |
|---|---|
| 输入 | 用户输入、历史消息、运行配置、已注册工具、模型实例 |
| 输出 | `AgentEvent` 事件流 + 最终 `done` 原因 |
| 主路径 | 模型调用 -> 判断 `tool_calls` -> 执行工具 -> 继续迭代 |
| 失败路径 | 安全阀触发、权限拒绝、模型拒绝、超时、API 错误 |

实现约束：
- 循环层只做调度与状态推进，不承载业务策略。
- 新能力优先通过中间件扩展，不直接改循环主分支。
- 所有终止都必须产生明确 `done reason`，避免静默退出。

循环层非目标：
- 不在循环中写项目特定流程分支。
- 不在循环中直接实现权限规则细节。
- 不在循环中实现技能场景逻辑。

## 为什么从 Agent Loop 开始

Agent Loop 是运行时唯一的“状态推进器”。无论是 hooks、permissions、skills、checkpoint 还是 subagent，最终都要通过循环推进到下一步。

如果循环不稳定，其他机制再完善也无法形成可预测系统行为。

### 循环不变量（必须长期成立）

1. 每一轮只有两条主分支：`有 tool_calls -> 执行工具并继续`，`无 tool_calls -> 结束`。
2. 任一终止路径必须产出明确 `done reason`。
3. 交互事件（如 `permission_request`）必须可恢复，不得造成死等。
4. 工具结果必须回写消息上下文，否则下一轮推理会失真。
5. 任何扩展都不能破坏安全阀（turn/budget/timeout/abort）。

### 何时不该修改循环

- 只是想新增拦截、审计、校验：优先加 hooks/middleware。
- 只是想新增场景流程：优先做 skill 编排。
- 只是想改变授权体验：优先改 permissions 规则与 UI 交互层。

只有当上述路径都无法满足，并且影响到“状态推进语义”时，才应修改循环主干。

---

## 1. 核心循环

### LangChain 响应模型

Codara 使用 LangChain 作为 LLM 集成层。LLM 返回的是结构化的 `AIMessageChunk`，包含两种内容块：

| 块类型 | 说明 | 对应行为 |
|--------|------|---------|
| **Content blocks** | 文本内容（`text` 类型） | 流式输出给用户 |
| **Tool calls** | 工具调用请求（`tool_use` 类型） | 执行工具，结果作为 `ToolMessage` 追加 |

LangChain 的 `bindTools()` 将工具 schema 绑定到模型，LLM 返回的 `tool_calls` 数组包含结构化的工具名、参数和调用 ID。

### 循环逻辑

```
while true:
    // ① beforeAgent — 安全阀、会话恢复、上下文注入
    signal = pipeline.beforeAgent(ctx)
    if signal.action == "done" → yield done(signal.reason) → return

    // ② beforeModel — 上下文压缩、Prompt 增强
    pipeline.beforeModel(ctx)

    // ③ wrapModelCall — 环绕模型调用（重试、模型切换、耗时统计）
    response = pipeline.wrapModelCall(ctx, () => model.stream(messages))
    // 流式过程中：text chunks → yield text_delta 事件

    // ④ afterModel — Token 统计、CoT 解析
    pipeline.afterModel(ctx, response)

    // ⑤ 处理响应
    if response.tool_calls 非空:
        for each call in response.tool_calls:
            // ⑥ wrapToolCall — 环绕工具调用（权限、钩子、检查点、审计）
            result = pipeline.wrapToolCall(toolCtx, () => tool.execute(call.args))
            messages.append(ToolMessage(result, call.id))
        ctx.turn++
        continue

    else:
        // 无工具调用 = LLM 认为任务完成
        break

// ⑦ afterAgent — 资源清理、会话持久化、状态上报
pipeline.afterAgent(ctx)
yield done("complete")
```

**关键点：** 循环只认识 `pipeline`，不认识任何子系统。安全阀（turns/budget/abort）在 `SafetyMiddleware.beforeAgent()` 中检查，上下文压缩在 `CompressionMiddleware.beforeModel()` 中触发，Token 统计在 `MetricsMiddleware.afterModel()` 中完成。循环的分支判断仅基于 LLM 响应中是否包含 `tool_calls`——有调用就执行并继续，没有就结束。

### 回合状态机（建议实现）

为提升可预测性与可调试性，建议将循环实现为显式状态机：

`INIT -> READY -> MODELING -> TOOL_PRECHECK -> TOOL_AUTH -> TOOL_RUN -> TOOL_POST -> TURN_CLOSE -> READY/DONE`

状态约束：

1. 每个状态都要有进入/退出事件，便于日志追踪。
2. `permission_request` 仅允许在 `TOOL_AUTH` 状态发出。
3. 非法状态跳转应立即报错并附带当前 `turn_id` 与 `request_id`。
4. `DONE` 为终态，禁止再次进入执行态。

### stop_reason 的辅助作用

LLM 响应中的 `stop_reason` 作为辅助信号处理边缘情况：

| stop_reason | 行为 |
|---|---|
| _(有 tool_calls)_ | 执行工具，继续循环（主路径） |
| _(无 tool_calls)_ | 任务完成，返回（主路径） |
| `max_tokens` | 输出被截断，继续让 LLM 完成 |
| `refusal` | 模型拒绝，终止 |
| `context_exceeded` | 触发压缩后继续 |

---

## 2. 工具执行流程

工具调用通过 `pipeline.wrapToolCall()` 的洋葱链处理——循环只调用一行代码：

```typescript
const result = await pipeline.wrapToolCall(toolCtx, () => tool.execute(call.args));
```

执行顺序（关键检查点）：

```
tool_call 请求
    │
    ▼
1) ShellHookMiddleware.pre
   └─ PreToolUse（可 deny / modify）
2) PermissionMiddleware
   └─ deny / ask / allow（ask → permission_request）
3) GuardrailMiddleware
   └─ 输入安全校验
4) CheckpointMiddleware
   └─ Write/Edit 前文件快照
5) SubagentMiddleware + tool.execute()
   └─ 从代理工具过滤 + 实际执行
6) ShellHookMiddleware.post
   └─ PostToolUse / PostToolUseFailure
7) AuditMiddleware
   └─ 审计日志
```

每层 `wrapToolCall(ctx, next)` 通过 `try/catch/finally` 统一 pre/post/error 三阶段。完整中间件架构详见 [04-hooks](./04-hooks.md)。

### Engine 挂载原则（关键）

`HookEngine`、`PermissionEngine`、`GuardrailEngine` 等都应作为对应 Middleware 的后端，不应直接连到 Agent Loop。

推荐结构：

1. `ShellHookMiddleware` 调用 `HookEngine.evaluate(event, ctx)`
2. `PermissionMiddleware` 调用 `PermissionEngine.decide(ctx)`
3. `GuardrailMiddleware` 调用 `GuardrailEngine.check(ctx)`

统一约束：

1. Loop 只面向 `pipeline.wrapToolCall()`，不感知具体 Engine 细节。
2. Engine 仅返回“决策对象”，最终短路/放行由 Middleware 执行。
3. Engine 失败按 Middleware 策略处理（fail-open 或 fail-closed），不得直接破坏循环状态机。

### 统一裁决输出（建议实现）

为避免多层冲突覆盖，建议工具调用先收敛为单一裁决对象：

```ts
Decision = {
  decision: "deny" | "ask" | "allow",
  source: "hook" | "permission" | "skill" | "user",
  reason: string,
  request_id: string,
  turn_id: string,
  modified_input?: Record<string, unknown>
}
```

约束：

1. 同一 `request_id` 只允许一个最终 `decision`。
2. 裁决对象进入事件流并与 `tool_start/tool_end/tool_denied` 关联。
3. 若 `modified_input` 存在，后续权限求值必须基于修改后的输入。

### 权限交互（事件回调模式）

权限检查结果为"ask"时，循环不直接处理 UI 交互。而是：

1. 循环 yield 一个 `permission_request` 事件，包含工具信息和 `resolve` 回调
2. 循环 `await` 回调的 Promise
3. TUI（或其他消费者）渲染权限对话框
4. 用户决策后调用 `resolve(decision)`
5. 循环恢复执行

```
循环                              TUI
  │                                 │
  ├─ yield { permission_request,    │
  │         resolve } ─────────────▶│ 渲染 PermissionDialog
  │                                 │
  │  await promise ◀────────────────┤ resolve("allow_session")
  │                                 │
  ├─ 恢复执行                       │
```

`AskUserQuestion` 工具使用相同的事件回调模式（yield `ask_user` 事件）。这与 Claude Code 的设计一致：`AskUserQuestion` 是普通工具，执行时 yield 事件，TUI 渲染 QuestionDialog，用户响应后返回结果。

---

## 3. 事件流

循环以 AsyncGenerator 运行：`run()` 返回事件流，消费者通过 `for await` 逐个处理。

### 事件分类

| 类别 | 事件 | 方向 |
|------|------|------|
| **流式输出** | `turn_start`, `text_delta`, `status_update` | 单向：循环 → 消费者 |
| **工具** | `tool_start`, `tool_end`, `tool_denied` | 单向 |
| **从代理** | `agent_spawned`, `agent_completed` | 单向 |
| **上下文** | `compact_start`, `compact_end` | 单向 |
| **终止** | `done` | 单向（附带原因） |
| **交互** | `permission_request`, `ask_user` | **双向**：含 resolve 回调 |

### 双向事件

两种事件携带 `resolve` 回调，在循环和消费者之间建立同步通道。这使循环与 UI 完全解耦——同一个事件流可以被 TUI 消费（交互模式），也可以被 stdout 写入器消费（`--prompt` 非交互模式）。

### Done 原因

| 原因 | 触发 |
|------|------|
| `complete` | LLM 响应无 tool_calls（任务完成） |
| `max_turns` | 轮次达限 |
| `max_budget` | 费用达限 |
| `timeout` | 超时 |
| `interrupted` | 用户中断 |
| `refusal` | 模型拒绝 |
| `error` | API 或运行时错误 |

---

## 4. 安全阀

安全阀通过 `SafetyMiddleware`（priority: 5, required: true）在 `beforeAgent` 钩子中执行。`required: true` 意味着该中间件**不可移除**——即使其他中间件全部卸载，安全阀仍然生效。

| 安全阀 | 中间件钩子 | 行为 |
|--------|-----------|------|
| max_turns | `SafetyMiddleware.beforeAgent()` | 返回 `{ action: "done", reason: "max_turns" }` |
| max_budget | `SafetyMiddleware.beforeAgent()` | 返回 `{ action: "done", reason: "max_budget" }` |
| timeout | `SafetyMiddleware.beforeAgent()` | 返回 `{ action: "done", reason: "timeout" }` |
| abort | `SafetyMiddleware.beforeAgent()` | 返回 `{ action: "done", reason: "interrupted" }` |
| 并发保护 | `run()` 入口 | 拒绝并发调用（唯一硬编码在循环中的检查） |

### 上下文压缩

上下文压缩通过 `CompressionMiddleware`（priority: 25）在 `beforeModel` 钩子中执行：

1. **裁剪**：截断过长工具输出（保留首尾）
2. **摘要**：仍超 60% 时，LLM 摘要较旧消息

详见 [05-记忆系统](./05-memory-system.md)。

### API 错误

API 错误重试通过 `RetryMiddleware`（priority: 30）在 `wrapModelCall` 中处理：

| 错误类型 | 可重试 | 行为 |
|---------|-------|------|
| 认证失败 (401/403) | 否 | 终止 |
| 限流 (429) | 是 | 指数退避重试 |
| 超时 | 是 | 立即重试 |
| 连接失败 | 否 | 终止 |

---

## 5. 会话生命周期

```
  init()                     run(input)                     done
    │                           │                             │
┌───▼────┐                 ┌────▼─────┐                 ┌─────▼──────┐
│ 加载记忆│                 │          │                 │ 持久化会话  │
│ 发现技能│                 │ 核心循环  │                 │ 持久化权限  │
│ 组装提示│                 │ while(T) │                 │ SessionEnd │
│ 恢复会话│                 │          │                 │ 钩子       │
│ 创建模型│                 └──────────┘                 └────────────┘
└────────┘
```

### 初始化

1. 加载 3 层记忆（用户 → 项目 → 会话）
2. 发现可用技能和命令
3. 组装系统提示词（角色 + 环境 + 记忆 + 技能列表）
4. 恢复会话（`--resume`）
5. 模型路由 → 创建 LLM 实例 → `bindTools()` 绑定所有已注册工具
6. 触发 SessionStart 钩子

### 持久化

- **会话**：原子写入 `~/.codara/sessions/<uuid>.json`（消息历史、统计）。系统消息不保存，恢复时重建。
- **权限**：`always_allow` 决策合并到 `settings.local.json`。

---

## 6. 中间件管道

> **与 Claude Code 的关键区别：** Claude Code 没有中间件管道，子系统通过钩子事件和回调协作。Codara 选择 Middleware 管道作为**贯穿 Agent 全生命周期的统一抽象**，对齐 LangChain 的 `AgentMiddleware` 模式。

每个 Agent 实例（主代理和从代理）都拥有自己的 `MiddlewarePipeline`，通过 6 个钩子介入循环的每个阶段：

| 钩子 | 执行模型 | 循环中的位置 | 典型中间件 |
|------|---------|-------------|-----------|
| `beforeAgent` | 顺序 | 每轮开始前 | SafetyMiddleware, SessionMiddleware, MemoryMiddleware |
| `beforeModel` | 顺序 | 模型调用前 | CompressionMiddleware |
| `wrapModelCall` | 洋葱 | 环绕模型调用 | RetryMiddleware, MetricsMiddleware |
| `afterModel` | 顺序 | 模型响应后 | MetricsMiddleware, DisclosureMiddleware |
| `wrapToolCall` | 洋葱 | 环绕工具调用 | PermissionMiddleware, ShellHookMiddleware, CheckpointMiddleware |
| `afterAgent` | 顺序 | 循环结束后 | SessionMiddleware |

完整中间件架构、接口定义和内置中间件清单详见 [04-hooks](./04-hooks.md)。

---

## 设计要点

**为什么循环基于 tool_calls 而非 stop_reason？** LangChain 返回结构化的 `AIMessage`，其中 `tool_calls` 数组是判断下一步行动的主要依据——有调用就执行，没有就结束。`stop_reason` 仅用于处理边缘情况（截断、拒绝、上下文溢出）。这与 Claude Code 和 LangChain `AgentExecutor` 的判断逻辑一致。

**为什么循环零业务逻辑？** 所有关注点（安全阀、压缩、权限、钩子、审计）都通过中间件接入。循环只做 pipeline 钩子调度 + tool_calls 分支判断。这意味着：新增功能不需要修改循环代码，只需实现一个中间件；测试子系统不需要启动完整循环，只需 mock `next()`。

**SafetyMiddleware 为什么标记 required？** 安全阀是最后防线。`required: true` 确保 `pipeline.remove("safety")` 会抛异常——即使开发者误操作也无法移除安全阀。这是中间件架构中唯一的"硬约束"。

**事件回调和中间件是什么关系？** 互补。`PermissionMiddleware.wrapToolCall()` 内部通过 `ctx.emit("permission_request", { resolve })` 发出事件，TUI 消费事件渲染对话框，用户响应后 `resolve()` 恢复中间件执行。事件回调是中间件的**内部实现细节**，不是替代方案。

---

> [← 上一篇: 模型路由](./01-model-routing.md) | [目录](./README.md) | [下一篇: 工具 →](./03-tools.md)
