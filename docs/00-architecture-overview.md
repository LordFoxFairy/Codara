# Codara 架构概览

> [目录](./README.md) | [下一篇: 模型路由 →](./01-model-routing.md)

Codara 是一个基于终端的 AI 编程助手，设计理念类似 Claude Code。它以 CLI 应用的形式运行，连接到 LLM 提供商（Anthropic、OpenAI 或任何 OpenAI 兼容 API），并为模型提供文件系统工具、Shell 执行和代码搜索功能——全部在交互式终端 UI 中完成。

本文档面向维护或扩展代码库的开发者，描述项目的整体架构。

> **💡 想了解系统如何运作？**
>
> 阅读 [架构运行流程](./architecture-runtime.md) 了解从启动到执行的完整流程，以及各组件如何协同工作。

## 文档主线

当前文档体系按”机制优先、策略后置”组织：

1. `01-model-routing`：模型路由（方便调试和模型管理）
2. `02-agent-loop`：执行引擎（核心运行时）
3. `03-tools`：工具系统（能力原语）
4. `04-hooks`：生命周期扩展原语（核心扩展面）
5. `05-memory-system`：运行时记忆管理（auto-memory、session、checkpoints、compression）
6. `06-skills`：策略编排（能力扩展入口）
7. `07-agent-collaboration`：多代理协作机制与策略编排

权限规则细节收敛到附录：`docs/appendix/permissions.md`。

---

## 核心设计理念

**Codara 采用"核心通用 + Skills 扩展"的架构模式。**

```
┌─────────────────────────────────────────────────────────┐
│                    核心系统（通用）                      │
│  - Agent Loop: 基于 stop_reason 的执行引擎              │
│  - Tools: 9 个基础工具（Bash, Read, Write, Edit...）    │
│  - Middleware: Hooks + Permissions 底层机制              │
│  - TUI: 终端界面                                         │
│  - Memory: 记忆与上下文管理                              │
└─────────────────────────────────────────────────────────┘
                          ↑
                          │ 通过 Skills 扩展
                          ↓
┌─────────────────────────────────────────────────────────┐
│                  Skills 扩展层（领域）                   │
│  - 内部扩展: commit, code-review, deploy...              │
│  - 外部扩展: 用户自定义、社区贡献、第三方插件            │
│  - 每个 Skill 自包含: hooks + scripts + agents          │
└─────────────────────────────────────────────────────────┘
```

### 为什么这样设计？

| 传统架构 | Codara 架构 |
|---------|------------|
| 功能硬编码在核心 | 功能通过 Skills 扩展 |
| 难以维护和扩展 | 模块化、自包含 |
| 无法复用和分享 | Skills 可打包分发 |
| 社区贡献困难 | 统一的扩展接口 |

**核心原则：核心通用（middleware + tools + TUI），领域扩展全靠 Skill。** code-review、feature-dev、commit 工作流等都是 skill，不是硬编码功能。

**Skills 是内部和外部扩展的唯一入口**，确保：
- ✅ 更好的维护（模块化、职责清晰）
- ✅ 更好的扩展（统一接口、可复用）
- ✅ 生态建设（可分享、可分发、社区驱动）

详见 [06-技能系统](./06-skills.md) 了解如何通过 Skills 扩展 Codara。

### 核心与 Skills 的职责边界

| 层 | 职责 | 示例 | 不应承载 |
|----|------|------|----------|
| 核心运行时（`src/**`） | 稳定机制与通用契约 | Tool 调度、Hook 事件模型、Permission 求值链、TUI 事件流 | 项目特定流程（如某团队部署步骤） |
| Skills（`.codara/skills/**`） | 场景化能力编排与策略 | `security-check`、`audit-logger`、`code-review`、`commit` | 重写底层引擎语义 |

