# Codara Architecture Redesign Spec

**Goal:** 将 Codara 从半成品提升为生产级 Agent Runtime，架构质量对标 Claude Code。

**参考源码:** `/Users/nako/PycharmProjects/ClaudeCode/LordFoxFairy/civil-engineering-cloud-claude-code-source-v2.1.88/01-claude-code-source-crack/claude-code-source/src`

**核心决策:**
- 保留 6 阶段 Middleware Pipeline 作为差异化架构
- 完全不向后兼容，推倒重来
- 移除 agent-runs/approvals 持久化，subagent 运行状态轻量追踪（task 级别，不独立落盘）
- Subagent 定义从 Skills 动态发现，不硬编码
- Session 改为 JSONL append-only 格式

---

## Phase 1: Settings/Config 统一配置系统

### 现状问题

Codara 只有 2 层配置（project `.codara/settings.json` + user `~/.codara/settings.json`），无 schema 验证，无热更新，无企业策略支持。配置分散在多个独立文件（hooks.json、mcp.json）中，没有统一的加载和合并机制。

### 目标设计

**5 层配置优先级（低→高）:**

| 层级 | 来源 | 说明 |
|------|------|------|
| defaults | 编译时常量 | 内置默认值 |
| userSettings | `~/.codara/settings.json` | 用户全局配置 |
| projectSettings | `.codara/settings.json` | 项目级配置 |
| localSettings | `.codara/settings.local.json` | 本地覆盖（gitignore） |
| envSettings | `CODARA_*` 环境变量 | 运行时覆盖 |

**统一 Settings Schema:**

```typescript
interface CodaraSettings {
  // 模型
  model?: string;
  maxTurns?: number;

  // 权限
  permissions?: {
    defaultMode?: PermissionMode;
    alwaysAllow?: string[];   // "Bash", "Bash(git:*)", "Write(**/README.md)"
    alwaysDeny?: string[];
    alwaysAsk?: string[];
  };

  // Hooks
  hooks?: Record<HookEventType, HookDefinition[]>;

  // MCP
  mcpServers?: Record<string, McpServerConfig>;

  // Skills
  skillSources?: string[];

  // Shell
  defaultShell?: 'bash' | 'zsh' | 'powershell';

  // UI
  theme?: 'light' | 'dark' | 'auto';
}
```

用 Zod schema 验证，`.passthrough()` 支持未知字段的前向兼容。

**配置合并策略:**
- 对象：深合并（lodash `mergeWith`）
- 数组：后层覆盖（不是拼接）
- 基础值：后层覆盖

**热更新:**
- 文件系统 watcher（chokidar），1 秒稳定阈值
- 内部写入标记，防止 double-notify
- 三级缓存：session 缓存、per-source 缓存、parse 缓存

**CODARA.md 支持:**
- 对标 Claude Code 的 CLAUDE.md
- 发现路径：`~/.codara/CODARA.md` → `.codara/CODARA.md` → `CODARA.local.md`
- 纯 Markdown + 可选 YAML frontmatter
- 支持 `@path` include 指令

**合并到统一 settings:**
- 废弃独立的 `hooks.json`、`mcp.json`
- Hooks、MCP、permissions 全部写在 `settings.json` 中
- CODARA.md 负责指令（instructions），settings.json 负责结构化配置

### 关键文件

```
src/config/
├── settings.ts        # 统一加载器：5层合并 + schema验证
├── schema.ts          # Zod schema 定义
├── sources.ts         # 配置源枚举和优先级常量
├── cache.ts           # 三级缓存
├── watcher.ts         # 热更新 watcher
├── codara-md.ts       # CODARA.md 解析（含 @include）
└── index.ts           # 公共 API
```

### 与现有代码的关系

- **替换**: `src/config/settings.ts`（当前简陋实现）
- **替换**: `src/config/workspace.ts`（合并到 settings.ts）
- **废弃**: 所有读取独立 hooks.json/mcp.json 的代码

---

## Phase 2: Hooks 生命周期系统

### 现状问题

Codara 有 8 种 hook 事件和基本的 command/prompt 执行策略，但缺少 async polling、telemetry 集成、信号回传（continue/abort/modify）。Hook 定义在独立文件 `hooks.json` 中（P1 会统一到 settings）。

### 目标设计

**Hook 事件类型（对标 Claude Code 的 27 种，Codara 选取核心 15 种）:**

