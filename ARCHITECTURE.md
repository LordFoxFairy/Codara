# Codara 全局技术架构 v1.0

> **定位**：Codara 的权威架构蓝图。描述系统的限界上下文、分层结构、执行链路、扩展机制和依赖规则。所有代码组织和模块边界以本文档为准。

---

## 1. 架构哲学

Codara 是一条**可恢复、可扩展、可协作的 Agent 执行链路**。

设计遵循三个核心理念：

- **DDD 轻量分层**：以限界上下文（Bounded Context）组织代码，严格单向依赖
- **Stream-First**：所有执行路径走 AsyncGenerator，消除阻塞
- **Middleware-First Extensibility**：中间件是第一且唯一的执行拦截机制

由此固定 **7 条不可妥协的原则**：

| # | 原则 | 含义 |
|---|------|------|
| 1 | Agent Loop 是唯一执行推进器 | 所有执行（含子 agent、team worker）复用同一 loop |
| 2 | Pipeline 是执行阶段骨架 | 定义阶段顺序和契约，不是另一套扩展系统 |
| 3 | Middleware 是第一扩展机制 | Hook 和 Skill 都通过 middleware 接入执行链 |
| 4 | Hook 是生命周期桥接 | 通过 hooks-bridge middleware 接入，不直接控制执行 |
| 5 | 展示层是入口/出口边界 | 不属于运行时内部，不参与执行决策 |
| 6 | Context 分为来源层和执行态 | 来源层提供材料，执行态贴近 pipeline 消费 |
| 7 | Task/Team 是主链路扩展 | 复用统一执行模型，不是第二套平行 runtime |

---

## 2. 战略设计 — 限界上下文

Codara 划分为 **10 个限界上下文**，每个对应一个顶层目录：

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Codara 限界上下文                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─ 核心域 ──────────────────────────────────────────────────┐  │
│  │  core/           Agent 执行引擎                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ 支撑域 ──────────────────────────────────────────────────┐  │
│  │  capability/     可插拔领域能力（skill, task, team, command）│  │
│  │  durability/     持久化（session, checkpoint）             │  │
│  │  observability/  观测（events, hook）                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ 基础设施 ────────────────────────────────────────────────┐  │
│  │  integration/    外部适配（tool, mcp, channel, provider）  │  │
│  │  context/        上下文来源（instructions, prompts, memory）│  │
│  │  config/         配置管理                                  │  │
│  │  bus/            通信基础设施                               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ 应用层 ──────────────────────────────────────────────────┐  │
│  │  codara/         运行时装配 + API 门面                     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ 展示层 ──────────────────────────────────────────────────┐  │
│  │  cli/            终端 UI（Ink）                            │  │
│  │  desktop/        桌面 UI（React + Tauri）                  │  │
│  │  server/         HTTP/SSE 服务                             │  │
│  │  gateway/        消息网关（Telegram, Feishu, DingTalk...）  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌─ 共享内核 ────────────────────────────────────────────────┐  │
│  │  shared/         跨上下文契约 + 基础类型                    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 上下文分类

| 类型 | 上下文 | 职责 | DDD 角色 |
|------|--------|------|----------|
| 核心域 | `core/` | Agent Loop + Pipeline + Middleware | 聚合根 + 领域服务 |
| 支撑域 | `capability/` | 技能、任务、团队、命令 | 子域聚合 |
| 支撑域 | `durability/` | 会话持久化 + 检查点 | 仓储 |
| 支撑域 | `observability/` | 运行时事件 + 生命周期钩子 | 领域事件 |
| 基础设施 | `integration/` | 工具、MCP、通道、模型提供商 | 适配器 |
| 基础设施 | `context/` | 指令、提示、记忆、技能上下文 | 来源仓储 |
| 基础设施 | `config/` | 配置文件解析与管理 | 基础设施服务 |
| 基础设施 | `bus/` | 类型化事件总线 + 多端通信 | 基础设施服务 |
| 应用层 | `codara/` | 运行时装配 + API 门面 | 应用服务 |
| 展示层 | `cli/` `desktop/` `server/` | 用户交互界面 | 端口适配器 |
| 展示层 | `gateway/` | 消息网关（IM 渠道接入） | 端口适配器 |
| 共享内核 | `shared/` | 跨上下文类型契约 | 共享内核 |

---

## 3. 上下文映射（Context Map）

```text
                    ┌──────────┐
                    │  shared/  │
                    │ 共享内核   │
                    └─────┬────┘
                          │ (所有上下文依赖)
          ┌───────────────┼───────────────────┐
          │               │                   │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌────────▼────────┐
    │  config/   │   │ context/  │   │  bus/            │
    │  配置      │   │ 上下文源   │   │  通信            │
    └─────┬─────┘   └─────┬─────┘   └────────┬────────┘
          │               │                   │
          │         ┌─────▼─────┐             │
          │         │integration│             │
          └────────►│ 集成适配   │◄────────────┘
                    └─────┬─────┘
                          │
          ┌───────────────┼───────────────────┐
          │               │                   │
    ┌─────▼─────┐   ┌─────▼──────┐   ┌───────▼───────┐
    │durability/ │   │observability│   │   core/        │
    │ 持久化     │   │ 观测        │   │   执行引擎     │
    └─────┬─────┘   └─────┬──────┘   └───────┬───────┘
          │               │                   │
          └───────────────┼───────────────────┘
                          │
                    ┌─────▼──────┐
                    │ capability/ │
                    │ 领域能力    │
                    └─────┬──────┘
                          │
                    ┌─────▼─────┐
                    │  codara/   │
                    │  应用层    │
                    └─────┬─────┘
                          │
          ┌───────────────┼──────────────────────────────┐
          │               │                   │          │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌────────▼───┐  ┌──▼────────┐
    │   cli/     │   │ desktop/  │   │  server/    │  │ gateway/  │
    │   终端     │   │ 桌面      │   │  HTTP/SSE   │  │ 消息网关   │
    └───────────┘   └───────────┘   └─────────────┘  └───────────┘
```

