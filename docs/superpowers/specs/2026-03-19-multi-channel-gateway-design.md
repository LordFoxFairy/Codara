# Multi-Channel Message Gateway Design Spec

## Goal

为 Codara 构建统一消息网关，支持 IM 渠道（Telegram, Feishu, DingTalk, Discord, Slack, WeChat 等）接入，使 Codara Agent 能够通过任意消息平台与用户交互。

## Architecture

Gateway 是展示层的新成员，与 cli/desktop/server 平级。渠道适配器是集成层的扩展。两者通过 ChannelPlugin 契约解耦。

Gateway 支持两种部署模式：
- **内嵌模式**：Gateway + Codara Runtime 同进程（`bun run gateway`）
- **远程模式**：Gateway 通过 Bus 连接远程 Runtime（团队部署）

## Tech Stack

- Bun HTTP server（webhook 接收）
- 各平台 SDK/API（Telegram Bot API, Feishu Open API, DingTalk Robot API 等）
- Zod（配置校验）
- 参考实现：OpenClaw 的渠道适配器（`tmp/openclaw/extensions/`）

---

## 1. ChannelPlugin 契约

```typescript
// src/integration/channel/contracts.ts

interface ChannelPluginCapabilities {
  chatTypes: ('direct' | 'group' | 'channel')[];
  streaming: boolean;
  threads: boolean;
  media: boolean;
  reactions: boolean;
  textLimit: number;
}

interface ChannelPlugin<TAccount = unknown> {
  id: string;
  name: string;
  capabilities: ChannelPluginCapabilities;

  // 配置
  configSchema: ZodSchema;
  resolveAccount(config: ChannelConfig, accountId?: string): TAccount | undefined;

  // 入站：启动消息监听
  startListening(ctx: GatewayListenContext<TAccount>): Promise<StopHandle>;

  // 出站：发送消息
  sendText(ctx: OutboundContext<TAccount>): Promise<SendResult>;
  sendMedia?(ctx: OutboundMediaContext<TAccount>): Promise<SendResult>;
  sendTyping?(ctx: OutboundContext<TAccount>): Promise<void>;

  // HIL：发送审批卡片，等待回调
  sendPausePrompt?(ctx: PausePromptContext<TAccount>): Promise<SendResult>;
}

type StopHandle = { stop(): Promise<void> };

interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}
```

## 2. Gateway 核心

```typescript
// src/gateway/gateway.ts

class CodaraGateway {
  private plugins: Map<string, ChannelPlugin>;
  private handles: Map<string, StopHandle>;
  private sessionManager: GatewaySessionManager;
  private router: GatewayRouter;
  private config: GatewayConfig;

  // 启动：加载配置 → 注册插件 → 启动监听
  async start(): Promise<void>;

  // 停止：停止所有监听 → 清理会话
  async stop(): Promise<void>;

  // 入站消息处理（由 plugin.startListening 回调）
  async handleInbound(msg: InboundMessage): Promise<void>;

  // 注册渠道插件
  registerPlugin(plugin: ChannelPlugin): void;
}
```

## 3. 入站消息协议

```typescript
// src/gateway/inbound.ts

interface InboundMessage {
  channel: string;           // 'telegram' | 'feishu' | ...
  accountId: string;         // 哪个 bot/app
  messageId: string;         // 平台消息 ID

  // 发送者
  sender: {
    id: string;              // 平台用户 ID
    name?: string;
    username?: string;
  };

  // 会话上下文
  peer: {
    kind: 'direct' | 'group' | 'channel';
    id: string;              // chat/group/channel ID
    name?: string;
  };

  // 内容
  text: string;
  mediaUrls?: string[];
  replyToId?: string;
  threadId?: string;

  // 元数据
  timestamp: number;
  raw?: unknown;             // 平台原始消息（调试用）
}
```

## 4. 出站消息协议

```typescript
// src/gateway/outbound.ts

interface OutboundContext<TAccount = unknown> {
  account: TAccount;
  to: string;                // 目标 chat/user ID
  text: string;
  replyToId?: string;
  threadId?: string;
}

interface OutboundMediaContext<TAccount = unknown> extends OutboundContext<TAccount> {
  mediaUrl: string;
  mediaType: 'image' | 'file' | 'audio' | 'video';
  caption?: string;
}

interface PausePromptContext<TAccount = unknown> extends OutboundContext<TAccount> {
  pause: PauseRequest;
  actions: PausePromptAction[];
}

interface PausePromptAction {
  id: string;
  label: string;
  style: 'approve' | 'reject' | 'edit';
}
```

## 5. 消息路由

```typescript
// src/gateway/router.ts

interface GatewayRouter {
  // 构建 session key
  buildSessionKey(msg: InboundMessage): string;
  // channel:account:peer.kind:peer.id → "telegram:default:direct:123456"

  // 检查白名单
  isAllowed(msg: InboundMessage): boolean;

  // 群组策略：是否需要 @mention
  requiresMention(msg: InboundMessage): boolean;

  // 解析 agent profile（从 bindings 配置）
  resolveProfile(msg: InboundMessage): string | undefined;
}
```

## 6. 会话管理

```typescript
// src/gateway/session-manager.ts

interface GatewaySessionManager {
  // 获取或创建 Codara Session
  getOrCreate(sessionKey: string, profile?: string): Promise<Session>;

  // 清理过期会话
  cleanup(): Promise<void>;

  // 活跃会话数
  activeCount(): number;
}
```

## 7. 消息处理流程

