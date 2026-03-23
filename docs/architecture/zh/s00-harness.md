# s00: Harness

`[ s00 ] s01 > s02 > s03 > s04 > s05 > s06 > s07 > s08 > s09 > s10`

> *"Agent 是模型，Harness 是环境 — 工具、知识、权限的集合"*
>
> **核心认知**: 你不是在写 Agent，你是在造载具。

## 问题

当一个人说"我在开发 Agent"时，他在做什么？

大多数人的答案是错的。他们在堆 if-else、画节点图、串提示词链，试图用过程式逻辑"编码"出智能行为。这是 GOFAI（Good Old-Fashioned AI）的现代还魂 — 符号规则系统，几十年前就被学界抛弃。

**Agency 是学出来的，不是编出来的。**

## 解决方案

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

模型是驾驶者。Harness 是载具。

## Harness 的组成

```
Harness = Tools + Knowledge + Observation + Action + Permissions

Tools:       文件读写、Shell、网络、数据库、浏览器
Knowledge:   产品文档、领域资料、API 规范、风格指南
Observation: git diff、错误日志、浏览器状态、传感器数据
Action:      CLI 命令、API 调用、UI 交互
Permissions: 沙箱隔离、审批流程、信任边界
```

## Harness 工程师的工作

1. **实现工具** — 给 Agent 一双手。每个工具是一个原子化的行动。
2. **策划知识** — 给 Agent 领域专长。按需加载（s04），不前置塞入。
3. **管理上下文** — 给 Agent 干净的记忆。子 Agent 隔离（s06）、压缩（s02）。
4. **控制权限** — 给 Agent 边界。沙箱化、审批流程、信任边界。
5. **收集轨迹** — Agent 的每条行动序列都是训练信号。

你不是在编写智能。你是在构建智能栖居的世界。

## 历史证据

- **2013 — DeepMind DQN** 玩 Atari，49 款游戏达到职业人类水平，论文发表在 *Nature*
- **2019 — OpenAI Five** 征服 Dota 2，击败 TI8 世界冠军 OG
- **2019 — DeepMind AlphaStar** 制霸星际争霸 II，宗师段位（前 0.15%）
- **2019 — 腾讯绝悟** 统治王者荣耀，职业选手 15 场只赢 1 场
- **2024-2025 — LLM Agent** 重塑软件工程，Claude/GPT/Gemini 阅读代码库、编写实现、调试故障

每一个里程碑共享同一个真理：**Agent 永远是模型本身。**

## 本教程的范围

接下来 10 个章节，每个章节添加一个 Harness 机制：

```
s01: Agent Loop      — 心脏
s02: Context         — 记忆
s03: Tool System     — 手
s04: Skill Loading   — 知识
s05: TodoWrite       — 规划
s06: SubAgent        — 分身
s07: Task System     — 协作骨架
s08: Agent Teams     — 团队
s09: Team Protocols  — 协议
s10: Autonomous      — 自治
```

循环永远不变。工具在变。知识在变。权限在变。Agent — 那个模型 — 泛化一切。

---

**造好 Harness。Agent 会完成剩下的。**
