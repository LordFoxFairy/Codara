# Codara 架构概览

> [目录](./README.md) | [下一篇: 模型路由 →](./01-model-routing.md)

Codara 是一个基于终端的 AI 编程助手，设计理念类似 Claude Code。它以 CLI 应用的形式运行，连接到 LLM 提供商（Anthropic、OpenAI 或任何 OpenAI 兼容 API），并为模型提供文件系统工具、Shell 执行和代码搜索功能——全部在交互式终端 UI 中完成。

本文档面向维护或扩展代码库的开发者，描述项目的整体架构。

> **状态说明（请先读）**
>
> 本篇是**目标架构蓝图**：用于指导后续开发与重构，不要求与当前仓库实现逐文件完全一致。
> 你应把这里视为“设计约束与演进方向”，再结合源码判断“当前落地进度”。

> **💡 想了解系统如何运作？**
>
> 阅读 [架构运行流程](./architecture-runtime.md) 了解从启动到执行的完整流程，以及各组件如何协同工作。

## 文档主线

当前文档体系按“机制优先、策略后置”组织：

1. `01-model-routing`：模型路由（方便调试和模型管理）
2. `02-agent-loop`：执行引擎（核心运行时）
3. `03-tools`：工具系统（能力原语）
4. `04-hooks`：生命周期扩展原语（核心扩展面）
5. `05-memory-system`：运行时记忆管理（auto-memory、session、checkpoints、compression）
6. `06-skills`：策略编排（能力扩展入口）
7. `07-agent-collaboration`：多代理协作机制与策略编排

权限规则细节收敛到附录：`docs/appendix/permissions.md`。

## 跨终端可执行约束

本套文档的目标不是“解释概念”，而是“让任意代码终端可直接落地实现”。因此每一章都应满足以下约束：

1. **边界清晰**：明确该模块负责什么、不负责什么（避免跨层实现）。
2. **契约明确**：写清输入/输出、关键状态、失败路径（至少描述主路径 + 一个异常路径）。
3. **落点唯一**：每项设计决策都指向一个主落点（核心运行时或 skill），避免“到处都能改”。
4. **可验收**：每个环节都给出可观察信号（事件、日志、文件变化或返回结构），便于回归验证。
5. **状态标注**：区分“目标蓝图”与“当前实现”，减少接手开发时的误判。

## 面向开发的落点决策树

在开始实现前，先回答两个问题：

1. 这是“机制”还是“策略”？
2. 这个能力是否需要被多个项目/团队复用？

决策规则：

- 若是机制且跨场景复用：进入核心运行时层。
- 若是策略且随项目变化：优先进入 skills 扩展层。
- 若暂时无法判断：先做 skill 验证，确认稳定后再评估核心化。

这条规则用于约束后续开发，避免把业务策略长期沉淀到核心引擎。

---

## 核心设计理念

**Codara 采用"核心通用 + Skills 扩展"的架构模式。**