| 事件 | 触发时机 | 信号 |
|------|---------|------|
| `SessionStart` | 会话创建后 | continue/abort |
| `SessionEnd` | 会话关闭前 | - |
| `PromptSubmit` | 用户提交 prompt 前 | continue/abort/modify |
| `PreToolUse` | 工具调用前 | continue/abort/modify input |
| `PostToolUse` | 工具调用后 | - |
| `Stop` | Agent 停止后 | - |
| `SubagentStart` | 子 agent 启动 | - |
| `SubagentStop` | 子 agent 完成 | - |
| `PreCompact` | 消息压缩前 | - |
| `PostCompact` | 消息压缩后 | - |
| `PermissionRequest` | 权限请求时 | approve/deny |
| `TaskCreated` | 任务创建时 | - |
| `TaskCompleted` | 任务完成时 | - |
| `ConfigChange` | 配置变更时 | - |
| `CwdChanged` | 工作目录变更时 | - |

**Hook 定义格式（在 settings.json 中）:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": { "toolName": "Bash" },
        "command": "echo 'bash about to run'",
        "timeout": 10000
      }
    ],
    "PromptSubmit": [
      {
        "command": "scripts/validate-prompt.sh",
        "timeout": 5000
      }
    ]
  }
}
```

**Hook 输出 Schema:**

```typescript
interface HookOutput {
  // 同步信号
  continue?: boolean;          // false = 阻止后续处理
  decision?: 'approve' | 'block';  // 权限决策
  suppressOutput?: boolean;

  // 修改
  hookSpecificOutput?: {
    updatedInput?: Record<string, unknown>;  // 修改工具参数
    additionalContext?: string;               // 追加到 transcript
    systemMessage?: string;                   // 注入系统消息
  };
}
```

**执行策略:**
- 同步 hooks：spawn 子进程，等待 stdout JSON 输出
- 超时控制：默认 10s，SessionEnd 默认 1.5s
- 错误隔离：hook 失败不崩溃 session，log + continue

**通过 Middleware 接入:**
- `HooksMiddleware` 在 `beforeAgent`（SessionStart）、`beforeModel`（PromptSubmit）、`wrapToolCall`（PreToolUse/PostToolUse）、`afterAgent`（Stop）各阶段触发对应 hooks

### 关键文件

```
src/hooks/
├── types.ts           # HookEventType, HookDefinition, HookOutput
├── registry.ts        # Hook 注册和匹配
├── executor.ts        # 子进程执行 + 超时 + 输出解析
├── middleware.ts       # HooksMiddleware（6阶段接入）
└── index.ts
```

### 与现有代码的关系

- **替换**: `src/observability/hook/`（整个目录）
- **依赖**: P1（settings 提供 hook 配置）

---

## Phase 3: Permission/HIL 权限系统

### 现状问题

Codara 只有 3 种权限模式（allow/ask/deny），规则用 glob 匹配，Bash 分析依赖外部 LLM（延迟高、成本高）。缺少 acceptEdits、plan、dontAsk 等细粒度模式。

### 目标设计

**5 种权限模式:**

| 模式 | 行为 | 场景 |
|------|------|------|
| `default` | 敏感工具询问用户 | 正常交互 |
| `plan` | 所有工具调用需审批 | 规划模式 |
| `acceptEdits` | 自动允许文件编辑 | 快速开发 |
| `bypassPermissions` | 跳过所有检查 | 自动化/CI |
| `dontAsk` | 不询问，直接拒绝 | 受限环境 |

**3 层规则解析（高→低优先级）:**

```
Layer 1: alwaysAllow/alwaysDeny/alwaysAsk 规则（settings.json）
  ↓ 匹配则返回
Layer 2: 工具自带权限检查（tool.checkPermissions()）
  ↓ 返回 allow/deny/ask
Layer 3: 模式转换
  - dontAsk: ask → deny
  - acceptEdits: 编辑类工具 → allow
  - bypassPermissions: 全部 → allow
