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
  <a href="#架构总览">架构</a>
  ·
  <a href="#核心机制">核心</a>
  ·
  <a href="#常用命令">常用命令</a>
</p>

Codara 把会话、任务、子代理、权限和 CLI 交互收进同一套 Bun + TypeScript 运行时里。它不是一个包着模型调用的聊天壳，而是一个可以直接运行、验证和扩展的终端编码工作台。

<p align="center">
  <img src="./imgs/img.png" alt="Codara CLI" width="760" />
</p>

## 为什么是 Codara

- 你想先跑通真实的终端编码流程，而不是先堆一层又一层 agent demo
- 你希望 session、任务委派、子代理、权限和交互边界放在同一套 runtime 里维护
- 你需要一个能继续演化成产品的底座，而不是一次性的脚本拼装

先把工作流打通，再围绕真实使用体验做收敛。

---

## 架构总览

```
                           ┌─────────────────┐
                           │     用户输入      │
                           └────────┬────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
    ┌────┴────┐              ┌──────┴──────┐            ┌──────┴──────┐
    │   CLI   │              │   Desktop   │            │   Server    │
    │  (Ink)  │              │   (React)   │            │  (HTTP/SSE) │
    └────┬────┘              └──────┬──────┘            └──────┬──────┘
         │                          │                          │
         └──────────────────────────┼──────────────────────────┘
                                    │
                                    ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                         Codara Runtime                                    ┃
┃                                                                           ┃
┃   createCodaraRuntime() 组装全部子系统，输出 Session + 命令 + 事件         ┃
┃                                                                           ┃
┃   ┌─ 模型 ──────┐  ┌─ 工具 ──────────────┐  ┌─ 上下文 ───────────────┐  ┃
┃   │ ModelCatalog │  │ Built-in + MCP Tools │  │ Guidelines · Prompts   │  ┃
┃   │ 多模型路由    │  │ bash/read/edit/...   │  │ Skills · AutoMemory    │  ┃
┃   └──────────────┘  └──────────────────────┘  └────────────────────────┘  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                              │
                              ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                          Agent Loop                                       ┃
┃                                                                           ┃
┃   每个 Agent 执行一个 stream 化的 model → tools → model 循环              ┃
┃   支持 invoke() / stream() / resume() 三种执行模式                        ┃
┃                                                                           ┃
┃   ┌───────────────────────────────────────────────────────────────────┐   ┃
┃   │                     Middleware Pipeline                           │   ┃
┃   │                                                                   │   ┃
┃   │   ┌──────────┐    ┌──────────┐    ┌───────────────────────────┐  │   ┃
┃   │   │ Before   │    │ Before   │    │       Model Call          │  │   ┃
┃   │   │ Agent    │───▶│ Model    │───▶│  LLM 推理 (Claude/GPT/..)│  │   ┃
┃   │   │          │    │          │    │                           │  │   ┃
┃   │   │ Skills   │    │ Budget   │    └─────────┬─────────────────┘  │   ┃
┃   │   │ Context  │    │ Summary  │              │                    │   ┃
┃   │   └──────────┘    └──────────┘              │ tool_calls         │   ┃
┃   │                                             ▼                    │   ┃
┃   │   ┌──────────┐    ┌──────────┐    ┌───────────────────────────┐  │   ┃
┃   │   │ After    │    │ After    │    │       Tool Call           │  │   ┃
┃   │   │ Agent    │◀───│ Model    │◀───│                           │  │   ┃
┃   │   │          │    │          │    │  Permission → HIL Pause?  │  │   ┃
┃   │   │ Hooks    │    │ Logging  │    │       │                   │  │   ┃
┃   │   │ Checkpoint│   │          │    │       ▼                   │  │   ┃
┃   │   └──────────┘    └──────────┘    │  bash · read · edit ···  │  │   ┃
┃   │                                   │  MCP tools · TaskCreate  │  │   ┃
┃   │                                   └───────────────────────────┘  │   ┃
┃   └───────────────────────────────────────────────────────────────────┘   ┃
┃                              │                                            ┃
┃                    ┌─────────┴──────────┐                                 ┃
┃                    │  下一轮 or 结束？    │                                 ┃
┃                    │  max_turns / pause  │                                 ┃
┃                    └────────────────────┘                                  ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┳━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                              │
                  ┌───────────┴───────────┐
                  │                       │
                  ▼                       ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━┓  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃   Task Delegation       ┃  ┃   Team Collaboration                       ┃
┃                         ┃  ┃                                             ┃
┃   主 Agent 派生子 Agent  ┃  ┃   Leader 协调 + Workers 并行               ┃
┃   stream 化执行          ┃  ┃                                             ┃
┃   活动实时上报           ┃  ┃   ┌────────┐                               ┃
┃                         ┃  ┃   │ Leader │──分派──┬──────┬──────┐        ┃
┃   Parent                ┃  ┃   └────────┘       │      │      │        ┃
┃     └─ Child Agent      ┃  ┃                ┌───┴──┐┌──┴───┐┌─┴────┐  ┃
┃          └─ Tools       ┃  ┃                │Wrkr A││Wrkr B││Wrkr C│  ┃
┃                         ┃  ┃                │stream││stream││stream│  ┃
┃                         ┃  ┃                └──┬───┘└──┬───┘└──┬───┘  ┃
┃                         ┃  ┃                   └───────┴───────┘       ┃
┃                         ┃  ┃                     LocalTransport        ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━┛  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
                              │
                              ▼
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
┃                         持久化 & 通信                                      ┃
┃                                                                           ┃
┃   ┌──────────┐  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  ┃
┃   │ Session  │  │  Checkpoint  │  │   Channel    │  │  Runtime Events │  ┃
┃   │          │  │              │  │   Registry   │  │                 │  ┃
┃   │ 会话元数据│  │ 完整状态快照  │  │              │  │  实时事件流      │  ┃
┃   │ 恢复/归档 │  │ compact 压缩 │  │ CLI/SSE/IM  │  │  工具活动上报    │  ┃
┃   │          │  │ stale lock   │  │ HIL 路由     │  │  Team 状态同步   │  ┃
┃   └──────────┘  └──────────────┘  └──────────────┘  └─────────────────┘  ┃
┃                                                                           ┃
┃   ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐   ┃
┃   │  Lifecycle Hooks │  │   MCP Protocol   │  │   Model Provider     │   ┃
┃   │                  │  │                  │  │                      │   ┃
┃   │  PreToolUse      │  │  Server 发现     │  │  Claude / GPT /      │   ┃
┃   │  PostToolUse     │  │  工具注册         │  │  Gemini / DeepSeek / │   ┃
┃   │  SubagentStart   │  │  progress 通知   │  │  本地模型 ...         │   ┃
┃   └──────────────────┘  └──────────────────┘  └──────────────────────┘   ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
```