```
┌─────────────────────────────────────────────────────────┐
│                    核心系统（通用）                      │
│  - Agent Loop: 基于 tool_calls 主路径的执行引擎         │
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
| 核心运行时层 | 稳定机制与通用契约 | Tool 调度、Hook 事件模型、Permission 求值链、TUI 事件流 | 项目特定流程（如某团队部署步骤） |
| Skills 扩展层 | 场景化能力编排与策略 | `security-check`、`audit-logger`、`code-review`、`commit` | 重写底层引擎语义 |

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

## 模块分层（抽象）

| 模块层 | 核心职责 | 关键输入 | 关键输出 |
|---|---|---|---|
| CLI 入口层 | 解析参数、加载配置、选择交互模式 | CLI 参数、环境变量、项目设置 | 应用配置、运行模式 |
| Agent 循环层 | 驱动对话轮次与工具执行 | 用户输入、历史消息、模型响应 | Agent 事件流、最终答复 |
| 模型路由层 | 别名解析与提供商选择 | 模型别名、路由配置 | 可调用模型实例 |
| 工具执行层 | 提供文件/命令/搜索等原语 | 工具调用参数 | 结构化工具结果 |
| 权限与钩子层 | 运行前后拦截、审批与审计 | 工具调用上下文、权限规则 | 允许/拒绝决策、变更后的输入 |
| 记忆层 | 多层上下文加载与压缩 | 用户/项目/会话记忆 | 系统提示词补充、压缩后的消息 |
| 交互呈现层 | 消费事件流并渲染终端 UI | Agent 事件流、用户操作 | 对话可视化与交互结果 |
| Skills 扩展层 | 承载场景化流程与策略编排 | 技能定义、运行时上下文 | 领域能力扩展、可复用工作流 |

**关键设计：Skills 是扩展的唯一入口**
- 所有领域功能（commit、code-review、deploy 等）都是 Skills
- Skills 内部可以使用 hooks、permissions、agents、scripts
- 用户和社区通过 Skills 扩展 Codara，而非修改核心代码

---

## 模块依赖关系图

```
                   ┌──────────────────┐
                   │   CLI 入口层      │
                   │ 参数/模式/配置加载 │
                   └────────┬─────────┘
                            │
                    ┌───────▼────────┐
                    │   Agent 循环层  │
                    │  事件驱动执行引擎 │
                    └──┬─────┬───────┘
                       │     │
             ┌─────────▼─┐ ┌─▼──────────┐
             │ 模型路由层 │ │ 交互呈现层  │
             │ provider  │ │ 事件消费/UI │
             └──────┬────┘ └────────────┘
                    │
       ┌────────────┼────────────┬────────────┬────────────┐
       │            │            │            │            │
  ┌────▼─────┐ ┌────▼─────┐ ┌────▼─────┐ ┌────▼─────┐ ┌────▼──────┐
  │ 工具执行层 │ │ 权限判定层 │ │ 钩子扩展层 │ │ 记忆管理层 │ │ Skills层   │
  │ 能力原语   │ │ allow/ask  │ │ 生命周期   │ │ 加载/压缩   │ │ 策略编排   │
  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └───────────┘
```

关键依赖规则：
- Agent 循环层是协调所有子系统的核心枢纽。
- 交互呈现层依赖 Agent 事件流，但 Agent 循环层不反向依赖 UI。
- 工具执行层作为能力提供方被循环调用，不持有循环控制权。
- 子代理能力运行在隔离子循环中，避免污染主循环上下文。
- 配置层是纯数据输入模块，不承载运行时状态。
- **Skills 层是扩展唯一入口**，可组合权限、钩子、子代理与工具能力。

---

## 数据流

### 交互模式

```
用户输入
    │
    ▼
┌─────────────────┐     ┌──────────────────────────────────────────────┐
│ 终端输入组件     │────▶│ 交互控制层                                   │
└─────────────────┘     │ submit → 触发 Agent 运行 → 消费事件流         │
                        └───────────────────────┬──────────────────────┘
                                                │
                            AgentEvent 流（AsyncGenerator）
                                                │
                                          ┌─────▼─────┐
                                          │Agent 循环层│
                                          └─────┬─────┘
                                                │
                                ┌───────────────┼───────────────┐
                                │               │               │
                            ┌───▼────┐      ┌───▼────┐      ┌───▼────┐
                            │ 模型流  │      │ 工具层  │      │ 权限/钩子│
                            └─────────┘      └────────┘      └────────┘