**映射关系类型：**

- `core/ ← integration/`：**防腐层（ACL）** — core 通过契约接口消费，integration 提供实现
- `core/ ← durability/`：**开放主机服务（OHS）** — durability 暴露标准仓储接口
- `core/ ← observability/`：**发布-订阅** — core 发射事件，observability 订阅处理
- `capability/ → core/`：**遵奉者（Conformist）** — capability 遵循 core 的执行模型
- `codara/ → all`：**编排层** — 纯粘合，不引入领域逻辑

---

## 4. 目录架构

```text
src/
│
├── core/                          # ═══ 核心域：执行引擎 ═══
│   │
│   ├── agent/                     # Agent 聚合根
│   │   ├── models/                #   状态模型（agent, state, command）
│   │   ├── run/                   #   执行运行时（loop, stream, turn, tool-executor）
│   │   ├── bootstrap.ts           #   Agent 初始化
│   │   └── index.ts
│   │
│   ├── pipeline/                  # Pipeline 值对象
│   │   ├── pipeline.ts            #   阶段骨架定义
│   │   ├── types.ts               #   阶段契约
│   │   └── index.ts
│   │
│   └── middleware/                 # Middleware 领域服务（按职责组织）
│       ├── permission/            #   权限控制（policy, analysis, bash）
│       ├── hil.ts                 #   人机协作 pause/resume
│       ├── budget.ts              #   Token 预算
│       ├── summary.ts             #   消息压缩
│       ├── skills.ts              #   技能注入
│       ├── path-instructions.ts   #   路径指令
│       ├── ask-user-question.ts   #   用户提问
│       ├── todo.ts                #   任务清单
│       ├── logging.ts             #   日志记录
│       └── index.ts
│
├── capability/                    # ═══ 能力域：可插拔领域能力 ═══
│   │
│   ├── skill/                     # 技能子域
│   │   ├── catalog/               #   元数据 + 加载
│   │   ├── discovery/             #   发现 + 来源（FileSystemSkillStore）
│   │   └── runtime/               #   运行时（subagent 解析, 命令调用）
│   │
│   ├── task/                      # 任务派发子域
│   │   ├── store.ts               #   任务仓储（file/memory）
│   │   ├── tools.ts               #   任务工具（create/list/update）
│   │   ├── middleware.ts          #   任务中间件（触发 delegation）
│   │   ├── types.ts               #   任务类型
│   │   └── index.ts
│   │
│   ├── team/                      # 团队协作子域
│   │   ├── coordination/          #   leader-worker 协调（events, job-board, types...）
│   │   ├── runtime/               #   MemberRunner + MemberSession
│   │   ├── surface/               #   团队 UI 数据（leader/worker tools, filter）
│   │   ├── middleware.ts          #   团队中间件
│   │   ├── local-transport.ts     #   本地传输
│   │   ├── persistence.ts         #   持久化
│   │   ├── prompts.ts             #   团队提示
│   │   └── shared-state.ts        #   共享状态
│   │
│   └── command/                   # CLI 命令子域
│       ├── builtin/               #   内置命令
│       ├── catalog/               #   命令目录
│       └── runtime/               #   命令执行
│
├── durability/                    # ═══ 持久化域 ═══
│   │
│   ├── session/                   # 会话聚合
│   │   ├── session.ts             #   会话生命周期
│   │   ├── store.ts               #   FileSessionStore
│   │   ├── metadata.ts            #   会话元数据
│   │   ├── types.ts               #   会话类型
│   │   └── index.ts
│   │
│   └── checkpoint/                # 检查点聚合
│       ├── agent.ts               #   Agent 检查点
│       ├── file.ts                #   FileCheckpointer（含 compact）
│       ├── in-memory.ts           #   InMemoryCheckpointer
│       ├── lock.ts                #   文件锁（含 stale 检测）
│       ├── types.ts               #   检查点类型
│       └── index.ts
│
├── observability/                 # ═══ 观测域 ═══
│   │
│   ├── events/                    # 运行时事件
│   │   ├── types.ts               #   事件类型定义
│   │   ├── controller.ts          #   RuntimeEventsController
│   │   ├── formatters.ts          #   工具标签 + 摘要格式化
│   │   └── index.ts
│   │
│   └── hook/                      # 生命周期钩子
│       ├── registry.ts            #   钩子注册
│       ├── executor.ts            #   钩子执行器
│       ├── pipeline.ts            #   钩子管线
│       ├── bridge.ts              #   钩子桥接
│       ├── types.ts               #   钩子类型
│       └── index.ts
│
├── integration/                   # ═══ 集成适配层 ═══
│   │
│   ├── tool/                      # 工具系统
│   │   ├── builtin/               #   内置工具（bash, read, write, edit, glob, grep...）
│   │   ├── extended/              #   扩展工具（worktree, fetch, search, notebook）
│   │   ├── utils.ts               #   工具辅助函数
│   │   ├── names.ts               #   工具名注册
│   │   └── index.ts
│   │
│   ├── mcp/                       # MCP 协议适配
│   │   ├── transport/             #   传输层（HTTP, stdio）
│   │   ├── client.ts              #   MCP 客户端
│   │   ├── manager.ts             #   MCP 管理器
│   │   ├── config.ts              #   MCP 配置加载
│   │   ├── tool-adapter.ts        #   LangChain 工具适配
│   │   ├── types.ts               #   MCP 类型
│   │   └── index.ts
│   │
│   ├── channel/                   # 交互通道
│   │   ├── contracts.ts           #   ChannelPlugin 契约
│   │   ├── registry.ts            #   ChannelRegistry
│   │   ├── hil-adapter.ts         #   HIL 通道适配
│   │   ├── telegram/              #   Telegram 适配器（Long Polling）
│   │   │   ├── plugin.ts
│   │   │   ├── api.ts
│   │   │   ├── polling.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── feishu/                #   飞书适配器（Webhook）
│   │   ├── dingtalk/              #   钉钉适配器（Webhook）
│   │   ├── qq/                    #   QQ 适配器（OneBot WebSocket）
│   │   ├── wecom/                 #   企业微信适配器（Webhook + 加密）
│   │   ├── discord/               #   Discord 适配器（Gateway WebSocket）
│   │   ├── slack/                 #   Slack 适配器（Socket Mode）
│   │   └── index.ts
│   │
│   └── provider/                  # 模型提供商适配
│       ├── config/                #   提供商配置 schema
│       ├── runtime/               #   ChatModelFactory
│       ├── model.ts               #   ModelInfo + ModelRegistry
│       └── index.ts
│
├── context/                       # ═══ 上下文域：执行材料来源 ═══
│   │
│   ├── instructions/              # 路径指令（CLAUDE.md 风格）
│   ├── prompts/                   # 系统提示
│   ├── memory/                    # 记忆管理（含 eviction.ts 淘汰策略）
│   ├── skills/                    # 技能上下文（SkillsRuntimeData）
│   └── session-bundle/            # 会话上下文包
│
├── config/                        # ═══ 配置 ═══
│   │
│   ├── settings.ts                # 用户设置管理
│   ├── workspace.ts               # 工作区配置
│   ├── workspace-key.ts           # 工作区标识
│   └── index.ts
│
├── codara/                        # ═══ 应用层：装配 + 门面 ═══
│   │
│   ├── assembly/                  # 运行时装配
│   │   ├── middleware.ts          #   中间件链组装
│   │   ├── tools.ts               #   工具集组装
│   │   ├── collaboration.ts       #   协作能力组装
│   │   ├── context.ts             #   上下文组装
│   │   ├── runtime.ts             #   运行时组装
│   │   └── index.ts
│   │
│   ├── entrypoints/               # 应用入口
│   │   ├── cli.ts                 #   CLI 入口
│   │   ├── desktop.ts             #   桌面入口
│   │   ├── server.ts              #   服务端入口
│   │   └── index.ts
│   │
│   ├── facade.ts                  # Codara API 门面
│   ├── types.ts                   # 应用层类型
│   └── index.ts
│
├── gateway/                       # ═══ 展示层：消息网关 ═══
│   │
│   ├── gateway.ts                 # Gateway 主类（插件生命周期、消息路由、流式响应）
│   ├── router.ts                  # 消息路由（session key、白名单、binding）
│   ├── session-manager.ts         # 会话管理（多租户 session 映射）
│   ├── codara-session-factory.ts  # 真实 Codara Runtime 会话工厂
│   ├── channel-bridge.ts          # ChannelPlugin ↔ Channel 桥接（HIL 路由）
│   ├── outbound.ts                # 出站处理（消息分片）
│   ├── debounce.ts                # 消息防抖
│   ├── format.ts                  # Markdown 适配（平台差异化）
│   ├── session-key.ts             # 会话键生成（平台 + 用户 + 群组 → 唯一 key）
│   ├── session-store.ts           # 会话存储（session 生命周期管理）
│   ├── config.ts                  # 配置加载（gateway.json）
│   ├── types.ts                   # Gateway 类型定义
│   ├── main.ts                    # 入口（bun run gateway，动态加载 7 个渠道插件）
│   └── index.ts
│
├── cli/                           # ═══ 展示层：终端 UI ═══
│   │
│   ├── app/                       # 应用状态（layout, view-state, controller）
│   ├── components/                # Ink 组件
│   │   ├── chrome/                #   外框（header, footer）
│   │   ├── conversation/          #   对话流
│   │   ├── permission/            #   权限审批面板
│   │   ├── prompt/                #   输入区
│   │   └── teams/                 #   团队 UI
│   ├── composer/                  # 输入编辑器模型
│   ├── hooks/                     # Ink hooks
│   ├── transcript/                # 消息转录渲染
│   ├── utils/                     # 格式化 + 主题
│   └── main.tsx                   # CLI 入口
│
├── desktop/                       # ═══ 展示层：桌面 UI ═══
│   │
│   ├── components/                # React 组件
│   ├── hooks/                     # React hooks（useCodara）
│   ├── pages/                     # 页面布局
│   ├── styles/                    # 样式
│   └── main.tsx                   # Desktop 入口
│
├── server/                        # ═══ 展示层：HTTP/SSE 服务 ═══
│   │
│   ├── routes/                    # HTTP 路由
│   │   ├── chat.ts                #   聊天 + SSE 流
│   │   ├── sessions.ts            #   会话 CRUD
│   │   └── command.ts             #   命令执行
│   ├── bus-manager.ts             # Bus 单例 + 事件分发
│   ├── channel.ts                 # SSEChannel 实现
│   ├── sse.ts                     # SSE 格式化
│   ├── teams-api.ts               # Teams API 路由
│   └── index.ts
│
├── bus/                           # ═══ 通信基础设施 ═══
│   │
│   ├── bus.ts                     # CodaraBus 主类
│   ├── client.ts                  # 总线客户端
│   ├── event-emitter.ts           # TypedEmitter
│   ├── types.ts                   # 总线类型
│   └── index.ts
│
├── shared/                        # ═══ 共享内核 ═══
│   │
│   ├── contracts/                 # 跨上下文契约（纯接口 + 类型）
│   │   ├── agent-types.ts         #   Agent 契约
│   │   ├── channel.ts             #   Channel 契约
│   │   ├── execution.ts           #   执行契约
│   │   └── index.ts
│   │
│   ├── tool-names.ts              # 工具名常量
│   ├── tool-display.ts            # 工具展示
│   ├── delegation-result.ts       # 派发结果
│   ├── messages.ts                # 消息工具函数
│   ├── clone.ts                   # 深拷贝
│   └── index.ts
│
└── index.ts                       # 包导出（公共 API surface）
```