**设计准则**：
1. 先问“这是机制还是策略”。机制进核心，策略进 Skill。  
2. 若需求经常因项目/团队变化，优先 Skill。  
3. 若需求需要稳定 API 保证并被多 Skill 复用，考虑核心化。  
4. 核心新增能力应服务“更多 Skill”，而不是服务“某一个 Skill”。

---

## 技术栈

| 层级         | 技术                                        |
|---------------|---------------------------------------------------|
| 语言      | TypeScript (ESM, Node >= 18)                      |
| 运行时       | Node.js                                           |
| LLM SDK       | LangChain (`@langchain/core`, `@langchain/openai`, `@langchain/anthropic`) |
| 工具模式  | Zod（通过 LangChain `StructuredTool`）              |
| CLI 框架 | commander                                         |
| 终端 UI   | React + Ink 5（将 React 组件渲染到终端） |
| 文本输入    | ink-text-input                                    |
| Markdown      | marked（解析）+ highlight.js（语法高亮）+ chalk（ANSI 颜色） |
| 文件匹配 | minimatch（glob 模式匹配，用于权限和钩子） |
| Frontmatter   | gray-matter（技能和自定义 Agent 定义） |
| 配置        | dotenv（环境变量加载）+ 自定义 JSON 设置加载器 |
| 测试       | Vitest                                            |

---

## 目录结构

```
src/
├── index.tsx              CLI 入口（commander 设置、启动流程）
├── config.ts              配置加载与合并
│
├── agent/                 核心 Agent 循环与模型管理
│   ├── loop.ts            AgentLoop — 基于 stop_reason 驱动的核心循环
│   ├── model.ts           提供商路由 + 模型创建
│   ├── subagent.ts        子 Agent 生成、自定义 Agent 定义
│   ├── manager.ts         AgentManager — 子 Agent 生命周期注册表
│   ├── events.ts          AgentEvent 类型定义（16 种事件类型）
│   ├── checkpoint.ts      文件快照 + 回滚支持
│   └── system-prompt.ts   系统提示词组装（基础 + 环境 + 记忆 + 技能）
│
├── tools/                 LLM 可调用工具
│   ├── registry.ts        ToolRegistry — 基于名称的工具映射
│   └── definitions/       9 个工具实现
│       ├── bash.ts        Shell 命令执行
│       ├── read.ts        文件读取
│       ├── write.ts       文件创建/覆写
│       ├── edit.ts        基于字符串的文件编辑
│       ├── glob.ts        文件模式搜索
│       ├── grep.ts        内容搜索（ripgrep 风格）
│       ├── task.ts        子 Agent 委派（前台/后台）
│       ├── agent-output.ts 查询后台 Agent 结果
│       └── ask-user.ts    交互式问答对话框
│
├── tui/                   终端 UI（React/Ink 组件）
│   ├── index.tsx          startTUI() — render(<App />)
│   ├── App.tsx            根组件、事件分发、状态管理
│   ├── MessageStream.tsx  可滚动的消息列表
│   ├── StreamingText.tsx  实时更新的 LLM 输出
│   ├── InputArea.tsx      用户文本输入
│   ├── PermissionDialog.tsx 4 选项权限提示
│   ├── QuestionDialog.tsx 多问题对话框
│   ├── StatusBar.tsx      模型/Token/费用/模式状态栏
│   ├── Spinner.tsx        动画加载指示器
│   ├── ToolBlock.tsx      工具调用展示（输入 + 输出）
│   ├── markdown.ts        Markdown 转 ANSI 渲染
│   └── theme.ts           6 主题语义颜色系统
│
├── memory/                记忆与上下文管理
│   ├── loader.ts          3 层记忆加载（用户 → 项目 → 会话）
│   ├── compactor.ts       上下文窗口压缩（裁剪 + LLM 摘要）
│   ├── session-store.ts   会话持久化（~/.codara/sessions/）
│   ├── token-tracker.ts   Token 计数 + 费用计算
│   └── auto-memory.ts     跨会话持久化记忆
│
├── permissions/           权限引擎
│   ├── manager.ts         5 模式权限管理器（deny→ask→allow）
│   └── matcher.ts         基于 Glob 的规则匹配（minimatch）
│
├── hooks/                 生命周期钩子系统
│   ├── engine.ts          HookEngine — 16 种事件类型，Shell 命令执行
│   └── types.ts           钩子事件/动作/结果类型定义
│
└── skills/                可扩展的斜杠命令（扩展唯一入口）
    ├── loader.ts          扫描 .codara/skills/ 目录（含 agents/hooks 发现）
    ├── executor.ts        参数替换 + 动态上下文注入
    └── types.ts           SkillDefinition / SkillInvocation 类型
```

