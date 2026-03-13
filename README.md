# Codara

![Bun](https://img.shields.io/badge/runtime-Bun-black)
![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6)
[![Core Docs](https://img.shields.io/badge/docs-core-black)](./src/core/README.md)
[![CLI Docs](https://img.shields.io/badge/docs-cli-black)](./src/cli/README.md)
[![Tasks Docs](https://img.shields.io/badge/docs-tasks-black)](./src/core/tasks/README.md)

Codara 是一个终端优先的代码代理 runtime。它把 session、skills、tasks、permission 和 CLI 工作流收敛到同一套运行时里，用来支撑真实编码流程，而不是只做聊天式 agent demo。

它适合这类场景：

- 想直接启动一个可用的 coding runtime，而不是手动拼接 agent、commands、skills 和权限链路
- 想把 CLI、session、tasks、subagents 放在一套一致的 core 边界里维护
- 想先把真实工作流跑通，再逐步打磨产品体验

## 快速开始

安装依赖：

```bash
bun install
```

启动开发模式：

```bash
bun run dev
```

如果你只想先确认工程状态：

```bash
bun run check:fast
```

## 项目说明

Codara 的核心取向很直接：

- 以 `src/core` 为主线，把 runtime 能力留在 core，而不是散落到 CLI 和脚本层
- 用统一的 session/runtime 边界承载 commands、skills、tasks、permissions 和 interaction
- 用真实工作流驱动演进，而不是只围绕局部接口做演示

这意味着它更像一个“代码代理产品底座”，而不只是一个模型调用封装。

## 文档入口

- [Core Guide](./src/core/README.md)：核心运行时、session、middleware、skills、tasks 的整体说明
- [CLI Guide](./src/cli/README.md)：终端入口、界面行为和 CLI 集成说明
- [Tasks Guide](./src/core/tasks/README.md)：`src/core/tasks` 下的 Task、shared tasks 和 subagent 机制

## 开发说明

仓库默认使用 Bun 和 TypeScript。根 README 只保留项目入口；更细的架构、CLI、Task 说明分别下沉到对应文档中。