### 目录设计原则

1. **每个顶层目录 = 一个限界上下文**，内聚性最大化
2. **Middleware 按职责组织**，不按 Pipeline 阶段建目录；阶段归属由 Pipeline 契约表达
3. **`core/` 只保留执行本质**：agent + pipeline + middleware，不掺杂持久化、观测、集成
4. **`integration/` 是防腐层**：隔离所有外部系统（工具、MCP、通道、模型提供商）
5. **`context/` 是来源仓储**：只负责提供材料，不参与执行决策
6. **`shared/contracts/` 是跨上下文的唯一通信方式**：纯接口 + 类型，零实现

---

## 5. DDD 分层映射

```text
┌─ Presentation Layer ────────────────────────────────────────┐
│                                                             │
│  cli/          │  desktop/         │  server/          │  gateway/        │
│  终端 UI (Ink)  │  桌面 UI (React)   │  HTTP/SSE 服务    │  消息网关         │
│                                                             │
│  职责：接收用户输入，渲染输出，不参与执行决策                   │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─ Application Layer ─────┴───────────────────────────────────┐
│                                                             │
│  codara/                                                    │
│  ├── assembly/    运行时装配（session + model + middleware） │
│  ├── entrypoints/ 应用入口（新建/恢复/继续）                  │
│  └── facade.ts    API 门面（createCodara, openSession）      │
│                                                             │
│  职责：编排领域对象，不引入领域逻辑                            │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─ Domain Layer ──────────┴───────────────────────────────────┐
│                                                             │
│  core/                 capability/                          │
│  ├── agent/     (AR)   ├── skill/       技能发现+执行        │
│  ├── pipeline/  (VO)   ├── task/        单代理派发           │
│  └── middleware/ (DS)  ├── team/        多代理协作           │
│                        └── command/     CLI 命令             │
│                                                             │
│  durability/           observability/                       │
│  ├── session/   (AG)   ├── events/      运行时事件          │
│  └── checkpoint/ (AG)  └── hook/        生命周期钩子         │
│                                                             │
│  AR=聚合根  VO=值对象  DS=领域服务  AG=聚合                   │
│  职责：业务规则 + 执行逻辑，零框架依赖                        │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─ Infrastructure Layer ──┴───────────────────────────────────┐
│                                                             │
│  integration/          context/          config/   bus/     │
│  ├── tool/      工具   ├── instructions/ ├── settings       │
│  ├── mcp/       协议   ├── prompts/      └── workspace      │
│  ├── channel/   通道   ├── memory/                          │
│  └── provider/  模型   ├── skills/                          │
│                        └── session-bundle/                  │
│                                                             │
│  职责：外部系统适配 + 技术实现细节                             │
└─────────────────────────────────────────────────────────────┘
                          │
┌─ Shared Kernel ─────────┴───────────────────────────────────┐
│                                                             │
│  shared/                                                    │
│  ├── contracts/   跨上下文纯接口                              │
│  ├── tool-names   工具名常量                                 │
│  ├── messages     消息工具                                   │
│  └── clone        基础工具                                   │
│                                                             │
│  职责：最稳定的层，变更频率最低，零外部依赖                    │
└─────────────────────────────────────────────────────────────┘
```

