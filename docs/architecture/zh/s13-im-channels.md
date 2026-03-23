# 第14章：IM Channels — 多通道消息路由

> **从终端到全平台**：让 agent 接入 Telegram、Slack、Discord、WhatsApp 等 13+ 平台，成为真正的"全渠道助手"。

---

## 为什么需要多渠道

**终端的局限**：
- 只能在电脑前使用
- 无法在手机上快速交互
- 团队协作困难（无法共享会话）

**IM 渠道的价值**：
- **移动优先**：随时随地与 agent 交互
- **团队协作**：在群组中 @agent 提问
- **异步通知**：agent 主动推送消息
- **多模态**：支持图片、文件、语音

---

## 核心机制

### 1. Channel Plugin — 渠道插件

每个 IM 平台对应一个 plugin：

```typescript
interface ChannelPlugin {
  name: string;

  // 接收消息
  startPolling(handler: MessageHandler): void;

  // 发送消息
  send(params: {
    threadId: string;
    text: string;
    replyTo?: string;
  }): Promise<void>;

  // 其他能力
  react(messageId: string, emoji: string): Promise<void>;
  editMessage(messageId: string, newText: string): Promise<void>;
}
```

**插件化设计**：
- 每个平台独立实现
- 统一接口，方便扩展
- 核心逻辑与平台解耦

### 2. Message Routing — 消息路由

收到消息后，路由到对应的 agent：

```typescript
async function routeIncomingMessage(msg: IncomingMessage) {
  // 1. 解析消息来源
  const { channel, threadId, userId, text } = msg;

  // 2. 查找或创建 session
  const sessionKey = `${channel}:${threadId}:${userId}`;
  const session = await getOrCreateSession(sessionKey);

  // 3. 检查权限
  if (!isAllowedUser(channel, userId)) {
    return sendReply("Sorry, you're not authorized");
  }

  // 4. 执行 agent
  const result = await runAgent({
    input: text,
    session,
  });

  // 5. 发送回复
  await sendReply(result.output, { threadId, replyTo: msg.id });
}
```

**路由策略**：
- **Session Key**：`channel:thread:user` 唯一标识会话
- **权限检查**：allowlist 控制谁能使用
- **上下文隔离**：不同渠道的会话互不干扰

### 3. Delivery Dispatch — 投递分发

Agent 输出后，分发到目标渠道：

```typescript
async function dispatchDelivery(
  output: AgentOutput,
  target: DeliveryTarget
) {
  const plugin = getChannelPlugin(target.channel);

  // 分块发送（避免超长消息）
  const chunks = splitIntoChunks(output.text, 4000);
  for (const chunk of chunks) {
    await plugin.send({
      threadId: target.threadId,
      text: chunk,
    });
  }

  // 发送附件
  if (output.files) {
    for (const file of output.files) {
      await plugin.sendFile({
        threadId: target.threadId,
        file,
      });
    }
  }
}
```

**分发逻辑**：
- **分块**：超长消息拆分（Telegram 限制 4096 字符）
- **附件**：支持文件、图片、语音
- **重试**：网络失败自动重试

### 4. Polling vs Webhook

两种消息接收模式：

```typescript
// Polling（长轮询）
async function startPolling() {
  let offset = 0;
  while (true) {
    const updates = await api.getUpdates({ offset });
    for (const update of updates) {
      await handleMessage(update);
      offset = update.id + 1;
    }
    await sleep(1000);
  }
}

// Webhook（回调）
app.post("/webhook/telegram", async (req, res) => {
  const update = req.body;
  await handleMessage(update);
  res.sendStatus(200);
});
```

**选择策略**：
| 模式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| Polling | 简单，无需公网 IP | 延迟高，浪费资源 | 开发环境，个人使用 |
| Webhook | 实时，高效 | 需要公网 IP，配置复杂 | 生产环境，高并发 |

---

## 设计权衡

| 维度 | 选择 | 原因 |
|------|------|------|
| **插件架构** | 独立插件 | 解耦核心逻辑，易扩展 |
| **Session Key** | `channel:thread:user` | 唯一标识，支持多渠道 |
| **消息接收** | Polling 优先 | 简单可靠，无需公网 IP |
| **消息分块** | 4000 字符 | 兼容大部分平台限制 |
| **权限控制** | Allowlist | 防止滥用，保护隐私 |

**为什么用 Polling**：
- Webhook 需要公网 IP 和 HTTPS
- 个人使用场景下，Polling 更简单
- 延迟 1-2 秒可接受

**为什么 Session Key 包含 user**：
- 同一个群组，不同用户有独立会话
- 避免上下文混乱
- 支持"私聊"和"群聊"两种模式

---

## 支持的平台

OpenClaw 支持 13+ 平台：