### 一次完整交互的技术链路

```
用户在终端键入 "修复 auth 模块的 token 过期 bug"

  1. CLI 层 ──────────────── Ink 收集输入，构造 HumanMessage
  2. Session ─────────────── 恢复上次 checkpoint（如有），初始化 Agent 状态
  3. Agent Loop (stream) ─── 进入 model→tools→model 循环
     │
     ├─ BeforeAgent ──────── Skills/Guidelines/Memory 注入 system prompt
     ├─ BeforeModel ──────── Token budget 检查，必要时 summary 压缩
     ├─ ModelCall ─────────── LLM 推理 → 返回: "我需要先看一下相关代码"
     │                                     tool_calls: [read("auth.ts"), grep("token")]
     ├─ ToolCall ──────────── Permission 中间件评估:
     │   │                      read → allow (自动放行)
     │   │                      grep → allow
     │   │
     │   ├─ 执行 read("auth.ts") → 返回文件内容
     │   └─ 执行 grep("token")   → 返回匹配行
     │
     ├─ AfterModel ────────── 日志记录，token 计数
     ├─ (下一轮) ModelCall ── LLM: "找到 bug，需要修改" → tool_calls: [edit("auth.ts")]
     ├─ ToolCall ──────────── Permission 评估:
     │   │                      edit → ask (需要人工审批)
     │   │
     │   ├─ HIL Pause ─────── 构造 PauseRequest，发送到 Channel
     │   ├─ Channel ─────────── CLI: 渲染审批面板，用户按 y 确认
     │   ├─ Resume ──────────── 恢复执行，edit("auth.ts") 完成
     │   └─ AfterModel
     │
     └─ Agent 判断任务完成 → 输出最终响应

  4. Checkpoint ────────────── 保存完整状态（messages + context + values）
  5. CLI ───────────────────── Transcript 渲染 markdown + diff
```

