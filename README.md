# Codara

AI 驱动的终端代码代理运行时与产品 facade。

## 当前状态

- 默认基线已干净：
  - `bun run typecheck`
  - `bun run lint`
  - `bun test`
- 主心智已经收敛：一切围绕 `createAgent(...)`，`codara` 只是 facade，`session` 只是宿主。

## 核心能力

- 多 provider / 多模型路由
- `createAgent(...)` 统一执行内核
- `createCodara(...)` / `openCodaraSession(...)` / `openLatestCodaraSession(...)` 高层产品入口
- checkpoint 恢复与 session source stack
- 显式 session 打开与 checkpoint compact 宿主接口
- `AGENTS.md` 投影注入
- summary + context budget 上下文管理
- 宿主级 slash commands（`/help`、`/memory`、`/resume`、`/compact`、`/reload`）
- `todo` agent 内部状态
- `Task` / subagent 委派
- `TaskCreate` / `TaskUpdate` / `TaskList` 共享协调层
- HIL pause / resume

## 架构主线

```text
src/index.ts
  -> core/codara facade
  -> session runtime
  -> openCodaraSession(...) / openLatestCodaraSession(...)
  -> createAgent(...)
  -> middleware pipeline
  -> model / tool loop
  -> checkpoint
```

当前边界：

- `agent`: 执行内核，负责 invoke、stream、resume、tool loop、checkpoint restore
- `codara`: 默认装配和对外入口
- `session`: 宿主与 source stack
- `checkpoint`: 只负责恢复运行态
- `summary`: `messages` 压缩，不是 checkpoint
- `session metadata`: 会话级目录信息 + 累计 token usage + 最近一次 context window 占用

## 状态模型

- `messages`: 对话历史与 summary message
- `context`: agent 持久上下文
- `values`: agent 内部轻量状态，如 `todo`
- `runtime.context`: 本轮临时运行数据，如 `skills` runtime、budget snapshot
- `session metadata.usage`: 会话累计/最近一次模型 token usage
- `session metadata.contextWindow`: 最近一次可见上下文占用与百分比

## Source Stack

- `AGENTS.md` = guidelines
- source stack 属于 session，不属于 agent
- 同一个 Codara runtime 支持 `reloadSources()`
- 历史 checkpoint 可通过 `compactCheckpoints()` 手动整理
- slash commands 也属于 runtime surface，不进入 `createAgent(...)` 内核

## Slash Commands

- `/help`
  - 列出当前内建命令与由 skills 暴露的动态命令
- `/memory`
  - 默认展示可选的 `AGENTS.md` scope
  - 支持 `show / project / global`
  - `project/global` 返回宿主 `open_file` 动作，便于 UI/CLI 打开目标文件
  - 编辑后配合 `/reload` 生效
- `/resume`
  - 通过 `sessionId` 恢复指定历史会话
  - permission/HIL 不走 slash command，走通用 HIL 面板或直接编辑 settings JSON
- `/compact`
  - 手动触发当前 conversation context 压缩
  - 复用已有 `conversation-context -> summary` 路径，不重写第二套逻辑
  - `/compact checkpoints [keepLast]` 可手动整理 checkpoint 历史
- `/reload`
  - 清空当前 session 的 `AGENTS.md` source cache
  - 同时刷新 skills discovery cache

这些命令当前由 `src/core/codara/commands/` 管理，并通过 `createCodara()` 返回的 runtime surface 暴露。

默认 conversation lifecycle 会在接近输入窗口上限时自动 compact：
- 默认 alias 为 `sonnet`
- 优先使用模型 metadata 推导的 `contextWindow`
- 默认在可用输入预算的 95% 附近触发压缩
- 手动 `/compact` 仍可强制立即压缩
- 如需显式分支，使用 `fork()` 生成新的 `sessionId`

## Todo / Task / Subagent

- `todo`
  - 属于单 agent 内部状态
  - 存在 `state.values`
  - 随 checkpoint 恢复
- `Task`
  - 正式委派入口
  - 本质是 spawn subagent