```

**规则格式（settings.json permissions 字段）:**

```json
{
  "permissions": {
    "defaultMode": "default",
    "alwaysAllow": [
      "Read",
      "Glob",
      "Grep",
      "Bash(git:*)",
      "Bash(ls:*)",
      "Write(**/test/**)"
    ],
    "alwaysDeny": [
      "Bash(rm -rf:*)"
    ],
    "alwaysAsk": [
      "Bash(npm publish:*)"
    ]
  }
}
```

**规则匹配算法:**
- 工具级：`"Read"` 匹配整个工具
- 前缀模式：`"Bash(git:*)"` 匹配 `git` 开头的 Bash 命令
- Glob 模式：`"Write(**/test/**)"` 匹配路径

**权限决策持久化:**
- Session 级：存内存，进程退出丢失
- 永久级：写回 settings.json 的 alwaysAllow/alwaysDeny

**移除 LLM Bash 分析:**
- 改为纯规则匹配 + 前缀模式
- Bash 命令通过 shell 解析提取命令名（不依赖 LLM）
- 大幅降低延迟和成本

**通过 Middleware 接入:**
- `PermissionMiddleware` 在 `wrapToolCall` 阶段拦截
- 返回 allow → 继续执行
- 返回 deny → 返回错误 ToolMessage
- 返回 ask → 触发 ReviewRequest，暂停 agent

### 关键文件

```
src/permission/
├── types.ts           # PermissionMode, PermissionRule, PermissionDecision
├── resolver.ts        # 3层规则解析算法
├── matcher.ts         # 规则匹配（工具级、前缀、glob）
├── bash-parser.ts     # Bash 命令解析（纯规则，无 LLM）
├── persistence.ts     # 决策持久化到 settings.json
├── middleware.ts       # PermissionMiddleware
└── index.ts
```

### 与现有代码的关系

- **替换**: `src/core/middleware/permission/`（整个目录）
- **依赖**: P1（settings）、P2（hooks，PermissionRequest 事件）

---

## Phase 4: Context 动态组装

### 现状问题

Codara 的系统 prompt 在 session 启动时构建一次，不随上下文变化动态更新。Guidelines 的路径匹配是静态的。Skills catalog 固定不变。

### 目标设计

**两阶段组装（对标 Claude Code）:**

| 阶段 | 内容 | 缓存策略 |
|------|------|---------|
| **Static** | 基础指令、工具定义、风格指南 | Session 级缓存，支持 prompt caching |
| **Dynamic** | git 状态、CODARA.md、memory、skills、MCP 工具 | Per-turn 重新计算 |

**Static/Dynamic 分界标记:**

```typescript
const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = '<!-- DYNAMIC -->';
```

API 层在此标记处切分，static 部分走 prompt cache，dynamic 部分每次重算。

**Context Sources 组装顺序:**

1. **Base instructions**（static）：Agent 角色定义、工具使用规范、输出风格
2. **Tool definitions**（static）：已注册工具的 name + description + schema
3. **CODARA.md instructions**（dynamic）：项目指令，支持 `@include`
4. **Git context**（dynamic）：当前分支、最近 5 条 commit、git status
5. **Skills catalog**（dynamic）：已发现 skills 的名称和描述
6. **Memory context**（dynamic）：相关 memory 文件内容
7. **MCP instructions**（dynamic）：已连接 MCP server 的工具说明
8. **Session guidance**（dynamic）：当前日期、工作目录、运行时上下文

**Git Context 并行获取:**

```typescript
const [status, log, branch, user] = await Promise.all([
  exec('git status --short'),
  exec('git log --oneline -n 5'),
  exec('git branch --show-current'),
  exec('git config user.name'),
]);
```

结果缓存，per-turn 过期。

**Dynamic Section 注册模式:**
- 每个 dynamic section 是一个 `() => string | undefined` 函数
- Middleware 可通过 `beforeModel` 注册新 section
- Section 返回 `undefined` 表示跳过

### 关键文件

```
src/context/
├── system-prompt.ts     # 两阶段组装主函数
├── sections/
│   ├── static.ts        # 静态 sections（base、tools、style）
│   └── dynamic.ts       # 动态 sections 注册表
├── codara-md.ts         # → 从 P1 config/ 引用
├── git-context.ts       # Git 状态并行获取 + 缓存
├── memory-context.ts    # Memory 文件加载
└── index.ts
```

### 与现有代码的关系

- **重写**: `src/context/session-bundle/base-system-message.ts`
- **重写**: `src/context/instructions/`
- **保留**: `src/context/prompts/`（prompt 模板加载）
- **依赖**: P1（CODARA.md 解析）

---

## Phase 5: Agent Loop 重写

### 现状问题

当前 agent loop 是 while 循环 + `runAgentTurn`，continuation 逻辑简单（有 tool calls 就继续），缺少 token budget tracking、auto-compact、error recovery。刚加的 tool concurrency 和 compaction 是正确方向但不够完整。

### 目标设计

**Generator-based Continuation（对标 Claude Code query.ts）:**

```typescript
async function* agentLoop(input: AgentInput): AsyncGenerator<AgentEvent, AgentResult> {
  const state = createLoopState(input);

  while (true) {
    // Phase 1: Pre-turn（attachments、memory prefetch）
    yield* preTurn(state);

    // Phase 2: Model call（streaming）
    const response = yield* callModel(state);

    // Phase 3: Continuation check
    if (!needsFollowUp(response, state)) {
      // Error recovery paths
      if (isPromptTooLong(response)) {
        state = await reactiveCompact(state);
        continue;
      }
      return buildResult(state);
    }

    // Phase 4: Tool execution（concurrent）
    const toolResults = yield* executeTools(response.toolCalls, state);

    // Phase 5: Post-turn（update state）
    state = updateState(state, response, toolResults);

    // Phase 6: Budget check
    if (isTokenBudgetExhausted(state)) {
      return buildResult(state, 'budget_exhausted');
    }
  }
}
```

**needsFollowUp 逻辑:**

```typescript
function needsFollowUp(response: ModelResponse, state: LoopState): boolean {
  // 有 tool calls 且 budget 足够 → 继续
  if (response.toolCalls.length > 0 && !isTokenBudgetExhausted(state)) {
    return true;
  }
  // hook 干预
  if (state.hookSignals.preventContinuation) {
    return false;
  }
  return false;
}
```

**Token Budget Tracking:**

```typescript
interface TokenBudget {
  contextWindow: number;        // 模型最大 token
  reservedOutput: number;       // 保留给输出的 token（默认 20K）
  usedTokens: number;           // 已使用 token
  continuationCount: number;    // 连续 continuation 次数
  lastDeltaTokens: number;      // 上次新增 token 数
}

