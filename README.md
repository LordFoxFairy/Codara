# Codara

<p align="center">
  终端优先的代码代理运行时，面向真实开发工作流。
</p>

<p align="center">
  <img alt="Bun" src="https://img.shields.io/badge/runtime-Bun-black">
  <img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6">
  <img alt="Ink" src="https://img.shields.io/badge/ui-Ink-black">
</p>

<p align="center">
  <a href="#快速开始">快速开始</a>
  ·
  <a href="#为什么是-codara">为什么是 Codara</a>
  ·
  <a href="#常用命令">常用命令</a>
  ·
  <a href="#文档入口">文档入口</a>
</p>

Codara 把会话、任务、子代理、权限和 CLI 交互收进同一套 Bun + TypeScript 运行时里。它不是一个包着模型调用的聊天壳，而是一个可以直接运行、验证和扩展的终端编码工作台。

<p align="center">
  <img src="./imgs/img.png" alt="Codara CLI" width="760" />
</p>

## 为什么是 Codara

Codara 适合这类场景：

- 你想先跑通真实的终端编码流程，而不是先堆一层又一层 agent demo
- 你希望 session、任务委派、子代理、权限和交互边界放在同一套 runtime 里维护
- 你需要一个能继续演化成产品的底座，而不是一次性的脚本拼装

这个仓库是有取向的：先把工作流打通，再围绕真实使用体验做收敛。

## 快速开始

安装依赖：

```bash
bun install
```

启动 CLI 开发模式：

```bash
bun run dev
```

单次运行 CLI：

```bash
bun run dev:once
```

如果你只想先快速确认工程状态：

```bash
bun run check:fast
```

## 常用命令

```bash
bun run dev         # 启动 CLI（watch 模式）
bun run dev:once    # 单次运行 CLI
bun run check:fast  # lint + typecheck
bun run test        # 运行测试
bun run build       # 构建 dist/
```

## 你能得到什么

- **终端优先的工作流**
  - Codara 从一开始就是 CLI，不依赖浏览器外壳。
- **统一的 runtime 边界**
  - 会话、运行时事件和交互流程放在同一套系统里，而不是散落在脚本和粘合代码中。
- **任务与子代理能力**
  - 委派子运行和共享任务已经是产品表面的一部分，不是后补的演示功能。
- **权限与人工介入**
  - 运行时从设计上就保留了 review 和受控执行入口，而不是默认无边界写入。
- **可演化的分层结构**
  - engine、CLI、capability 各自有清晰文档，后续继续扩功能时不容易塌成一层。

## 文档入口

- [CLI Guide](./src/cli/README.md)
  - 终端界面、输入流程、交互行为。
- [Engine Guide](./src/engine/README.md)
  - 会话、pipeline、运行时装配和核心执行结构。
- [Tasks Guide](./src/capability/task/README.md)
  - 任务委派、共享任务、子代理协调能力。
- [Skill Guide](./src/capability/skill/README.md)
  - skill 加载和 capability 侧的行为。

## 开发说明

- 运行时：Bun
- Language：TypeScript
- CLI UI：Ink + React
- Package format：ESM

这个仓库仍在持续演进。根 README 保持产品入口视角，更深的运行时和模块细节下沉到各自文档中。
