# Codara Agent Runtime 架构教程

> **定位**：从零构建 Agent Runtime 的完整教程。每个章节添加一个机制，渐进式理解 Agent Harness 工程。

---

## 核心认知

**Agent 是模型，Harness 是环境。**

你不是在写 Agent，你是在造载具 — 为模型提供工具、知识、权限的集合。

```
Agent = 模型（训练好的神经网络）
Harness = 环境（工具 + 知识 + 权限）
```

---

## 课程结构

11 个递进式章节，从最小循环到自治执行：

| 章节 | 标题 | 核心概念 |
|------|------|----------|
| [s00](./s00-harness.md) | Harness | Agent 是模型，Harness 是环境 |
| [s01](./s01-agent-loop.md) | Agent Loop | while (stop_reason == tool_use) |
| [s02](./s02-context.md) | Context Window | System Prompt 不可变 → KV Cache 命中 |
| [s03](./s03-tool-system.md) | Tool System | Dispatch Map — 加工具不改循环 |
| [s04](./s04-skill-loading.md) | Skill Loading | 两层注入 — System Prompt 放索引 |
| [s05](./s05-todo-write.md) | TodoWrite | 状态机 + Nag Reminder |
| [s06](./s06-subagent.md) | SubAgent | 上下文隔离 — 独立 messages[] |
| [s07](./s07-task-system.md) | Task System | DAG + 磁盘持久化 |
| [s08](./s08-agent-teams.md) | Agent Teams | 持久化 Agent + JSONL 邮箱 |
| [s09](./s09-team-protocols.md) | Team Protocols | Request-Response FSM |
| [s10](./s10-autonomous-agents.md) | Autonomous Agents | Idle Polling — 自动认领 |

---

## 学习路径

### 基础（s00-s03）

构建最小可用的 Agent：

- **s00** — 理解 Harness 工程的本质
- **s01** — 实现 30 行的 Agent Loop
- **s02** — 理解 KV Cache，设计静态 System Prompt
- **s03** — 添加工具，理解 Dispatch Map

**里程碑**：一个能读写文件、执行命令的 Agent。

### 优化（s04-s05）

提升 Agent 的能力和可靠性：

- **s04** — 按需加载知识，不污染 System Prompt
- **s05** — 添加规划能力，防止 Agent 偏航

**里程碑**：一个有知识、有计划的 Agent。

### 协作（s06-s10）

从单 Agent 到多 Agent 系统：

- **s06** — 子 Agent 隔离上下文
- **s07** — 任务图持久化，跨会话存活
- **s08** — 持久化队友，JSONL 邮箱通信
- **s09** — 请求响应协议，优雅关机
- **s10** — 自治 Agent，自动认领任务

**里程碑**：一个自组织的多 Agent 系统。

---

## 设计原则

### 1. 循环永远不变

从 s01 到 s10，Agent Loop 的核心逻辑始终是：

```typescript
while (true) {
  response = await model.invoke({ messages, tools });
  if (response.stop_reason !== "tool_use") break;
  // 执行工具，追加结果
}
```

所有机制都是在这个循环**外围**叠加，不是修改循环本身。

### 2. 静态 vs 动态分离

- **System Prompt** — 静态，包含身份、工具定义、技能索引
- **Messages** — 动态，包含对话历史、工具结果

这个分离是 KV Cache 命中的前提，也是架构设计的核心。

### 3. 工具是扩展的唯一方式

加工具 = 加 handler + 加 schema。循环不需要知道工具的存在。

### 4. 磁盘是真相的来源

- **内存** — 易失，适合单次对话
- **磁盘** — 持久，适合跨会话协作

任务图、团队名册、收件箱都在磁盘上，崩溃后可恢复。

### 5. 异步消息，不是共享状态

Agent 之间通过 JSONL 邮箱通信，不是共享内存。每个 Agent 是独立的 loop，独立推进。

---

## 适用场景

这套架构不只适用于编程 Agent，可以泛化到任何领域：

```
庄园管理 Agent  = 模型 + 物业传感器 + 维护工具 + 租户通信
农业 Agent      = 模型 + 土壤/气象数据 + 灌溉控制 + 作物知识
酒店运营 Agent  = 模型 + 预订系统 + 客户渠道 + 设施 API
医学研究 Agent  = 模型 + 文献检索 + 实验仪器 + 协议文档
制造业 Agent    = 模型 + 产线传感器 + 质量控制 + 物流系统
```

循环永远不变。工具在变。知识在变。权限在变。Agent — 那个模型 — 泛化一切。

---

## 参考

本教程参考了 [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) 的教学风格，并结合 Codara 的实际架构设计。

---

**造好 Harness。Agent 会完成剩下的。**
