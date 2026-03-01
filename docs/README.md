# Codara 文档索引

本索引按推荐阅读顺序编排。建议从架构概览开始，逐步深入各子系统。

---

## 核心架构

| # | 文档 | 说明 |
|---|------|------|
| 00 | [架构概览](./00-architecture-overview.md) | 项目整体架构与模块关系，入门必读 |
| 01 | [模型路由](./01-model-routing.md) | 模型别名解析、提供商选择与 LangChain 实例构建 |
| 02 | [代理循环](./02-agent-loop.md) | 基于 stop-reason 驱动的核心执行引擎 |

## 工具与扩展

| # | 文档 | 说明 |
|---|------|------|
| 03 | [工具系统](./03-tools.md) | 工具注册、Schema 定义与执行流程 |
| 04 | [中间件与钩子](./04-hooks.md) | 6-Hook 中间件架构与生命周期管理 |
| 05 | [权限系统](./05-permissions.md) | 分层权限控制与工具调用安全检查 |
| 06 | [技能系统](./06-skills.md) | 统一扩展单元：技能目录结构、agents/hooks 集成 |
| 07 | [代理协作](./07-agent-collaboration.md) | 主从代理架构、Task 管理与协作模式 |
| 08 | [记忆与上下文](./08-memory-system.md) | 3 层记忆层级与上下文压缩管线 |

## 前端与交互

| # | 文档 | 说明 |
|---|------|------|
| 09 | [终端界面](./09-terminal-ui.md) | TUI 组件、布局架构与交互模式 |

## 附录

| 文档 | 说明 |
|------|------|
| [设计理念对比](./design-alignment.md) | Codara vs Claude Code 设计理念一致性分析 |
| [Claude Code 参考](./claude-code-reference/) | Claude Code 官方文档参考（需手动下载） |
| [归档文档](./archive/) | 设计过程文档归档 |
