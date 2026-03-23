# s00: Harness

> *"Agent 是模型，Harness 是环境 — 工具、知识、权限的集合"*

## 核心认知

当一个人说"我在开发 Agent"时，他在做什么？

大多数人的答案是错的。他们在堆 if-else、画节点图、串提示词链，试图用过程式逻辑"编码"出智能行为。

**这是根本性的误解。**

## Agent vs Harness

```
Agent = 模型（训练好的神经网络）
Harness = 环境（工具 + 知识 + 权限）

+------------------+
|   Harness        |
|                  |
|  +-----------+   |
|  |  Agent    |   |  <-- 模型做决策
|  | (Model)   |   |
|  +-----------+   |
|        |         |
|  +-----v------+  |
|  |   Tools    |  |  <-- Harness 执行
|  | Knowledge  |  |
|  | Permission |  |
|  +------------+  |
+------------------+
```

**模型是驾驶者。Harness 是载具。**

## 历史证据

- **2013 — DeepMind DQN** 玩 Atari，49 款游戏达到职业人类水平
- **2019 — OpenAI Five** 征服 Dota 2，击败 TI8 世界冠军
- **2019 — DeepMind AlphaStar** 制霸星际争霸 II，宗师段位
- **2019 — 腾讯绝悟** 统治王者荣耀，职业选手 15 场只赢 1 场
- **2024-2025 — LLM Agent** 重塑软件工程

每一个里程碑共享同一个真理：**Agent 永远是模型本身。**

## Harness 的组成

```
Harness = Tools + Knowledge + Observation + Action + Permissions

Tools:       文件读写、Shell、网络、数据库
Knowledge:   产品文档、领域资料、API 规范
Observation: git diff、错误日志、系统状态
Action:      CLI 命令、API 调用、UI 交互
Permissions: 沙箱隔离、审批流程、信任边界
```

## Harness 工程师的工作

1. **实现工具** — 给 Agent 一双手
2. **策划知识** — 给 Agent 领域专长
3. **管理上下文** — 给 Agent 干净的记忆
4. **控制权限** — 给 Agent 边界
5. **收集轨迹** — Agent 的行动序列是训练信号

你不是在编写智能。你是在构建智能栖居的世界。

## 本教程的范围

接下来 10 个章节，每个章节添加一个 Harness 机制：

```
s01: Agent Loop      — 心脏（循环推进）
s02: Context         — 记忆（KV Cache）
s03: Tool System     — 手（工具分发）
s04: Skill Loading   — 知识（按需注入）
s05: TodoWrite       — 规划（状态机）
s06: SubAgent        — 分身（上下文隔离）
s07: Task System     — 协作骨架（DAG）
s08: Agent Teams     — 团队（JSONL 邮箱）
s09: Team Protocols  — 协议（FSM 握手）
s10: Autonomous      — 自治（Idle Polling）
```

循环永远不变。工具在变。知识在变。权限在变。Agent — 那个模型 — 泛化一切。

---

**造好 Harness。Agent 会完成剩下的。**