**关键设计：Skills 目录是扩展的唯一入口**
- 所有领域功能（commit、code-review、deploy 等）都是 Skills
- Skills 内部可以使用 hooks、permissions、agents、scripts
- 用户和社区通过 Skills 扩展 Codara，而非修改核心代码

---

## 模块依赖关系图

```
                         ┌──────────────┐
                         │  index.tsx   │  CLI 入口
                         │  (commander) │
                         └──────┬───────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
              ┌─────▼─────┐          ┌──────▼──────┐
              │ config.ts  │          │  tui/App.tsx │
              │            │          │  (React/Ink) │
              └─────┬──────┘          └──────┬───────┘
                    │                        │
                    │         消费 AgentEvent 流
                    │                        │
              ┌─────▼────────────────────────▼──┐
              │          agent/loop.ts           │
              │       (AgentLoop — 核心循环)      │
              └─┬───┬───┬───┬───┬───┬───┬───┬───┘
                │   │   │   │   │   │   │   │
     ┌──────────┘   │   │   │   │   │   │   └─────────────┐
     │              │   │   │   │   │   │                  │
┌────▼────┐  ┌──────▼┐ ┌▼───▼┐ ┌▼───▼┐ ┌▼──────────┐ ┌───▼────────┐
│model.ts │  │tools/ │ │perm/│ │hooks│ │  memory/   │ │  skills/   │
│(路由器) │  │(9个)  │ │管理 │ │引擎 │ │(3层)       │ │(扩展入口)  │
│         │  │       │ │     │ │     │ │            │ │            │
└────┬────┘  └───────┘ └─────┘ └─────┘ └────────────┘ └────────────┘
     │
┌────▼──────────┐
│  subagent.ts  │
│  manager.ts   │
│ (子循环)       │
└───────────────┘
```

关键依赖规则：
- `agent/loop.ts` 是协调所有子系统的核心枢纽。
- `tui/` 依赖 `agent/`（消费 `AgentEvent` 流），但反过来不成立。
- `tools/` 注册到循环中，但不反向依赖循环。
- `subagent.ts` 创建受限工具集的子 `AgentLoop` 实例。
- `config.ts` 是纯数据模块，没有运行时依赖。
- **`skills/` 是扩展的唯一入口**，内部可以组合使用 hooks、permissions、agents。

---

## 数据流

### 交互模式

```
用户输入
    │
    ▼
┌──────────┐     ┌──────────────────────────────────────────────────┐
│ InputArea │────▶│                  App.tsx                         │
└──────────┘     │  handleSubmit() → agent.run(input) → for await  │
                 └───────────────────────┬──────────────────────────┘
                                         │
                     AgentEvent 流（AsyncGenerator）
                                         │
                                    ┌────▼────┐
                                    │AgentLoop│
                                    │  .run() │
                                    └────┬────┘
                                         │
                              ┌──────────┼──────────┐
                              │          │          │
                         ┌────▼──┐  ┌────▼──┐  ┌───▼────┐
                         │  LLM  │  │ 工具  │  │钩子/   │
                         │  流   │  │ 执行  │  │权限    │
                         └───────┘  └───────┘  └────────┘
```

### 核心循环（基于 stop_reason 驱动）

`agent/loop.ts` 中的 Agent 循环采用 `while(true)` 模式，由 LLM 的 `stop_reason` 驱动：

