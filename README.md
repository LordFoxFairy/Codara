# Codara

Codara 是一个面向终端代码代理的运行时与产品 facade。它把 `createAgent(...)` 执行内核、session/checkpoint、middleware、skills、tasks、slash commands 和 CLI 宿主收敛成一条完整产品链路，而不是一组松散拼装件。

## Overview

- 以 `src/core` 为主线，`createAgent(...)` 负责模型与工具循环，`createCodara(...)` / `createCodaraRuntime(...)` 负责产品级默认装配。
- 默认 runtime 已包含 todo、`Task`、共享任务工具、permission/HIL、logging、summary/context budget 等工作流能力。
- CLI 不拥有第二套 agent 或 command 逻辑，只消费 core 暴露的 runtime、runtime events、commands 和 host actions。

## Features

- 统一的终端代理 runtime：session、checkpoint restore、compact、reload、resume
- 默认工作流能力：todo、`Task`、`TaskCreate`、`TaskUpdate`、`TaskList`
- 技能系统：项目级与全局 `.codara/skills`、skill commands、subagents
- 权限与交互：generic HIL、permission middleware、settings 文件初始化与编辑
- 结构化运行事件：turn、model、tool、task、hil、command、summary
- 真实宿主命令面：`/help`、`/clear`、`/status`、`/memory`、`/permissions`、`/plugin`、`/resume`、`/compact`、`/reload`

## Architecture

```text
src/index.ts
  -> src/core/codara
  -> src/core/sessions
  -> src/core/agents
  -> src/core/middleware
  -> src/core/skills
  -> src/core/tasks
  -> src/core/commands
```

核心边界：

- `src/core/agents`: `createAgent(...)`、tool loop、checkpoint runtime glue
- `src/core/codara`: product facade、runtime 默认装配、session 打开与恢复
- `src/core/middleware`: logging、context budget、todo、HIL、permission
- `src/core/skills`: skill store、runtime、skill commands、agent definitions
- `src/core/tasks`: `Task` / shared task store / subagent coordination
- `src/core/commands`: slash command registry、command execution、host action protocol
- `src/cli`: Ink CLI，只消费 core 暴露的 runtime 与 command surface

## Quick Start

安装依赖：

```bash
bun install
```

启动 CLI：

```bash
bun run dev
```

常用校验入口：

```bash
bun run check:fast
bun run check:cases
bun run check
```

- `bun run check:fast`: 日常快速自检，运行 `lint + typecheck`
- `bun run check:cases`: 端到端验收入口，运行 `check:fast + tests/cases`
- `bun run check`: 完整默认基线，运行 `check:fast + bun test`

## Commands

当前 built-in slash commands 由 `src/core/commands/` 管理，并通过 runtime 对宿主开放：

- `/help`: 分页列出命令，支持 `/help <command>` 查看详情；skill command 详情会展示 execution mode、scope、`allowed-tools` 和 shell 依赖
- `/clear`: 清空当前 conversation state，保留当前 `sessionId`
- `/status`: 展示 runtime、session、context window、memory、permissions 状态
- `/memory`: 支持 `show / project / global`，`project` 和 `global` 返回 `open_file` host action
- `/permissions`: 支持 `show / edit`，`edit` 返回项目 `.codara/settings.local.json` 的 `open_file` action
- `/plugin`: 当前支持 `install`
- `/resume`: 通过 `sessionId` 重新打开指定历史会话
- `/compact`: 手动 compact 当前 conversation，或用 `/compact checkpoints [keepLast]` 整理 checkpoint 历史
- `/reload`: 刷新当前 session 的 `AGENTS.md` 与 skills source cache

skill commands 也会进入同一套 command surface：

- `/help` 会按 built-in commands 与 skill commands 分组展示
- `/help <skill-command>` 会明确它是 `agent workflow`
- 执行前会检查 skill 的 `allowed-tools`
- 若 runtime 缺少所需工具，或 `Bash(...)` 依赖的 shell command 不在 `PATH`，会先返回可操作的错误提示，而不是盲目进入 agent

## Plugin Compatibility

Codara 不引入第二套 plugin runtime，而是把 Claude 风格插件导入到现有 skills/commands 体系里。

当前已验证的安装语法包括：

- `/plugin install superpowers@claude-plugins-official`
- `/plugin install code-review@claude-plugins-official`
- `/plugin install skill-creator@claude-plugins-official`

兼容策略：

- 若插件提供 `skills/*`，则直接导入 `.codara/skills`
- 若插件只提供 `commands/*.md`，则翻译成 Codara skill command 后导入
- 默认安装到全局 `~/.codara/skills`
- 若项目 `.codara/settings.json` 配置 `"plugins": { "installGlobal": false }`，则默认安装到当前项目 `.codara/skills`

## Validation

默认要求是先过静态检查，再看端到端 cases。

建议顺序：

```bash
bun run check:fast
bun test tests/cases
```

如果只验证 command surface，可聚焦：

```bash
bun test tests/unit/core/codara-commands.test.ts
bun test tests/unit/core/codara-skill-commands.test.ts
bun test tests/unit/core/skill-command-requirements.test.ts
bun test tests/unit/core/docs-contract.test.ts
bun test tests/cases/runtime/command-surface.case.test.ts
bun test tests/cases/runtime/skill-command-preflight.case.test.ts
```

## Repository Layout

```text
src/core/agents
src/core/codara
src/core/commands
src/core/middleware
src/core/provider
src/core/skills
src/core/tasks
src/cli
tests/unit
tests/integration
tests/cases
```

建议阅读顺序：

1. `src/core/README.md`
2. `src/core/codara/facade.ts`
3. `src/core/sessions/session.ts`
4. `src/core/commands/builtin/help.ts`
5. `src/core/tasks/README.md`