- `TaskCreate / TaskUpdate / TaskList`
  - 共享协调层
  - 走 `TaskStore`
- `subagent`
  - 与 main agent 是同一种 agent 系统
  - 仅身份、上下文、definition 有差异
  - 默认禁止继续派发 subagent

## Skills 数据流

```text
agents/*.md
  -> SkillsMiddleware
  -> runtime.shared.skills
  -> Task
  -> createCodara / createAgent
```

约束：

- `Task` 不直接读 store，不绕过 middleware
- agent definitions 来自 `.codara/skills/*/agents/*.md` 或显式 `agents/` roots
- definition 当前不自动切 model / middleware，只描述差异与 hints

## Middleware 顺序

默认顺序：

```text
logging
-> caller middlewares
-> todo / shared tasks / Task (runtime defaults)
-> budget
-> permission (generic HIL-backed middleware in runtime)
```

说明：

- `logging` 只做观测
- `todo / shared tasks / Task` 是 `createCodaraRuntime(...)` 的默认产品工作流能力
- `budget` 统一负责完整输入预算估算与摘要压缩
- `permission` 是权限策略 middleware，本身复用通用 HIL pause / resume 协议
- 通用 `hil` 仍然是底层协议层，不等于 `/resume`
- 会话恢复与 HIL 恢复是两种不同能力：
  - `openCodaraSession(...)` / `openLatestCodaraSession(...)` = 打开历史会话，并在返回前 hydrate 已恢复状态
  - `resumePause(...)` / `resumePauseStream(...)` = 恢复 HIL 暂停

## 配置

模型路由配置位于 `~/.codara/config.json` 或项目内 `.codara/config.json`。  
模型窗口与输出 token 元数据单独放在 `model-metadata.json`。

当前正式格式：

```json
{
  "providers": [
    {
      "name": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "$OPENROUTER_API_KEY",
      "models": [
        "anthropic/claude-sonnet-4",
        "anthropic/claude-opus-4"
      ]
    },
    {
      "name": "deepseek",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKey": "$DEEPSEEK_API_KEY",
      "models": ["deepseek-chat"]
    }
  ],
  "router": {
    "default": "openrouter:anthropic/claude-sonnet-4",
    "sonnet": "openrouter:anthropic/claude-sonnet-4",
    "fast": "openrouter:anthropic/claude-3.5-haiku"
  }
}
```

```json
{
  "anthropic/claude-sonnet-4": {
    "contextWindow": 200000,
    "maxOutputTokens": 8192
  },
  "anthropic/claude-opus-4": {
    "contextWindow": 200000,
    "maxOutputTokens": 8192
  }
}
```

## 快速开始

安装依赖：

```bash
bun install
```

运行 CLI：

```bash
bun run dev
```

质量检查：

```bash
bun run typecheck
bun run lint
bun test
```

## 测试策略

- 默认 `bun test` 无外部网络依赖
- provider stack integration 使用本地 mock OpenAI server
- 单个能力尽量单独测试，一个主题一个 `.test.ts`
- 若需要真实 provider smoke，可单独加专项测试，不污染默认基线

## 关键目录

```text
src/core/agents        # createAgent 内核、loop、checkpoint runtime glue
src/core/codara        # facade、session、source stack、装配
src/core/middleware    # logging/summary/todo/hil/permission/context-budget
src/core/skills        # skills store、runtime、agent definitions
src/core/tasks         # subagent / Task / shared task store 统一域
src/core/provider      # model routing、registry、factory
tests/unit             # 单元测试
tests/integration      # integration 与本地 mock provider stack
```

## 建议阅读顺序

1. `src/core/README.md`
2. `src/core/agents/README.md`
3. `src/core/codara/facade.ts`
4. `src/core/agents/agent-loop.ts`
5. `src/core/middleware/context-budget.ts`

## 当前共识

- 不再引入第二套 agent runtime
- 不做 profile 驱动的自动 model / middleware 切换
- `team` 暂不进入当前主线
- 继续以 `createAgent(...)` 为中心做后续重构与优化