```
while (true) {
    1. 安全检查（max_turns, max_budget, abort）
    2. 如果达到 95% 容量则进行上下文压缩
    3. 流式接收 LLM 响应（收集分块）
    4. 追踪 Token 使用量
    5. 检查 stop_reason：
       ├── "end_turn"     → 触发 Stop 钩子 → yield done → 返回
       ├── "tool_use"     → 执行工具调用（见下文）→ 继续
       ├── "max_tokens"   → 继续（让 LLM 完成输出）
       ├── "pause_turn"   → 继续
       ├── "refusal"      → yield done(refusal) → 返回
       └── "context_exceeded" → 压缩 → 继续

    每次工具调用的执行流程：
       a. PreToolUse 钩子（可拒绝或修改输入）
       b. 权限检查（deny → ask → allow）
       c. 文件检查点（仅 Write/Edit）
       d. 执行工具
       e. PostToolUse / PostToolUseFailure 钩子
       f. 将 ToolMessage 追加到对话中
}
```

### 非交互模式

当提供 `--prompt` 参数时，`index.tsx` 直接消费 `AgentEvent` 流而不启动 TUI，将文本写入 stdout，将工具事件写入 stderr。

---

## 配置链

配置通过分层合并系统解析。后面的源会覆盖前面的。

```
CLI 参数（--model, --permission-mode, --theme, ...）
       │
       ▼
resolveConfig() 与设置文件合并
       │
       ▼
设置文件（按低 → 高优先级合并）：
  1. <cwd>/settings.json          （项目共享）
  2. <cwd>/settings.local.json    （项目本地，已 gitignore）
       │
       ▼
模型路由（config.json）：
  1. <cwd>/.codara/config.json          （项目）
  2. ~/.codara/config.json              （用户回退）
       │
       ▼
AppConfig {
  model, maxTurns, maxBudgetUsd, timeoutMs,
  permissionMode, cwd, prompt?, resume?, theme,
  modelRouter?
}
```

### 设置文件格式

```json
{
  "permissions": {
    "allow": ["Read(*)", "Glob(*)", "Grep(*)", "Bash(git *)"],
    "deny": ["Bash(rm -rf *)"],
    "ask": ["Write(*)"],
    "defaultMode": "default"
  },
  "hooks": {
    "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo $TOOL_INPUT" }] }]
  }
}
```

### 模型路由器（config.json）

```json
{
  "providers": [
    { "name": "openrouter", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "$OPENROUTER_API_KEY", "models": ["anthropic/claude-sonnet-4"] },
    { "name": "anthropic", "apiKey": "$ANTHROPIC_API_KEY", "models": ["claude-sonnet-4-6"] }
  ],
  "router": {
    "default": "openrouter:anthropic/claude-sonnet-4",
    "haiku": "anthropic:claude-haiku-4-5"
  }
}
```

---

## 关键设计原则

### 1. 基于 stop_reason 驱动的循环

Agent 循环不使用固定的迭代次数。相反，它运行 `while(true)` 并在每次响应后检查 LLM 的 `stop_reason` 来决定下一步操作。这与 Claude Code 的工作方式一致：

- `"tool_use"` 表示模型想调用工具——执行工具并继续循环。
- `"end_turn"` 表示模型已完成——输出最终响应。
- `"max_tokens"` 表示输出被截断——继续让其完成。
- 其他原因（`refusal`、`context_exceeded`）有专门的处理逻辑。

安全阀（最大轮次、最大预算、中止信号）防止循环失控。

### 2. 事件驱动的 TUI

TUI 永远不会同步调用 Agent。相反：

1. `App.tsx` 调用 `agent.run(input)`，返回一个 `AsyncGenerator<AgentEvent>`。
2. TUI 通过 `for await` 遍历事件，根据每个事件更新 React 状态。
3. 交互式事件（权限请求、用户提问）使用 Promise 回调模式：循环 yield 一个带有 `resolve()` 函数的事件，然后 `await` 该 Promise。TUI 渲染对话框，用户响应时调用 `resolve()`。