```

### 核心循环（tool_calls 主路径 + stop_reason 辅助）

Agent 循环层采用 `while(true)` 模式，主判断信号是 `tool_calls` 是否为空，`stop_reason` 用于处理边缘状态：

```
while (true) {
    1. 安全检查（max_turns, max_budget, abort）
    2. 如果达到 95% 容量则进行上下文压缩
    3. 流式接收 LLM 响应（收集分块）
    4. 追踪 Token 使用量
    5. 检查响应：
       ├── tool_calls 非空 → 执行工具调用（见下文）→ 继续
       ├── tool_calls 为空 → 触发 Stop 钩子 → yield done → 返回
       └── stop_reason 用于边缘处理：
           - "max_tokens" / "pause_turn" → 继续
           - "refusal" → yield done(refusal) → 返回
           - "context_exceeded" → 压缩 → 继续

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

当提供 `--prompt` 参数时，CLI 非交互入口直接消费 `AgentEvent` 流而不启动 TUI，将文本写入 stdout，将工具事件写入 stderr。

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

### 1. 基于 tool_calls 主路径的循环

Agent 循环不使用固定的迭代次数。相反，它运行 `while(true)` 并在每次响应后优先检查 `tool_calls` 来决定下一步操作；`stop_reason` 仅用于辅助边缘状态处理。这与 Claude Code 的工作方式一致：

- `tool_calls` 非空表示模型想调用工具——执行工具并继续循环。
- `tool_calls` 为空表示模型已完成——输出最终响应。
- `"max_tokens"` 表示输出被截断——继续让其完成。
- 其他原因（`refusal`、`context_exceeded`）有专门的处理逻辑。

安全阀（最大轮次、最大预算、中止信号）防止循环失控。

### 2. 事件驱动的 TUI

TUI 永远不会同步调用 Agent。相反：

1. 交互控制层调用 `agent.run(input)`，返回一个 `AsyncGenerator<AgentEvent>`。
2. TUI 通过 `for await` 遍历事件，根据每个事件更新 React 状态。
3. 交互式事件（权限请求、用户提问）使用 Promise 回调模式：循环 yield 一个带有 `resolve()` 函数的事件，然后 `await` 该 Promise。TUI 渲染对话框，用户响应时调用 `resolve()`。

这使 Agent 循环和 TUI 完全解耦。同一个 `AgentEvent` 流既可以被 TUI 消费（交互模式），也可以被简单的 stdout 写入器消费（非交互模式）。

### 3. 提供商无关的模型路由

所有模型解析都通过模型路由层的单一路径：

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

三种内置 Agent 类型：`Explore`（只读，使用 haiku 模型）、`Plan`（只读，架构师）和 `general-purpose`（完整工具集）。自定义 Agent 通过 skills 中的 agent 定义文档扩展，并通过 frontmatter 配置工具、模型、权限和最大轮次。

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

规则使用 glob 匹配：`Bash(git *)`、`Edit(project/**)`、`mcp__*`。对于 Bash 命令，仅匹配第一个命令段，以防止链式绕过攻击，如 `git status && rm -rf /`。

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

## 目标启动流程（开发蓝图）

以下为 CLI 入口组织的目标启动流程：

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

## 关键模块清单（抽象职责）

| 模块 | 用途 |
|---|---|
| CLI 入口层 | 启动流程、交互/非交互模式路由 |
| 配置层 | 设置加载与合并 |
| Agent 循环层 | 核心循环（tool_calls 主路径 + 工具执行） |
| 模型路由层 | 提供商路由 + 模型创建 |
| 子代理管理层 | 子 Agent 生成、生命周期追踪 |
| 事件模型层 | 统一事件类型与流转契约 |
| 检查点层 | 文件快照与回滚保障 |
| 系统提示词层 | 基础指令与上下文组装 |
| 工具注册层 | 工具能力映射与分发 |
| 交互呈现层 | 事件消费、终端渲染与交互 |
| 记忆层 | 多层记忆加载、压缩、持久化、计量 |
| 权限层 | 多模式权限判定与规则匹配 |
| 钩子层 | 生命周期扩展与动作执行 |
| Skills 层 | 技能发现、参数展开与场景编排 |

---

> [目录](./README.md) | [下一篇: 模型路由 →](./01-model-routing.md)