function checkTokenBudget(budget: TokenBudget): 'continue' | 'stop' {
  // 使用量 >= 90% → 停止
  if (budget.usedTokens / budget.contextWindow >= 0.9) return 'stop';
  // 递减收益检测：连续 3+ 次且每次 < 500 新 token → 停止
  if (budget.continuationCount >= 3 && budget.lastDeltaTokens < 500) return 'stop';
  return 'continue';
}
```

**Auto-Compact:**
- 阈值：`contextWindow - 13000` tokens
- 触发时机：每次 model call 前检查
- 算法：保留最近 N 个 turn，旧 turn 压缩为 SystemMessage 摘要
- 断路器：连续 3 次压缩失败后跳过

**Streaming Tool Executor（对标 Claude Code StreamingToolExecutor）:**

```typescript
class StreamingToolExecutor {
  private tracked: TrackedTool[] = [];

  addTool(toolCall: ToolCall): void;

  // 并发执行：read-only 并行，writable 串行
  async *execute(): AsyncGenerator<ToolProgress | ToolResult> {
    // Phase 1: 所有 read-only tools 并行
    const readOnly = this.tracked.filter(t => isToolReadOnly(t.name));
    await Promise.all(readOnly.map(t => this.run(t)));

    // Phase 2: writable tools 串行
    for (const tool of this.tracked.filter(t => !isToolReadOnly(t.name))) {
      yield* this.run(tool);
    }
  }