**依赖方向（严格单向）：**

```text
Presentation → Application → Domain → Infrastructure → Shared Kernel
```

同层内部：通过 `shared/contracts/` 通信，禁止直接导入。

---

## 6. 核心域详解：执行引擎（core/）

### 6.1 Agent 聚合根

Agent 是 Codara 的核心聚合根，拥有唯一的执行推进权。

```text
core/agent/
├── models/
│   ├── agent.ts        AgentType, CreateAgentOptions
│   ├── state.ts        AgentState, cloneAgentState(), applySnapshot()
│   └── command.ts      Command, applyStateUpdate(), isCommand()
│
├── run/
│   ├── agent-loop.ts   唯一执行推进器：model → tools → model
│   ├── stream.ts       AsyncGenerator 流式执行
│   ├── turn.ts         单轮执行逻辑
│   ├── tool-executor.ts 工具调用执行
│   ├── delegation.ts   子 agent 派发（stream-first）
│   └── errors.ts       执行错误类型
│
├── bootstrap.ts        Agent 初始化 + 模型解析
└── index.ts
```

**Agent Loop 执行模型：**

```text
                    ┌──────────────┐
                    │  Agent Loop  │
                    └──────┬───────┘
                           │
              ┌────────────▼────────────┐
              │   BeforeAgent 阶段      │
              │   (skills, instructions) │
              └────────────┬────────────┘
                           │
         ┌─────────────────▼─────────────────┐
         │           Turn 循环                │
         │                                    │
         │  ┌──────────┐    ┌──────────────┐  │
         │  │BeforeModel│───►│  Model Call   │  │
         │  │(summary,  │    │  (LLM 推理)   │  │
         │  │ budget)   │    └──────┬───────┘  │
         │  └──────────┘           │           │
         │                         ▼           │
         │               ┌──────────────────┐  │
         │               │   Tool Calls?    │  │
         │               └────┬────────┬────┘  │
         │                yes │        │ no    │
         │                    ▼        │       │
         │  ┌──────────────────────┐   │       │
         │  │  ToolCall 阶段       │   │       │
         │  │  (permission → HIL)  │   │       │
         │  └──────────┬───────────┘   │       │
         │             │               │       │
         │  ┌──────────▼───────────┐   │       │
         │  │  AfterModel 阶段     │◄──┘       │
         │  │  (logging, ckpt)     │           │
         │  └──────────┬───────────┘           │
         │             │                       │
         │        continue? ───────────────────┘
         │             │ no
         └─────────────┼─────────────────────────
                       ▼
              ┌────────────────────┐
              │  AfterAgent 阶段   │
              │  (hooks, cleanup)  │
              └────────────────────┘
```

