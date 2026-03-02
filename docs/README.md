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

## 运行时主线（唯一入口）

| 文档 | 说明 |
|------|------|
| **[架构运行流程](./architecture-runtime.md)** | **⭐ 从启动到结束的一图流主线：context 构建、skills 注入、hooks/permissions/tool 执行顺序的统一口径** |

如果只读一篇来理解“系统到底怎么跑”，优先读这篇。

---

## 教程式阅读法

### 3 步读法（推荐）

1. 先读 [架构运行流程](./architecture-runtime.md) 建立整体时序心智模型。
2. 再按主线读 `00 → 06`，把每个机制层和扩展层串起来。
3. 最后按需补读 `07/08`，解决多代理协作和 TUI 交互细节。

### 按角色快速入口

| 角色 | 建议起点 | 目标 |
|------|----------|------|
| 新维护者 | `architecture-runtime → 00 → 02` | 先掌握系统如何跑起来，再看模块关系和循环细节 |
| 扩展开发者 | `06 → 04 → appendix/permissions` | 先会做 skill，再补 hooks/permissions 规则 |
| 平台维护者 | `01 → 02 → 03 → 05` | 路由、循环、工具、记忆四层机制闭环 |

### 一小时上手路线（实操）

1. 15 分钟：阅读 [architecture-runtime](./architecture-runtime.md) 的「运行时一图流」与「执行阶段」。
2. 20 分钟：阅读 `02 + 03 + 04`，重点对齐工具调用顺序与权限交互。
3. 15 分钟：阅读 `06` 并按示例设计一个最小 skill。
4. 10 分钟：回到 `README` 用“按角色入口”补齐你当前职责相关章节。

### 排错导向阅读（症状 -> 文档）

| 症状 | 先读文档 |
|------|----------|
| 工具调用被拒绝/频繁弹权限框 | `04-hooks -> appendix/permissions -> 06-skills` |
| 代理行为不符合预期（该调用工具却没调用） | `02-agent-loop -> architecture-runtime` |
| `/skill` 执行效果不稳定 | `06-skills -> 04-hooks -> architecture-runtime` |
| 子代理表现异常或权限不足 | `07-agent-collaboration -> 02-agent-loop` |
| UI 弹窗/流式显示异常 | `08-terminal-ui -> 02-agent-loop` |

---

## 核心架构

| # | 文档 | 说明 |
|---|------|------|
| 00 | [架构概览](./00-architecture-overview.md) | 项目整体架构与模块关系，入门必读 |
| 01 | [模型路由](./01-model-routing.md) | 模型别名解析、提供商选择与 LangChain 实例构建 |
| 02 | [代理循环](./02-agent-loop.md) | 基于 `tool_calls` 主路径 + `stop_reason` 辅助的核心执行引擎 |

## 工具与扩展

| # | 文档 | 说明 |
|---|------|------|
| 03 | [工具系统](./03-tools.md) | 工具注册、Schema 定义与执行流程 |
| 04 | [生命周期钩子](./04-hooks.md) | Hook 原语：事件、动作、执行模型（机制层） |
| 05 | [记忆系统](./05-memory-system.md) | 运行时记忆管理：auto-memory、会话持久化、checkpoints、上下文压缩 |
| **06** | **[技能系统](./06-skills.md)** | **⭐ 扩展唯一入口：技能权限、技能钩子、工具调用流程、实战示例、生态建设** |

## 高级特性

| # | 文档 | 说明 |
|---|------|------|
| 07 | [代理协作](./07-agent-collaboration.md) | 主从代理架构、Task 管理与协作模式 |
| 08 | [终端界面](./08-terminal-ui.md) | TUI 组件、布局架构与交互模式 |

> **推荐阅读路径**:
>
> **核心主线**（必读）:
> `00-architecture-overview → 01-model-routing → 02-agent-loop → 03-tools → 04-hooks → 05-memory-system → 06-skills`
>
> **高级特性**（按需）:
> `07-agent-collaboration → 08-terminal-ui`
>
> **深入理解**（推荐）:
> - [architecture-runtime](./architecture-runtime.md) - **完整运行流程，理解各组件如何协同工作**
>
> **附录**（需要规则细节时查阅）:
> - [appendix/permissions](./appendix/permissions.md) - 权限策略速查

## 深入理解

| 文档 | 说明 |
|------|------|
| [架构运行流程](./architecture-runtime.md) | **⭐ 完整运行流程：从启动到执行，各组件如何协同工作** |

## 附录

| 文档 | 说明 |
|------|------|
| [设计理念对比](../tmp/design-alignment.md) | Codara vs Claude Code 设计理念一致性分析 |
| [权限策略（附录）](./appendix/permissions.md) | hooks 链上的权限模式与规则速查 |
| [Claude Code 参考](../tmp/claude-code-reference/) | Claude Code 官方文档参考（需手动下载） |
| [归档文档](../tmp/archive/) | 设计过程文档归档 |