  // Bash 错误时中止同级工具
  private abortSiblings(failedTool: TrackedTool): void;
}
```

**Loop State 不可变更新:**
- 所有 state 变更通过 `state = { ...state, field: newValue }`
- 7 个明确的 continue site（error recovery、compact、budget）
- 没有散布的 mutation

**通过 Middleware 接入:**
- Agent loop 在每个阶段调用 pipeline 对应 hook
- `beforeAgent` → 准备阶段
- `beforeModel` → 注入动态 context
- `wrapModelCall` → 拦截/包装 model 调用
- `afterModel` → 处理响应
- `wrapToolCall` → 权限检查、hook 触发
- `afterAgent` → 清理、metrics

### 关键文件

```
src/agent/
├── loop.ts              # Generator-based agent loop
├── state.ts             # LoopState 类型和初始化
├── continuation.ts      # needsFollowUp + token budget
├── tool-executor.ts     # StreamingToolExecutor
├── tool-concurrency.ts  # read-only/writable 分区（保留现有）
├── compact.ts           # Auto-compact（保留现有 + 增强）
├── events.ts            # AgentEvent 类型定义
└── index.ts
```

### 与现有代码的关系

- **重写**: `src/core/agent/run/agent-loop.ts` → `src/agent/loop.ts`
- **重写**: `src/core/agent/run/turn.ts` → 合并到 loop.ts
- **保留**: `src/core/agent/run/tool-concurrency.ts` → 移到 `src/agent/`
- **保留**: `src/core/agent/run/compact.ts` → 移到 `src/agent/`，增强
- **保留**: `src/core/pipeline/` → middleware pipeline 不动

---

## Phase 6: Session/Memory 持久化重写

### 现状问题

Codara 使用 JSON snapshot 存 session，有 agent-runs/、approvals/、tasks/ 多个持久化目录，checkpoint 机制复杂且不必要。Claude Code 只用 JSONL append-only transcript + 轻量 tasks。

### 目标设计

**砍掉:**
- `durability/approval-store.ts` → 删除，不再持久化 approval
- `capability/subagent/run-store.ts` → 删除，subagent 状态纯内存
- `durability/checkpoint/` → 删除，改为 JSONL transcript
- `.codara/agent-runs/` → 不再创建
- `.codara/approvals/` → 不再创建

**保留（重写）:**
- Session transcript（JSONL）
- Tasks（轻量文件存储）

**JSONL Transcript 格式:**

```typescript
// 每行一个 JSON 对象
interface TranscriptEntry {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'system' | 'attachment';
  uuid: string;
  parentUuid?: string;
  timestamp: number;
  content: unknown;        // 类型决定内容
  metadata?: {
    model?: string;
    tokens?: number;
    toolName?: string;
  };
}
```

**存储路径:** `~/.codara/projects/{sanitized-project-path}/{sessionId}.jsonl`

**写入策略:**
- Append-only，每条消息一行
- User message 在 query 前写入（崩溃恢复）
- 异步批量 flush + 文件锁防并发
- 关闭时 final flush

**Session 恢复:**
- 读取 JSONL 尾部（避免大文件 OOM）
- 过滤临时条目（progress、ephemeral）
- 通过 uuid → parentUuid 重建消息链
- 最大读取 50MB

**Compact Boundary:**
- 压缩时写入 `type: 'system', subtype: 'compact_boundary'` 条目
- 恢复时跳过 boundary 之前的消息

**Memory 系统（简化版）:**

```
~/.codara/memory/
├── MEMORY.md            # 索引文件（200行以内）
├── user_*.md            # 用户相关记忆
├── feedback_*.md        # 反馈和修正
├── project_*.md         # 项目上下文
└── reference_*.md       # 外部资源指针
```

4 种 memory 类型（user/feedback/project/reference），frontmatter 格式，与 P4 Context 组装集成。

**Tasks 轻量存储:**

```
~/.codara/tasks/{taskListId}/
├── {taskId}.json        # 单个 task 记录
└── .highwatermark       # ID 高水位防重用
```

通过文件锁保证并发安全（多 agent 场景）。

### 关键文件

```
src/session/
├── transcript.ts        # JSONL 读写 + append-only + flush
├── restore.ts           # Session 恢复（尾部读取 + 消息链重建）
├── types.ts             # TranscriptEntry, SessionMetadata
├── storage.ts           # 路径计算 + 文件安全 ID 编码
└── index.ts