### 6.2 Pipeline 值对象

Pipeline 定义 6 个执行阶段，每个阶段有明确的调用契约：

| 阶段 | 时机 | 典型 Middleware |
|------|------|----------------|
| `BeforeAgent` | Agent 启动前 | skills 注入, path-instructions |
| `BeforeModel` | 每轮 LLM 调用前 | summary 压缩, budget 检查 |
| `ModelCall` | LLM 推理时 | logging |
| `ToolCall` | 工具调用时 | permission 评估 → HIL pause/resume |
| `AfterModel` | LLM 调用后 | logging, checkpoint save |
| `AfterAgent` | Agent 结束后 | hooks-bridge, cleanup |

**关键裁决：**
- Pipeline 定义阶段顺序，不是扩展系统
- 阶段归属由 Pipeline 契约表达，不由目录结构表达
- tool execution 和 resume continuation 是 Agent Loop 的内部步骤

### 6.3 Middleware 领域服务

Middleware 是 Codara 的**第一且唯一的执行拦截机制**：

```text
┌───────────────────────────────────────────────────────┐
│ Middleware Chain（per stage）                          │
│                                                       │
│  request ──→ [mw1] ──→ [mw2] ──→ [mw3] ──→ next()  │
│                │          │          │                 │
│              拦截?      修改?      附加?               │
│                │          │          │                 │
│  response ◄── [mw1] ◄── [mw2] ◄── [mw3] ◄── result │
│                                                       │
│  能力：拦截、修改输入、放行、阻断、附加行为              │
└───────────────────────────────────────────────────────┘
```

**内置 Middleware 全景：**

| Middleware | 阶段 | 职责 |
|------------|------|------|
| `skills` | BeforeAgent | 注入技能上下文到 system prompt |
| `path-instructions` | BeforeAgent | 注入路径指令（CLAUDE.md 等） |
| `budget` | BeforeModel | Token 预算控制 + 用量追踪 |
| `summary` | BeforeModel | 消息压缩（超长对话自动摘要） |
| `permission` | ToolCall | 工具调用权限评估（deny→ask→allow） |
| `hil` | ToolCall | 人机协作 pause/resume 拦截 |
| `ask-user-question` | ToolCall | 用户提问工具处理 |
| `todo` | ToolCall | 任务清单工具处理 |
| `logging` | AfterModel | 日志记录 + 文件日志 sink |
| `task` | ToolCall | 任务派发拦截 + 子 agent 调度 |
| `team` | BeforeAgent | 团队协作拦截 + worker 调度 |

---

## 7. 能力域详解（capability/）

### 7.1 Skill 子域

技能是 Codara 的**用户态高层扩展单元**：