---

## 核心机制

### Agent Loop — 执行核心

每个 Agent 运行 `model → tools → model` 循环。所有执行路径均为 **stream 化**：delegation 和 team worker 使用 `stream()` 而非 `invoke()`，中间件 hook 实时触发，不阻塞。

三种执行模式：
- **stream()** — 流式执行，边推理边输出（主推）
- **invoke()** — 阻塞执行，返回最终结果
- **resume() / resumeStream()** — 从 HIL 暂停点恢复

### Middleware Pipeline — 6 个拦截点

所有 Agent 执行经过统一管道。中间件按声明顺序执行，可拦截、修改或暂停任何阶段：

| 阶段 | 触发时机 | 核心中间件 |
|------|---------|-----------|
| BeforeAgent | Agent 启动 | Skills 注入、PathInstructions（CLAUDE.md） |
| BeforeModel | 每次 LLM 调用前 | Budget（token 预算）、Summary（对话压缩） |
| ModelCall | 模型推理 | Logging（日志） |
| **ToolCall** | **工具执行** | **Permission（allow/ask/deny）→ HIL（暂停/恢复）** |
| AfterModel | 推理完成后 | Logging、Checkpoint |
| AfterAgent | 循环结束 | Lifecycle Hooks |

### HIL & Channel — 人机协作

工具执行可被 Permission 中间件拦截，触发 HIL 暂停。暂停请求通过 **ChannelRegistry** 路由到对应的交互通道：

- **CLI Channel** — Ink 渲染审批面板，终端内交互
- **SSE Channel** — 通过 Server-Sent Events 发送到 Web/Desktop 客户端
- **IM Channel** — 路由到 Telegram / DingTalk / Feishu / QQ / WeCom（预留）

### Task & Team — 多 Agent 协作

**Task（单代理派发）：** 主 Agent 通过 Delegation 工具 spawn 子 Agent。子 Agent stream 化执行，活动实时上报到主 Agent 的 runtime events。

**Team（多代理协作）：** Leader Agent 创建团队，分派 Job 到 Worker Agent。Workers 通过 LocalTransport 通信，独立 stream 化执行，各自有 Permission + HIL 支持。

### Session & Checkpoint — 持久化

- **Session** — 对话元数据（id, status, createdAt），支持 list / archive / restore
- **Checkpoint** — Agent 完整状态快照（messages + context + values），文件级原子写入
- **Compact** — 消息超阈值时自动截断，保留最近 N 条
- **Lock** — Advisory 文件锁，自动检测 stale lock（PID 存活 + 5 分钟 TTL）

---

## 快速开始

```bash
bun install
bun run dev         # 启动 CLI（watch 模式）
```

单次运行或快速检查：

```bash
bun run dev:once    # 单次运行 CLI
bun run check:fast  # lint + typecheck
```

## 常用命令

```bash
bun run dev           # CLI 开发模式
bun run dev:once      # 单次运行
bun run dev:desktop   # Desktop 开发模式
bun run dev:server    # Server 模式
bun run check:fast    # lint + typecheck
bun run test          # 运行测试
bun run build         # 构建 dist/
```

## 技术栈

| 层 | 技术 |
|---|------|
| Runtime | Bun |
| Language | TypeScript (strict) |
| CLI UI | Ink + React |
| Desktop UI | React + Vite |
| LLM | LangChain (Claude / GPT / Gemini / DeepSeek / ...) |
| Tools | MCP Protocol + Built-in |
| Package | ESM |

---

这个仓库在持续演进中。架构设计优先保证主线链路的完整性和可扩展性。