src/memory/
├── types.ts             # 4种 memory 类型
├── loader.ts            # Memory 文件发现和加载
├── writer.ts            # Memory 文件写入
└── index.ts
```

### 与现有代码的关系

- **删除**: `src/durability/approval-store.ts`
- **删除**: `src/durability/checkpoint/`（整个目录）
- **删除**: `src/capability/subagent/run-store.ts`
- **重写**: `src/durability/session/` → `src/session/`
- **新增**: `src/memory/`（从 context 中独立出来）

---

## Phase 7: CLI 交互重写

### 现状问题

`use-cli-controller.ts` 是一个巨大的 React hook，状态管理通过 `useState`/`useRef`，存在大量 settlement/bouncing 补丁代码。Shell-app 组件树臃肿。没有状态机概念，状态转换靠散布的 `if` 判断。

### 目标设计

**Zustand-like State Store（对标 Claude Code AppStateStore）:**

```typescript
// 最小 pub-sub store
function createStore<T>(initialState: T) {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (updater: (prev: T) => T) => {
      const next = updater(state);
      if (!Object.is(state, next)) {
        state = next;
        listeners.forEach(l => l());
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
```

**AppState 形状:**

```typescript
interface AppState {
  // Session
  sessionId: string;
  messages: Message[];

  // Agent
  agentStatus: 'idle' | 'running' | 'paused' | 'error';
  currentTurn: number;
  tokenUsage: TokenBudget;

  // UI
  inputMode: 'compose' | 'review' | 'confirm';
  expandedView: boolean;

  // Tools
  activeTools: Map<string, ToolProgress>;
  permissionPending?: PermissionRequest;

  // Subagents
  runningSubagents: Map<string, SubagentState>;

  // Settings（来自 P1）
  settings: CodaraSettings;
}
```

**React 集成:**

```typescript
// useSyncExternalStore 选择性订阅
function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useContext(AppStoreContext);
  return useSyncExternalStore(
    store.subscribe,
    () => selector(store.getState()),
  );
}
```

只有被选择的 state slice 变化时才触发 re-render。

**状态机替代 settlement 补丁:**

```
idle → running（用户提交 prompt）
running → paused（权限审核 / review）
paused → running（用户批准）
running → idle（agent 完成 + 无 subagent 运行）
running → subagent_wait（agent 完成 + subagent 仍运行）
subagent_wait → running（subagent 完成 → re-entry）
subagent_wait → idle（全部完成 + re-entry 完成）
```

明确的状态转换函数，不再有 `settlingFinalReplyRef` 这样的补丁。

**组件树简化:**

```
<AppStateProvider store={store}>
  <CliApp>
    <Header />           // 状态栏：model、branch、token usage
    <MessageList />      // 消息流：虚拟滚动（P8）
    <ToolProgress />     // 工具执行进度
    <PermissionPrompt /> // 权限审核 UI
    <Composer />         // 输入框
    <StatusBar />        // 底部状态
  </CliApp>
</AppStateProvider>
```

**消除畸形代码:**
- 移除 `use-cli-controller.ts` 中所有 settlement/bouncing 逻辑
- 移除 `InteractionScheduler`（改为 store dispatch）
- 移除 `routeCliRuntimeEvent`（改为 store 直接更新）
- Subagent 完成流通过 store 状态机处理，不再需要 polling

### 关键文件

```
src/cli/
├── store/
│   ├── create-store.ts   # 最小 pub-sub store 实现
│   ├── app-state.ts      # AppState 类型 + 初始值
│   ├── actions.ts        # 状态转换函数
│   └── hooks.ts          # useAppState React hook
├── app/
│   ├── cli-app.tsx        # 顶层组件（简化）
│   ├── header.tsx
│   ├── message-list.tsx
│   ├── composer.tsx
│   ├── permission-prompt.tsx
│   └── status-bar.tsx
├── main.tsx               # 入口（保留，简化）
└── index.ts
```

### 与现有代码的关系

- **删除**: `src/cli/app/use-cli-controller.ts`（整个文件）
- **删除**: `src/cli/app/view-state.ts`（合并到 store）
- **重写**: `src/cli/app/shell-app.tsx` → `src/cli/app/cli-app.tsx`
- **新增**: `src/cli/store/`（Zustand-like store）

---

## Phase 8: Streaming & 渲染优化

### 现状问题

Codara 使用基本 Ink 渲染，无虚拟滚动，长消息列表性能差。无增量 diff，每帧全量重绘。无 keyboard-first 设计。

### 目标设计

**虚拟滚动:**
- `<ScrollBox>` 组件：只渲染可视区域的行
- 滚动位置跟踪：`scrollTop`、`viewportHeight`、`contentHeight`
- Sticky scroll：新内容自动滚到底部
- 性能：1000+ 消息不卡顿

**增量渲染:**
- Ink 自带的 diff 机制已经做了增量输出
- 优化方向：减少不必要的 re-render（通过 P7 的 selector 实现）
- Streaming 文本：character-by-character 追加，不重建整条消息

**Keyboard-first:**

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 中断当前 agent |
| `Ctrl+D` | 退出 |
| `Esc` | 取消输入 / 关闭 review |
| `Tab` | 切换 focus |
| `Up/Down` | 历史浏览 / 滚动 |
| `Enter` | 提交 |
| `y/n` | 快速批准/拒绝 |

**Markdown 渲染:**
- 代码块语法高亮
- 链接可点击（支持 hyperlink 的终端）
- 表格对齐渲染

**Tool Progress 实时展示:**
- Bash：stdout/stderr 实时流
- 文件操作：diff 预览
- Subagent：状态 + 进度摘要

### 关键文件

```
src/cli/
├── components/
│   ├── scroll-box.tsx       # 虚拟滚动容器
│   ├── markdown.tsx         # Markdown 渲染
│   ├── tool-output.tsx      # 工具输出展示
│   ├── diff-view.tsx        # Diff 展示
│   └── keyboard.tsx         # 快捷键处理
├── rendering/
│   ├── stream-buffer.ts     # Streaming 文本缓冲
│   └── ansi.ts              # ANSI 转义处理
└── ...
```

---

## Subagent 系统改造

### 与 8 个 Phase 并行的横切改造

**Subagent 定义动态发现（改造 P1 期间）:**

当前 `runtime.ts` 中硬编码了 Explore、Plan 等 subagent 的系统 prompt。改为：

- 只保留 `Agent` 基础类型（内置，不可覆盖）
- 其他 subagent 类型从 skills 目录的 `agents/` 子目录动态发现
- 保留现有的 `parseDefinitionFile` 机制，但移除内置 definition 列表

**Subagent 状态纯内存（P6 期间）:**

```typescript
class SubagentRunManager {
  // 内存 Map，不再落盘
  private runs = new Map<string, SubagentRunHandle>();

  // 不再需要 FileSubagentRunStore
  // 不再需要 ApprovalStore

  launch(input: SubagentLaunchInput): SubagentRunHandle;
  waitForBatch(batchId: string): Promise<SubagentBatchResult>;
  getRunSummaries(): SubagentRunSummary[];
}
```

**移除过度持久化:**
- `SubagentRunStore` → 删除
- `ApprovalStore` → 删除
- `.codara/agent-runs/` → 不再创建
- `.codara/approvals/` → 不再创建

---

## 目录结构总览

```
src/
├── config/              # P1: 统一配置
│   ├── settings.ts
│   ├── schema.ts
│   ├── sources.ts
│   ├── cache.ts
│   ├── watcher.ts
│   └── codara-md.ts
├── hooks/               # P2: 生命周期 hooks
│   ├── types.ts
│   ├── registry.ts
│   ├── executor.ts
│   └── middleware.ts
├── permission/          # P3: 权限系统
│   ├── types.ts
│   ├── resolver.ts
│   ├── matcher.ts
│   ├── bash-parser.ts
│   ├── persistence.ts
│   └── middleware.ts
├── context/             # P4: 动态 context 组装
│   ├── system-prompt.ts
│   ├── sections/
│   ├── git-context.ts
│   └── memory-context.ts
├── agent/               # P5: Agent Loop
│   ├── loop.ts
│   ├── state.ts
│   ├── continuation.ts
│   ├── tool-executor.ts
│   ├── tool-concurrency.ts
│   ├── compact.ts
│   └── events.ts
├── session/             # P6: 持久化
│   ├── transcript.ts
│   ├── restore.ts
│   ├── types.ts
│   └── storage.ts
├── memory/              # P6: Memory
│   ├── types.ts
│   ├── loader.ts
│   └── writer.ts
├── cli/                 # P7+P8: CLI
│   ├── store/
│   ├── app/
│   ├── components/
│   ├── rendering/
│   └── main.tsx
├── capability/          # 保留，优化
│   ├── skill/           # Skill 发现和加载
│   ├── subagent/        # Subagent middleware + bootstrap（移除 run-store）
│   ├── task/            # Task store（轻量化）
│   └── command/         # 命令工具
├── integration/         # 保留
│   ├── tool/            # 工具注册和 builtin
│   └── mcp/             # MCP 集成
├── pipeline/            # 保留：middleware pipeline 核心
│   ├── pipeline.ts
│   └── types.ts
└── shared/              # 公共工具
    ├── types.ts
    └── utils.ts
```

**要删除的现有目录/文件:**
- `src/durability/` → 整个目录（替换为 `src/session/`）
- `src/core/agent/run/` → 移到 `src/agent/`
- `src/core/middleware/permission/` → 移到 `src/permission/`
- `src/core/middleware/todo.ts` → 移到 `src/capability/task/`
- `src/observability/hook/` → 移到 `src/hooks/`
- `src/core/pipeline/` → 移到 `src/pipeline/`
- `src/capability/subagent/run-store.ts` → 删除

---

## 实施策略

每个 Phase 独立分支，独立 spec → plan → 实现 → 测试循环：

1. **P1 Settings** → 先做，所有后续 Phase 依赖
2. **P2 Hooks** → 依赖 P1
3. **P3 Permission** → 依赖 P1+P2
4. **P4 Context** → 依赖 P1
5. **P5 Agent Loop** → 依赖 P1-P4
6. **P6 Session/Memory** → 依赖 P5
7. **P7 CLI** → 依赖 P5+P6
8. **P8 Streaming** → 依赖 P7

P1 和 P4 可以并行。P2 和 P4 可以并行。其余串行。

每个 Phase 完成后运行全量测试，确保零回归。

---

## 补充：Reviewer 发现的关键 Gap 修复

### 1. JSONL 崩溃恢复算法

**并发写入:** 使用 advisory file lock（PID + timestamp），5 分钟 TTL 自动回收死锁。

**崩溃恢复:**
- 每行是独立 JSON，部分写入（truncated line）在读取时跳过
- 恢复时：逐行 `JSON.parse`，`try/catch` 跳过损坏行
- 最后一行如果不完整（无 `\n` 结尾），直接丢弃
- 这是 append-only JSONL 的天然优势：只有最后一行可能损坏

**大文件处理:**
- 读取时从文件尾部 seek（`fs.read` + offset），不读整个文件
- 默认读最后 10MB，而非全部 50MB
- 如果需要更多历史：`compact_boundary` 条目标记安全恢复点

### 2. Auto-Compact 阈值参数化

```typescript
function getAutoCompactThreshold(contextWindow: number): number {
  // 保留 buffer 随 context window 缩放
  const bufferRatio = 0.1;  // 10%
  const minBuffer = 8000;
  const maxBuffer = 20000;
  const buffer = Math.min(maxBuffer, Math.max(minBuffer, contextWindow * bufferRatio));
  return contextWindow - buffer;
}
```

4K 模型 buffer = 8000，128K 模型 buffer = 12800，200K+ 模型 buffer = 20000。

### 3. CLI 状态机完整定义（含错误状态）

```
idle → running         （用户提交 prompt）
running → paused       （权限审核 / review）
running → error        （agent 崩溃 / API 错误）
running → idle         （agent 完成 + 无 subagent）
running → subagent_wait（agent 完成 + subagent 仍运行）
paused → running       （用户批准）
paused → idle          （用户取消）
error → idle           （用户确认 / 自动恢复）
error → running        （重试）
subagent_wait → running（subagent 完成 → re-entry）
subagent_wait → idle   （全部完成 + re-entry 完成）
subagent_wait → error  （subagent 崩溃）
```

每个转换是一个纯函数 `(state, event) => newState`，在 `src/cli/store/actions.ts` 中集中定义。

### 4. Subagent 轻量追踪（修正"纯内存"决策）

Reviewer 正确指出：父进程崩溃时需要知道哪些 subagent 在运行。修正方案：

- Subagent 运行记录写入 `~/.codara/tasks/{taskListId}/` 的 task 系统（已有）
- 每个 subagent 启动时创建一个 task（status: in_progress）
- 完成时更新 task（status: completed）
- 崩溃恢复时：读取 in_progress 的 subagent tasks，标记为 failed
- **不再需要独立的 agent-runs/ 目录**——复用 task 系统

### 5. Memory 并行 Prefetch（P4 补充）

在 agent loop 的 pre-turn 阶段：

```typescript
async function* preTurn(state: LoopState) {
  // 并行 prefetch：memory + git context + skills
  const [memory, gitCtx, skills] = await Promise.all([
    loadRelevantMemory(state.lastUserMessage),
    fetchGitContext(),
    discoverSkills(),
  ]);
  state.dynamicContext = { memory, gitCtx, skills };
}
```

Memory 加载不阻塞 git context 和 skills 发现。

### 6. MCP 生命周期合约（P1 补充）

**初始化:** 读取 settings.json 的 `mcpServers` → 创建 McpClient per server → lazy connect

**工具发现:** 连接后 `listTools()` → 转为 LangChain 兼容 tool → 注册到 tool registry

**Schema 缓存:** 工具 schema per-session 缓存，不每次 query 重新获取

**断线重连:** Server 断线 → 标记 tools 为 unavailable → 下次 tool call 时尝试重连

**配置变更:** Settings watcher 检测 `mcpServers` 变化 → disconnect 旧 server → connect 新 server

### 7. Hook 事件完整列表（修正 P2）

保留 15 个核心事件不变。补充说明：

- `PermissionRequest` 在 P2 表格中已列出（第 11 行）
- `TaskCreated`/`TaskCompleted` 已列出（第 12-13 行）
- `ConfigChange`/`CwdChanged` 已列出（第 14-15 行）
- 15 个是 Codara 当前需要的，未来可扩展（hook 系统支持自定义事件类型）

### 8. 目录迁移执行计划

迁移顺序（避免冲突）：

1. 先创建新目录结构（`src/config/`、`src/hooks/`、`src/permission/`、`src/agent/`、`src/session/`、`src/memory/`、`src/pipeline/`、`src/shared/`）
2. 移动 pipeline：`src/core/pipeline/` → `src/pipeline/`（更新所有 import）
3. 逐 Phase 迁移：P1 写新 `src/config/`，旧 `src/config/` 的内容先保留直到新代码替代
4. 每次迁移后运行 `tsc --noEmit` 确认无编译错误
5. 旧 `src/core/` 目录在所有迁移完成后删除
6. `src/durability/` 在 P6 完成后删除