```text
发现链路：
  FileSystemSkillStore.discover()
    → 扫描 sources（用户级 + 项目级）
    → 解析 SKILL.md frontmatter
    → 命名空间自动发现（namespace:skill-name）
    → skillsMetadataReducer 合并去重

注入链路：
  skills middleware (BeforeAgent)
    → 格式化技能列表
    → 注入 system prompt

执行链路：
  /skill-name 命令
    → findSkill()（支持 bare name 模糊匹配）
    → 加载 SKILL.md 内容
    → 注入当前 turn
```

**Skill 来源优先级（后者覆盖前者）：**

```text
~/.codara/skills/              # 用户级
.codara/skills/                # 项目级
.codara/skills/superworkers/   # 命名空间（superworkers:xxx）
```

### 7.2 Task 子域

Task 是**单代理异步派发**：

```text
用户/Agent
  → createTaskCreateTool() 创建任务
  → task middleware 拦截
  → runDelegatedChild() 派发子 agent（stream-first）
  → consumeAgentStream() 收集结果
  → 写回 TaskStore
```

**关键裁决：** 子 agent 复用统一 Agent Loop，不拥有独立 runtime。子 agent 不应有 Team 工具。

### 7.3 Team 子域

Team 是**多代理协作单元**：

```text
Leader Agent
  → team middleware 拦截
  → TeamCoordinator 启动
  → MemberRunner.start() 启动 worker（stream-first）
  → worker 通过 MemberSession.stream() 执行
  → leader 协调推进，至少 spawn 一个 worker
  → 结果回流到 leader context
```

**关键裁决：** Team 不另起一套 runtime，leader 和 worker 都走统一 Agent Loop。使用 Teams 时必须至少 spawn 一个 worker，leader 负责协调而非直接执行。

### 7.4 Command 子域

Command 是 CLI 命令的发现、注册和执行：

```text
command/
├── builtin/     内置命令（/help, /clear, /compact, ...）
├── catalog/     命令目录 + 元数据
└── runtime/     命令解析 + 执行
```

---

## 8. 支撑域详解

### 8.1 Durability — 持久化域

```text
durability/
├── session/          会话聚合
│   ├── session.ts    Session 生命周期（create, restore, close）
│   └── store.ts      FileSessionStore 实现
│
└── checkpoint/       检查点聚合
    ├── file.ts       FileCheckpointer（含 compact 压缩）
    ├── memory.ts     InMemoryCheckpointer
    └── lock.ts       Advisory 文件锁（PID + TTL stale 检测）
```

**Session vs Checkpoint：**
- **Session**：会话元数据（ID, 状态, 时间戳），粗粒度
- **Checkpoint**：消息历史快照，细粒度，支持 compact 压缩

### 8.2 Observability — 观测域

```text
observability/
├── events/           运行时事件
│   ├── types.ts      CodaraRuntimeEvent 类型族
│   ├── controller.ts RuntimeEventsController
│   └── formatters.ts 工具标签 + 摘要格式化
│
└── hook/             生命周期钩子
    ├── registry.ts   HookRegistry（注册 + 查询）
    ├── executor.ts   HookExecutor（shell 命令执行）
    └── types.ts      HookDefinition, HookEvent
```

**事件流向：**

```text
core/agent/loop
  │ emit
  ▼
observability/events/emitter
  │ broadcast
  ├──→ bus/ ──→ cli/ (transcript 渲染)
  ├──→ bus/ ──→ desktop/ (React 更新)
  └──→ bus/ ──→ server/ (SSE push)
```

**Hook 接入方式：** Hook 通过 hooks-bridge middleware 接入执行链，只能观测不能控制。

---

## 9. 集成适配层详解（integration/）

Integration 是 Codara 与外部世界的**防腐层**：

### 9.1 Tool — 工具系统

```text
integration/tool/
├── builtin/     内置工具
│   ├── bash.ts        Shell 执行
│   ├── read-file.ts   文件读取（含图片/PDF）
│   ├── write-file.ts  文件写入
│   ├── edit-file.ts   文件编辑（精确替换）
│   ├── glob.ts        文件模式匹配
│   └── grep.ts        内容搜索
│
└── extended/    扩展工具
    ├── fetch.ts       URL 抓取
    ├── search.ts      Web 搜索
    ├── notebook.ts    Notebook 读取
    └── worktree.ts    Git Worktree 管理
```

### 9.2 MCP — Model Context Protocol

```text
integration/mcp/
├── transport/   传输层
│   ├── http.ts  HTTP/SSE 传输
│   └── stdio.ts 标准 IO 传输
├── client.ts    MCP 客户端
├── manager.ts   多服务器管理
└── index.ts     LangChain 工具适配
```

### 9.3 Channel — 交互通道

```text
integration/channel/
├── registry.ts       ChannelRegistry（注册 + 路由）
├── hil-adapter.ts    HIL ← → Channel 适配
└── index.ts

通道路由：
  PauseRequest.channel
    → ChannelRegistry.resolveChannel()
    → channel.showPauseRequest()
    → 等待 ResumePayload
```

**已实现通道：**
- CLI Channel（Ink prompt）
- SSE Channel（server/channel.ts，10 分钟超时）
- Desktop Channel（React dialog）