| 平台 | 协议 | 特性 |
|------|------|------|
| **Telegram** | Bot API | 最完善，支持 inline keyboard |
| **Slack** | Bolt SDK | 企业级，支持 slash commands |
| **Discord** | Gateway | 游戏社区，支持 voice |
| **WhatsApp** | Web.js | 最流行，但不稳定 |
| **Feishu** | Open API | 国内企业，支持审批流 |
| **DingTalk** | Open API | 国内企业，支持钉钉文档 |
| **WeChat** | Wechaty | 个人微信，风险高 |

**平台选择建议**：
- **个人使用**：Telegram（最稳定）
- **团队协作**：Slack / Feishu
- **国内用户**：Feishu / DingTalk
- **避免使用**：WeChat（封号风险）

---

## 实现细节

### 1. Telegram Plugin

```typescript
class TelegramPlugin implements ChannelPlugin {
  private bot: TelegramBot;
  private offset = 0;

  async startPolling(handler: MessageHandler) {
    while (true) {
      const updates = await this.bot.getUpdates({
        offset: this.offset,
        timeout: 30,  // 长轮询 30 秒
      });

      for (const update of updates) {
        if (update.message) {
          await handler({
            channel: "telegram",
            threadId: String(update.message.chat.id),
            userId: String(update.message.from.id),
            text: update.message.text,
            messageId: String(update.message.message_id),
          });
        }
        this.offset = update.update_id + 1;
      }
    }
  }

  async send(params) {
    await this.bot.sendMessage(params.threadId, params.text, {
      reply_to_message_id: params.replyTo,
      parse_mode: "Markdown",
    });
  }
}
```

**Telegram 特性**：
- 支持 Markdown 格式
- 支持 inline keyboard（按钮）
- 支持文件上传（最大 50MB）

### 2. Allowlist 权限控制

```typescript
interface AllowlistConfig {
  telegram?: {
    users?: string[];      // 允许的用户 ID
    groups?: string[];     // 允许的群组 ID
  };
  slack?: {
    channels?: string[];
  };
}

function isAllowedUser(
  channel: string,
  userId: string,
  threadId: string
): boolean {
  const config = loadAllowlistConfig();
  const channelConfig = config[channel];

  if (!channelConfig) return false;

  // 检查用户白名单
  if (channelConfig.users?.includes(userId)) return true;

  // 检查群组白名单
  if (channelConfig.groups?.includes(threadId)) return true;

  return false;
}
```

**为什么需要 Allowlist**：
- 防止陌生人滥用
- 保护 API 配额
- 避免泄露敏感信息

### 3. 消息分块

```typescript
function splitIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
```

**分块策略**：
- 按行分割，保持完整性
- 避免截断代码块、链接
- 每块独立发送，保证顺序

---

## 与 Heartbeat/Cron 的协作

```
┌─────────────────────────────────────────┐
│         IM Channels                      │
│  ┌────────┐    ┌──────────┐    ┌─────┐  │
│  │ Polling│───▶│ Router   │───▶│ Send│  │
│  └────────┘    └────┬─────┘    └──▲──┘  │
└──────────────────────┼─────────────┼─────┘
                       │             │
┌──────────────────────┼─────────────┼─────┐
│         Heartbeat    │             │     │
│  ┌────────┐    ┌─────▼────┐    ┌──┴──┐  │
│  │ Timer  │───▶│ Wake Q   │───▶│ Run │  │
│  └────────┘    └──────────┘    └──┬──┘  │
└────────────────────────────────────┼─────┘
                                     │
┌────────────────────────────────────┼─────┐
│         Cron                        │     │
│  ┌────────┐    ┌──────────┐    ┌──▼──┐  │
│  │ Timer  │───▶│ Job Store│───▶│ Run │  │
│  └────────┘    └──────────┘    └──┬──┘  │
└────────────────────────────────────┼─────┘
                                     │
┌────────────────────────────────────┼─────┐
│         Agent Core                  │     │
│  ┌────────┐    ┌──────────┐    ┌──▼──┐  │
│  │ Input  │───▶│ Pipeline │───▶│ Out │  │
│  └────────┘    └──────────┘    └─────┘  │
└─────────────────────────────────────────┘
```

**三者的分工**：
- **IM Channels**：接收用户输入，发送 agent 输出
- **Heartbeat**：定期检查 IM 消息，触发 agent
- **Cron**：定时任务完成后，通过 IM 投递结果

**协作场景**：
1. 用户在 Telegram 发消息
2. Polling 收到消息，路由到 agent
3. Agent 执行完成，通过 Telegram 回复
4. Cron 任务到期，通过 Telegram 推送通知

---

## 总结

IM Channels 让 agent 从"终端工具"变成"全平台助手"：

1. **插件化架构**：每个平台独立实现，易扩展
2. **统一路由**：`channel:thread:user` 唯一标识会话
3. **灵活投递**：支持分块、附件、重试
4. **权限控制**：Allowlist 防止滥用

**关键洞察**：
- Polling 模式简单可靠，适合个人使用
- Session Key 设计保证多渠道隔离
- 与 Heartbeat/Cron 协作，实现全场景覆盖

下一章将讲解 **Memory**：如何让 agent 记住长期上下文。
