# Codara 文档索引

本索引按推荐阅读顺序编排。建议从架构概览开始，逐步深入各子系统。

> **💡 核心设计理念**
>
> Codara 采用"核心通用 + Skills 扩展"的架构：
> - **核心系统**：Agent Loop、Tools、Middleware、TUI、Memory（通用、稳定）
> - **Skills 扩展**：所有领域功能通过 Skills 实现（内部和外部扩展的唯一入口）
>
> **Skills 是扩展 Codara 的唯一方式**，确保更好的维护、扩展和生态建设。

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
| 04 | [生命周期钩子](./04-hooks.md) | Hook 原语：事件、动作、执行模型（机制层） |
| **05** | **[技能系统](./05-skills.md)** | **⭐ 扩展唯一入口：技能权限、技能钩子、工具调用流程、实战示例、生态建设** |

## 高级特性

| # | 文档 | 说明 |
|---|------|------|
| 06 | [代理协作](./06-agent-collaboration.md) | 主从代理架构、Task 管理与协作模式 |
| 07 | [记忆与上下文](./07-memory-system.md) | 3 层记忆层级与上下文压缩管线 |
| 08 | [终端界面](./08-terminal-ui.md) | TUI 组件、布局架构与交互模式 |

> **推荐阅读路径**:
>
> **核心主线**（必读）:
> `00-architecture-overview → 01-model-routing → 02-agent-loop → 03-tools → 04-hooks → 05-skills`
>
> **高级特性**（按需）:
> `06-agent-collaboration → 07-memory-system → 08-terminal-ui`
>
> **附录**（需要规则细节时查阅）:
> - [appendix/permissions](./appendix/permissions.md) - 权限策略速查

## 附录

| 文档 | 说明 |
|------|------|
| [设计理念对比](../tmp/design-alignment.md) | Codara vs Claude Code 设计理念一致性分析 |
| [权限策略（附录）](./appendix/permissions.md) | hooks 链上的权限模式与规则速查 |
| [Claude Code 参考](../tmp/claude-code-reference/) | Claude Code 官方文档参考（需手动下载） |
| [归档文档](../tmp/archive/) | 设计过程文档归档 |