**Gateway 渠道插件（7 个，通过 Gateway 动态加载）：**
- Telegram（Long Polling）
- Feishu / 飞书（Webhook）
- DingTalk / 钉钉（Webhook）
- QQ（OneBot WebSocket）
- WeCom / 企业微信（Webhook + 消息加解密）
- Discord（Gateway WebSocket）
- Slack（Socket Mode）

### 9.3.1 Gateway 会话作用域

Gateway 通过 `session-key.ts` 实现多租户会话隔离，支持 4 种 DM 作用域模式：

| DM 作用域 | Session Key 模式 | 适用场景 |
|-----------|-----------------|---------|
| `main` | `codara:main` | 所有私聊共享一个会话 |
| `per-peer` | `codara:direct:<peerId>` | 每个用户独立会话 |
| `per-channel-peer` | `codara:<channel>:direct:<peerId>` | 按渠道+用户隔离 |
| `per-account-channel-peer` | `codara:<channel>:<account>:direct:<peerId>` | 最细粒度隔离 |

群组消息始终按群隔离：`codara:<channel>:group:<groupId>`

**Identity Links**：跨渠道身份关联，将不同渠道的用户 ID 映射到同一 canonical name，实现跨平台会话共享。

**Session Reset Policy**：支持 3 种重置策略：
- `never` — 永不自动重置
- `idle` — 空闲超时重置（默认 120 分钟）
- `daily` — 每日定时重置（默认凌晨 4 点）

会话数据通过 `session-store.ts`（文件持久化 + 内存缓存）管理，支持原子写入。

### 9.4 Provider — 模型提供商

```text
integration/provider/
├── config/      配置 schema（zod 验证）
├── runtime/     ChatModelFactory
├── model.ts     ModelInfo + ModelRegistry + 上下文窗口查找
└── index.ts
```

支持：Claude, GPT, Gemini, DeepSeek, 本地模型（通过 LangChain 统一适配）。

---

## 10. 扩展机制体系

Codara 的扩展机制分为**三层递进**，所有扩展最终通过 Middleware 接入执行链：

```text
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Layer 3: Skill（用户态能力包）                           │
│  ┌───────────────────────────────────────────────────┐  │
│  │ SKILL.md 发现 → skills middleware 注入 → prompt   │  │
│  │ 命名空间：superworkers:brainstorming              │  │
│  │ 来源：~/.codara/skills/ + .codara/skills/         │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                  通过 middleware 注入                     │
│                          ▼                              │
│  Layer 2: Hook（生命周期桥接）                            │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 生命周期：agent:start → turn → tool → agent:end   │  │
│  │ 接入方式：hooks-bridge middleware                  │  │
│  │ 能力：观测，不控制                                  │  │
│  └───────────────────────────────────────────────────┘  │
│                          │                              │
│                  通过 middleware 桥接                     │
│                          ▼                              │
│  Layer 1: Middleware（第一扩展机制）                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 阶段级拦截：BeforeAgent → ... → AfterAgent        │  │
│  │ 能力：拦截、修改、放行、阻断、附加                    │  │
│  │ 组织：按职责，不按阶段                              │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**裁决：**
- Middleware 是唯一执行拦截机制
- Hook 只能观测，需要控制执行的需求必须实现为 middleware
- Skill 是高层抽象，通过 skills middleware 注入到 agent context

---

## 11. 主执行链路（9 阶段）

一次完整的 Codara 执行流经 9 个阶段：

```text
① 接入
   cli/ | desktop/ | server/ | gateway/ 接收用户动作
   统一转换为 AgentInput

② 装配
   codara/assembly 判断：新建 | 恢复 | 继续
   绑定 session + model + channel + middleware chains

③ 挂载支撑系统
   context/  → 注入指令、提示、记忆、技能
   durability/ → 绑定 session store + checkpoint
   observability/ → 绑定 events emitter + hook registry

④ 进入 Agent Loop
   core/agent/run/agent-loop 成为唯一执行推进器
   Stream-First：所有路径走 AsyncGenerator

⑤ Pipeline 阶段执行
   BeforeAgent → BeforeModel → ModelCall → ToolCall → AfterModel → AfterAgent
   每个阶段触发对应 middleware chain

⑥ Middleware 拦截
   skills 注入 · permission 评估 · HIL pause/resume · budget 控制 · logging

⑦ 协作分支
   task/delegation → 单代理子执行（stream-first）
   team/coordination → 多代理协作（leader + worker）
   子 agent 复用统一 Agent Loop

⑧ 落盘与观测
   durability/checkpoint → 每轮持久化状态
   observability/events → 运行时事件广播
   observability/hook → 生命周期钩子触发

⑨ 交互回传
   integration/channel → 路由到对应通道
   展示层渲染 transcript / progress / pause dialog
```

---

## 12. 领域事件

### 事件分类

| 事件 | 来源 | 消费者 |
|------|------|--------|
| `agent:start` | core/agent | observability, presentation |
| `agent:end` | core/agent | observability, presentation |
| `turn:start` | core/agent | observability, durability |
| `turn:end` | core/agent | observability, durability |
| `tool:start` | core/agent | observability, presentation |
| `tool:end` | core/agent | observability, presentation |
| `model:call` | core/agent | observability, budget |
| `pause:request` | core/middleware/hil | integration/channel → presentation |
| `pause:resume` | integration/channel | core/middleware/hil |
| `task:delegated` | capability/task | observability, presentation |
| `team:member:joined` | capability/team | observability, presentation |

### 事件流向

```text
core/ ──emit──→ observability/events ──broadcast──→ bus/ ──push──→ presentation/
  │                                                         │
  └──write──→ durability/checkpoint                         ├──→ cli/ (Ink)
                                                            ├──→ desktop/ (React)
                                                            ├──→ server/ (SSE)
                                                            └──→ gateway/ (IM 渠道)