这使 Agent 循环和 TUI 完全解耦。同一个 `AgentEvent` 流既可以被 TUI 消费（交互模式），也可以被简单的 stdout 写入器消费（非交互模式）。

### 3. 提供商无关的模型路由

所有模型解析都通过 `agent/model.ts` 中的单一路径：

1. 在 `config.json` 的路由映射中查找模型名称（别名解析）。
2. 拆分为 `provider:modelId`。
3. 查找提供商的配置（baseUrl、apiKey）。
4. 创建对应的 LangChain 聊天模型：
   - 有 `baseUrl` → `ChatOpenAI`（OpenAI 兼容，适用于 OpenRouter、Ollama 等）
   - 提供商为 `"anthropic"` 且无 baseUrl → 原生 `ChatAnthropic`
   - 否则 → 原生 `ChatOpenAI`

这意味着只需在 `config.json` 中添加提供商，Codara 就能与任何 OpenAI 兼容 API 配合使用。

### 4. 3 层记忆系统

系统提示词由 3 层指令记忆组装而成，按优先级顺序加载：

| 层级    | 来源                                     | 范围         |
|----------|--------------------------------------------|---------------|
| 用户上下文 | `~/.codara/CODARA.md` + `~/.codara/rules/*.md` | 用户全局   |
| 项目上下文 | `CODARA.md` 或 `.codara/CODARA.md` + `.codara/rules/*.md` + `CODARA.local.md` | 团队共享 + 个人覆盖 |
| 会话记忆 | `~/.codara/projects/{hash}/memory/MEMORY.md` | Agent 自动写入 |

加载器会沿目录树向上查找至 git 根目录，收集项目上下文层。规则文件支持 frontmatter 剥离和 globs 条件加载。`@import` 语法允许包含其他文件（1 层直接引用，并有路径遍历防护）。

### 5. 隔离的子 Agent

子 Agent 运行在完全隔离的上下文窗口中：

- 拥有独立 `messages[]` 的全新 `AgentLoop` 实例。
- 无法访问父级对话历史。
- 不能生成进一步的子 Agent（排除 Task 工具）。
- 不能向用户提问（排除 AskUserQuestion 工具）。
- 向父级返回压缩摘要，而非完整输出。

三种内置 Agent 类型：`Explore`（只读，使用 haiku 模型）、`Plan`（只读，架构师）和 `general-purpose`（完整工具集）。自定义 Agent 在 `.codara/skills/*/agents/*.md` 中定义，通过 frontmatter 配置工具、模型、权限和最大轮次。

### 6. 权限引擎

权限系统按严格的优先级顺序评估规则：

```
bypassPermissions 模式？ → 允许一切
plan 模式？ → 允许只读，Bash 需询问，拒绝写入
deny 规则？ → 阻止
ask 规则？ → 提示用户
allow 规则？ → 放行
只读工具？ → 放行
acceptEdits 模式？ → 允许 Write/Edit
dontAsk 模式？ → 拒绝（未预批准 = 阻止）
default 模式？ → 询问用户
```

规则使用 glob 匹配：`Bash(git *)`、`Edit(src/**)`、`mcp__*`。对于 Bash 命令，仅匹配第一个命令段，以防止链式绕过攻击，如 `git status && rm -rf /`。

用户权限决策可以限定范围为：`allow_once`、`allow_session`（内存中）或 `always_allow`（会话结束时持久化到 `settings.local.json`）。

### 7. 生命周期钩子

16 种钩子事件在 Agent 生命周期的关键节点触发。钩子是在 `settings.json` 中配置的 Shell 命令，通过环境变量和 stdin JSON 接收上下文。