```
1. Plugin.startListening() 收到平台消息
2. 规范化为 InboundMessage
3. Gateway.handleInbound(msg):
   a. router.isAllowed(msg) → 白名单检查
   b. router.requiresMention(msg) → 群组 @mention 检查
   c. inbound.debounce(msg) → 快速消息去抖合并
   d. router.buildSessionKey(msg) → session key
   e. sessionManager.getOrCreate(key) → Codara Session
   f. session.stream({messages: [HumanMessage(msg.text)]})
   g. 流式处理：
      - typing indicator → plugin.sendTyping()
      - 工具调用 → plugin.sendTyping() (持续)
      - HIL pause → plugin.sendPausePrompt()
      - 最终回复 → outbound.chunk(text, textLimit) → plugin.sendText()
```

## 8. HIL 在 IM 中的实现

```
Agent 触发 pause (permission/tool confirmation)
  → Gateway 检测 pendingPause
  → plugin.sendPausePrompt():
    Telegram: InlineKeyboard [✅ 批准] [❌ 拒绝]
    Feishu: 交互卡片
    DingTalk: ActionCard
  → 用户点击按钮 / 回复消息
  → Plugin callback_query handler 解析为 ResumePayload
  → session.resumePauseStream(payload)
  → 继续执行 → 出站回复
```

## 9. 配置

```json
{
  "gateway": {
    "host": "0.0.0.0",
    "port": 3001,
    "webhookBaseUrl": "https://your-domain.com/gateway"
  },
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": {
        "default": {
          "botToken": "$TELEGRAM_BOT_TOKEN",
          "allowUsers": ["123456789"],
          "allowGroups": ["-100123456"],
          "groupPolicy": { "requireMention": true }
        }
      }
    },
    "feishu": {
      "enabled": true,
      "accounts": {
        "default": {
          "appId": "$FEISHU_APP_ID",
          "appSecret": "$FEISHU_APP_SECRET",
          "verifyToken": "$FEISHU_VERIFY_TOKEN"
        }
      }
    }
  },
  "bindings": [
    { "channel": "telegram", "peer": "123456789", "profile": "default" }
  ]
}
```

## 10. 目录结构

```
src/gateway/
├── gateway.ts              # Gateway 主类
├── router.ts               # 消息路由 + session key
├── inbound.ts              # 入站规范化 + 去抖
├── outbound.ts             # 出站分片 + 格式转换
├── session-manager.ts      # 会话管理（key → Codara Session）
├── config.ts               # 配置加载（gateway.json）
├── types.ts                # InboundMessage, OutboundContext, etc
└── index.ts

src/integration/channel/
├── contracts.ts            # ChannelPlugin 契约（新）
├── registry.ts             # 渠道注册中心（重构）
├── hil-adapter.ts          # HIL 适配（重构）
├── telegram/
│   ├── plugin.ts           # ChannelPlugin 实现
│   ├── polling.ts          # getUpdates 长轮询
│   ├── outbound.ts         # sendMessage/sendPhoto/InlineKeyboard
│   ├── types.ts            # Telegram API 类型
│   └── index.ts
├── feishu/
│   ├── plugin.ts
│   ├── webhook.ts          # 事件订阅回调
│   ├── outbound.ts         # 消息/卡片发送
│   └── index.ts
├── dingtalk/
│   ├── plugin.ts
│   ├── webhook.ts
│   ├── outbound.ts
│   └── index.ts
├── discord/
│   ├── plugin.ts
│   ├── gateway-ws.ts       # Discord Gateway WebSocket
│   ├── outbound.ts
│   └── index.ts
├── slack/
│   ├── plugin.ts
│   ├── socket-mode.ts      # Slack Socket Mode
│   ├── outbound.ts
│   └── index.ts
└── wechat/
    ├── plugin.ts
    ├── webhook.ts
    ├── outbound.ts
    └── index.ts
```

## 11. 与现有系统的关系

- **Channel 契约替换**：现有 `shared/contracts/channel.ts` 的 `Channel` 接口过于狭窄（只有 HIL）。新的 `ChannelPlugin` 覆盖完整生命周期。旧 `Channel` 接口废弃。
- **ChannelRegistry 重构**：现有 registry 只管 HIL 路由。重构为管理 ChannelPlugin 实例的注册中心。
- **Server 不变**：server/ 继续作为 Desktop 的 HTTP/SSE 后端。Gateway 是独立的消息入口。
- **Bus 扩展**：远程模式下，Gateway 通过 Bus 协议连接远程 Runtime。当前阶段先实现内嵌模式。
- **架构文档更新**：01-global-architecture-overview.md 增加 Gateway 限界上下文。

## 12. 实施优先级

| Phase | 内容 | 预估 |
|-------|------|------|
| P0 | ChannelPlugin 契约 + Gateway 核心 + Router + SessionManager | 基础框架 |
| P0 | Telegram 适配器（从 OpenClaw 移植 polling + outbound） | 第一个可用渠道 |
| P1 | Feishu 适配器（webhook + 卡片消息） | 国内场景 |
| P1 | DingTalk 适配器（webhook + ActionCard） | 国内场景 |
| P1 | HIL 按钮交互（Telegram InlineKeyboard, Feishu 卡片） | 审批能力 |
| P1 | 出站分片 + Markdown 格式转换 | 长消息支持 |
| P2 | Discord + Slack 适配器 | 海外场景 |
| P2 | 群组策略（@mention, 白名单） | 安全 |
| P2 | 入站去抖 + 媒体组缓冲 | 体验优化 |
| P3 | 企微/QQ + 更多渠道 | 扩展 |
| P3 | 远程模式（Gateway ↔ Bus ↔ Runtime） | 团队部署 |