```

---

## 13. 依赖规则

### 允许的依赖方向

```text
presentation  →  codara     →  core         →  shared
                 codara     →  capability   →  shared
                 codara     →  durability   →  shared
                 codara     →  observability →  shared
                 codara     →  integration  →  shared
                 codara     →  context      →  shared
                 codara     →  config       →  shared
                 core       →  integration  →  shared
                 core       →  durability   →  shared
                 core       →  observability →  shared
                 capability →  core         →  shared
                 capability →  integration  →  shared
                 capability →  durability   →  shared
                 capability →  observability →  shared
```

### 绝对禁止

| 方向 | 原因 |
|------|------|
| `context/ → core/` | 上下文源不控制执行 |
| `durability/ → core/` | 持久化不控制执行 |
| `observability/ → core/` | 观测不控制执行 |
| `integration/ → core/` | 适配层不控制执行 |
| `presentation/ → durability/` | 展示层不直接访问持久化 |
| `shared/ → 任何其他层` | 共享内核零外部依赖 |
| `config/ → core/` | 配置不控制执行 |
| 同层域间直接导入 | 必须通过 shared/contracts/ |

### 依赖矩阵

```text
             shared config context integration durability observability core capability codara presentation
shared         ·
config         →      ·
context        →      →       ·
integration    →      →       →          ·
durability     →      →                  ·          ·
observability  →                                                ·
core           →                         →          →           →         ·
capability     →                         →          →           →         →        ·
codara         →      →       →          →          →           →         →        →        ·
presentation   →      →                  →                      →                  →        →          ·

→ = 允许依赖    · = 自身    空 = 禁止
```

**核心规则只有一句：** 支撑系统可以被执行核心使用，但不能反向控制执行核心。

---

## 14. 共享契约（Shared Kernel）

同层域之间禁止直接导入，通过 `shared/contracts/` 通信：

```text
shared/contracts/
│
├── agent-types.ts       # AgentInput, AgentResult, AgentState, AgentStreamOutput
│                        # AgentType, CreateAgentOptions
│
├── channel.ts           # Channel, ChannelType, ChannelMessage
│                        # PauseRequest, ResumePayload
│
├── execution.ts         # ContextBudgetSnapshot, ExecutionContextMetadata
│
└── index.ts              # 统一导出
```

> **注意：** middleware、durability、observability、collaboration 的类型定义保留在各自规范源
> （`@core/pipeline/types`、`@durability/*`、`@observability/*`、`@capability/task`、`@capability/team/*`），
> 消费方直接从规范源导入，不经过 shared/contracts 中转。

**契约设计原则：**

1. **只包含接口和类型**，不包含实现
2. **只收录真正跨多个上下文消费的类型**，单域类型留在规范源
3. **最稳定的层**，变更频率最低
4. **消费方直接导入规范源**，不通过纯 re-export 中转

---

## 15. 公共 API Surface

`src/index.ts` 导出 Codara 的公共 API，分为以下几组：

| API 组 | 关键导出 | 来源 |
|--------|---------|------|
| **Runtime** | `createCodara()`, `createCodaraRuntime()`, `openCodaraSession()` | codara/ |
| **Agent** | `bootstrapAgent()`, `createAgent()`, `Agent`, `AgentResult` | core/agent |
| **Pipeline** | `createMiddleware()`, `MiddlewarePipeline` | core/pipeline |
| **Middleware** | `create*Middleware()` (全部 11 个) | core/middleware |
| **Task** | `createTaskTools()`, `createTaskMiddleware()` | capability/task |
| **Skill** | `FileSystemSkillStore`, `loadSkillsRuntimeData()` | capability/skill |
| **Session** | `createSession()`, `FileSessionStore` | durability/session |
| **Checkpoint** | `FileCheckpointer`, `InMemoryCheckpointer` | durability/checkpoint |
| **Events** | `CodaraRuntimeEvent` | observability/events |
| **Hook** | `HookRegistry`, `HookExecutor` | observability/hook |
| **Tool** | `createBuiltinTools()` | integration/tool |
| **MCP** | `createMcpManager()`, `McpClient` | integration/mcp |
| **Provider** | `ChatModelFactory`, `ModelRegistry` | integration/provider |
| **Channel** | `ChannelRegistry`, `Channel` | integration/channel |
| **Context** | `createCodaraGuidelinesSource()`, `readBaseSystemMessage()` | context/ |

---

## 附录：技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Bun |
| 语言 | TypeScript (strict) |
| LLM | LangChain (Anthropic, OpenAI, Google, DeepSeek) |
| MCP | @modelcontextprotocol/sdk v1.27 |
| CLI | Ink (React for terminal) |
| Desktop | React + Vite + Tauri v2 |
| 校验 | Zod |
| 测试 | Bun test |
| 构建 | tsc + tsc-alias |