退出码约定：
- `exit 0` — 批准（stdout 可包含 JSON 动作：`{"action":"modify","modifiedInput":{...}}`）
- `exit 2` — 拒绝/阻止（stderr 内容作为展示给 Agent 的原因）
- 其他退出码 — 批准（stderr 仅记录日志，不阻塞）

钩子可以拦截和修改工具输入、阻止工具调用、阻止会话终止等。每个事件可以有多个匹配器，第一个拒绝会短路。

### 8. 上下文压缩

当对话接近模型上下文窗口的 95%（默认 200K Token）时：

1. 裁剪工具输出（对超过 1000 字符的消息保留前 500 + 后 200 字符）。
2. 如果仍超过 60% 容量，使用 LLM 对较旧的消息进行摘要。
3. 插入 `compact_boundary` 标记，仅保留近期消息。

这使得长时间运行的会话不会遇到上下文限制。也可以通过 `/compact` 命令手动触发压缩。

---

## 启动流程

`src/index.tsx` 中的启动流程：

```
1. 解析 CLI 参数（commander）
2. loadSettings(cwd) — 合并设置文件
3. resolveConfig(opts, settings) → AppConfig
4. loadModelConfig(cwd) → ModelRouterConfig
5. new AgentLoop({ appConfig, permissionRules, hookConfig })
6. 注册 9 个工具到 toolRegistry
7. new AgentManager() 用于后台子 Agent 追踪
8. agent.init()：
   a. 加载 3 层记忆
   b. 发现技能
   c. 组装系统提示词
   d. 创建 LLM 模型（提供商路由 + 工具绑定）
   e. 触发 SessionStart 钩子
9. 清理旧会话（尽力而为，非阻塞）
10. 安装 SIGINT/SIGTERM 处理器
11. 启动 TUI（交互模式）或消费事件流（非交互模式）
```

---

## 关键文件参考

| 文件                            | 行数 | 用途                                    |
|---------------------------------|-------|--------------------------------------------|
| `src/index.tsx`                 | ~165  | CLI 入口、启动流程、模式路由     |
| `src/config.ts`                 | ~165  | 设置加载、配置合并           |
| `src/agent/loop.ts`            | ~800  | 核心 Agent 循环（stop_reason + 工具执行）  |
| `src/agent/model.ts`           | ~163  | 提供商路由 + 模型创建          |
| `src/agent/subagent.ts`        | ~355  | 子 Agent 生成 + 自定义 Agent          |
| `src/agent/manager.ts`         | ~120  | 后台 Agent 生命周期注册表        |
| `src/agent/events.ts`          | ~67   | AgentEvent 联合类型（16 种变体）        |
| `src/agent/checkpoint.ts`      | ~103  | 文件快照 + 回滚                     |
| `src/agent/system-prompt.ts`   | ~85   | 系统提示词组装                     |
| `src/tools/registry.ts`        | ~35   | 基于名称的工具映射                        |
| `src/tui/App.tsx`              | ~395  | TUI 根组件、事件分发         |
| `src/tui/theme.ts`             | ~225  | 6 种颜色主题                             |
| `src/memory/loader.ts`         | ~220  | 3 层记忆加载                     |
| `src/memory/compactor.ts`      | ~120  | 上下文压缩                         |
| `src/memory/session-store.ts`  | ~126  | 会话持久化                        |
| `src/memory/token-tracker.ts`  | ~96   | Token 计数 + 费用计算          |
| `src/permissions/manager.ts`   | ~149  | 5 模式权限引擎                   |
| `src/permissions/matcher.ts`   | ~98   | Glob 规则匹配                         |
| `src/hooks/engine.ts`          | ~196  | 钩子执行引擎                      |
| `src/hooks/types.ts`           | ~67   | 16 种钩子事件类型                        |
| `src/skills/loader.ts`         | ~116  | 技能发现                            |
| `src/skills/executor.ts`       | ~103  | 技能展开 + 上下文注入        |

---

> [目录](./README.md) | [下一篇: 模型路由 →](./01-model-routing.md)
