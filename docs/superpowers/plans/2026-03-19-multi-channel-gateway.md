# Multi-Channel Gateway P0 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Message Gateway that enables Codara to receive and respond to messages from IM platforms (Telegram first), with full HIL support via inline buttons.

**Architecture:** Gateway is a presentation-layer entry point (`src/gateway/`) that manages ChannelPlugin lifecycles, routes inbound messages to Codara Sessions, and dispatches outbound replies. Channel adapters live in `src/integration/channel/` as infrastructure. The existing `Channel` interface in `shared/contracts/channel.ts` is replaced by the richer `ChannelPlugin` contract.

**Tech Stack:** Bun HTTP server, Telegram Bot API (direct fetch, no grammy dependency), Zod config validation

**Reference:** OpenClaw Telegram adapter at `tmp/openclaw/extensions/telegram/`

---

## Chunk 1: ChannelPlugin Contract + Gateway Types

### Task 1: ChannelPlugin Contract

**Files:**
- Create: `src/integration/channel/contracts.ts` (replace existing if present)
- Create: `src/gateway/types.ts`
- Test: `tests/unit/gateway/contracts.test.ts`

- [ ] **Step 1: Create gateway types**

Create `src/gateway/types.ts`:

```typescript
import type {PauseRequest, ResumePayload} from '@shared/contracts/agent-types';

/** Inbound message from any IM platform, normalized to a common format. */
export interface InboundMessage {
  channel: string;
  accountId: string;
  messageId: string;
  sender: {id: string; name?: string; username?: string};
  peer: {kind: 'direct' | 'group' | 'channel'; id: string; name?: string};
  text: string;
  mediaUrls?: string[];
  replyToId?: string;
  threadId?: string;
  timestamp: number;
  raw?: unknown;
}

/** Outbound text context for sending a reply. */
export interface OutboundContext {
  accountId: string;
  to: string;
  text: string;
  replyToId?: string;
  threadId?: string;
}

/** Outbound media context. */
export interface OutboundMediaContext extends OutboundContext {
  mediaUrl: string;
  mediaType: 'image' | 'file' | 'audio' | 'video';
  caption?: string;
}

/** HIL pause prompt context for IM buttons. */
export interface PausePromptContext extends OutboundContext {
  pause: PauseRequest;
  actions: PausePromptAction[];
}

export interface PausePromptAction {
  id: string;
  label: string;
  style: 'approve' | 'reject' | 'edit';
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export type StopHandle = {stop(): Promise<void>};

/** Gateway configuration loaded from gateway.json. */
export interface GatewayConfig {
  gateway?: {host?: string; port?: number; webhookBaseUrl?: string};
  channels: Record<string, ChannelAccountsConfig>;
  bindings?: GatewayBinding[];
}

export interface ChannelAccountsConfig {
  enabled?: boolean;
  accounts: Record<string, Record<string, unknown>>;
}

export interface GatewayBinding {
  channel: string;
  peer?: string;
  group?: string;
  profile?: string;
}
```

- [ ] **Step 2: Create ChannelPlugin contract**

Replace `src/integration/channel/contracts.ts`:

```typescript
import type {ZodType} from 'zod';
import type {
  InboundMessage,
  OutboundContext,
  OutboundMediaContext,
  PausePromptContext,
  SendResult,
  StopHandle,
} from '@gateway/types';

export interface ChannelPluginCapabilities {
  chatTypes: ('direct' | 'group' | 'channel')[];
  streaming: boolean;
  threads: boolean;
  media: boolean;
  reactions: boolean;
  textLimit: number;
}

export interface GatewayListenContext<TAccount = unknown> {
  account: TAccount;
  accountId: string;
  config: Record<string, unknown>;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onPauseResponse?: (pauseId: string, payload: unknown) => void;
}

/**
 * ChannelPlugin — unified contract for IM platform adapters.
 *
 * Each adapter (Telegram, Feishu, DingTalk, etc.) implements this interface.
 * The Gateway manages plugin lifecycles and routes messages through them.
 */
export interface ChannelPlugin<TAccount = unknown> {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ChannelPluginCapabilities;

  configSchema: ZodType;
  resolveAccount(config: Record<string, unknown>, accountId?: string): TAccount | undefined;

  startListening(ctx: GatewayListenContext<TAccount>): Promise<StopHandle>;

  sendText(account: TAccount, ctx: OutboundContext): Promise<SendResult>;
  sendMedia?(account: TAccount, ctx: OutboundMediaContext): Promise<SendResult>;
  sendTyping?(account: TAccount, ctx: OutboundContext): Promise<void>;
  sendPausePrompt?(account: TAccount, ctx: PausePromptContext): Promise<SendResult>;
}
```

- [ ] **Step 3: Write contract validation test**

Create `tests/unit/gateway/contracts.test.ts`:

```typescript
import {describe, test, expect} from 'bun:test';
import type {ChannelPlugin} from '@integration/channel/contracts';
import type {InboundMessage} from '@gateway/types';

describe('ChannelPlugin contract', () => {
  test('mock plugin satisfies the interface', () => {
    const plugin: ChannelPlugin<{token: string}> = {
      id: 'test',
      name: 'Test Channel',
      capabilities: {
        chatTypes: ['direct'],
        streaming: false,
        threads: false,
        media: false,
        reactions: false,
        textLimit: 4096,
      },
      configSchema: {} as any,
      resolveAccount: () => ({token: 'test'}),
      startListening: async () => ({stop: async () => {}}),
      sendText: async () => ({ok: true, messageId: '1'}),
    };
    expect(plugin.id).toBe('test');
    expect(plugin.capabilities.textLimit).toBe(4096);
  });

  test('InboundMessage has required fields', () => {
    const msg: InboundMessage = {
      channel: 'telegram',
      accountId: 'default',
      messageId: '123',
      sender: {id: '456', name: 'Test User'},
      peer: {kind: 'direct', id: '456'},
      text: 'hello',
      timestamp: Date.now(),
    };
    expect(msg.channel).toBe('telegram');
    expect(msg.peer.kind).toBe('direct');
  });
});
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/unit/gateway/contracts.test.ts`
Expected: PASS

- [ ] **Step 5: Update tsconfig paths**

Add to `tsconfig.json` paths:
```json
"@gateway/*": ["src/gateway/*"]
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(gateway): ChannelPlugin 契约 + Gateway 类型定义"
```

---

## Chunk 2: Gateway Core (Router + SessionManager + Gateway)

### Task 2: Gateway Router

**Files:**
- Create: `src/gateway/router.ts`
- Test: `tests/unit/gateway/router.test.ts`

- [ ] **Step 1: Create router**

Create `src/gateway/router.ts`:

```typescript
import type {InboundMessage, GatewayConfig, GatewayBinding} from './types';

export interface GatewayRouter {
  buildSessionKey(msg: InboundMessage): string;
  isAllowed(msg: InboundMessage): boolean;
  requiresMention(msg: InboundMessage): boolean;
  resolveProfile(msg: InboundMessage): string | undefined;
}

export function createGatewayRouter(config: GatewayConfig): GatewayRouter {
  const channelConfigs = config.channels;
  const bindings = config.bindings ?? [];

  return {
    buildSessionKey(msg) {
      return `${msg.channel}:${msg.accountId}:${msg.peer.kind}:${msg.peer.id}`;
    },

    isAllowed(msg) {
      const channelConfig = channelConfigs[msg.channel];
      if (!channelConfig?.enabled) return false;
      const accountConfig = channelConfig.accounts[msg.accountId];
      if (!accountConfig) return false;

      const allowUsers = accountConfig.allowUsers as string[] | undefined;
      const allowGroups = accountConfig.allowGroups as string[] | undefined;

      if (msg.peer.kind === 'direct') {
        return !allowUsers || allowUsers.length === 0 || allowUsers.includes(msg.sender.id);
      }
      return !allowGroups || allowGroups.length === 0 || allowGroups.includes(msg.peer.id);
    },

    requiresMention(msg) {
      if (msg.peer.kind === 'direct') return false;
      const channelConfig = channelConfigs[msg.channel];
      const accountConfig = channelConfig?.accounts[msg.accountId];
      const groupPolicy = accountConfig?.groupPolicy as {requireMention?: boolean} | undefined;
      return groupPolicy?.requireMention ?? true;
    },

    resolveProfile(msg) {
      const binding = bindings.find((b) => {
        if (b.channel !== msg.channel) return false;
        if (b.peer && b.peer !== msg.sender.id && b.peer !== msg.peer.id) return false;
        if (b.group && b.group !== msg.peer.id) return false;
        return true;
      });
      return binding?.profile;
    },
  };
}
```

- [ ] **Step 2: Write router tests**

Create `tests/unit/gateway/router.test.ts`:

```typescript
import {describe, test, expect} from 'bun:test';
import {createGatewayRouter} from '@gateway/router';
import type {InboundMessage, GatewayConfig} from '@gateway/types';

const config: GatewayConfig = {
  channels: {
    telegram: {
      enabled: true,
      accounts: {
        default: {
          allowUsers: ['123'],
          allowGroups: ['-100999'],
          groupPolicy: {requireMention: true},
        },
      },
    },
  },
  bindings: [{channel: 'telegram', peer: '123', profile: 'dev'}],
};

const directMsg: InboundMessage = {
  channel: 'telegram',
  accountId: 'default',
  messageId: '1',
  sender: {id: '123', name: 'Alice'},
  peer: {kind: 'direct', id: '123'},
  text: 'hello',
  timestamp: Date.now(),
};

const groupMsg: InboundMessage = {
  ...directMsg,
  sender: {id: '456', name: 'Bob'},
  peer: {kind: 'group', id: '-100999', name: 'Dev Group'},
};

describe('GatewayRouter', () => {
  const router = createGatewayRouter(config);

  test('buildSessionKey', () => {
    expect(router.buildSessionKey(directMsg)).toBe('telegram:default:direct:123');
    expect(router.buildSessionKey(groupMsg)).toBe('telegram:default:group:-100999');
  });

  test('isAllowed — allowed user', () => {
    expect(router.isAllowed(directMsg)).toBe(true);
  });

  test('isAllowed — blocked user', () => {
    expect(router.isAllowed({...directMsg, sender: {id: '999'}})).toBe(false);
  });

  test('isAllowed — allowed group', () => {
    expect(router.isAllowed(groupMsg)).toBe(true);
  });

  test('requiresMention — direct is false', () => {
    expect(router.requiresMention(directMsg)).toBe(false);
  });

  test('requiresMention — group respects config', () => {
    expect(router.requiresMention(groupMsg)).toBe(true);
  });

  test('resolveProfile — matches binding', () => {
    expect(router.resolveProfile(directMsg)).toBe('dev');
  });

  test('resolveProfile — no match returns undefined', () => {
    expect(router.resolveProfile({...directMsg, channel: 'slack'})).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests, verify pass**
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(gateway): 消息路由 — session key + 白名单 + @mention + binding"
```

### Task 3: Gateway Session Manager

**Files:**
- Create: `src/gateway/session-manager.ts`
- Test: `tests/unit/gateway/session-manager.test.ts`

- [ ] **Step 1: Create session manager**

Create `src/gateway/session-manager.ts`:

```typescript
import type {Codara} from '@codara/types';

export interface GatewaySessionManager {
  getOrCreate(sessionKey: string): Promise<Codara>;
  get(sessionKey: string): Codara | undefined;
  remove(sessionKey: string): Promise<void>;
  activeCount(): number;
  disposeAll(): Promise<void>;
}

export function createGatewaySessionManager(options: {
  createRuntime: (sessionKey: string) => Promise<Codara>;
  maxSessions?: number;
}): GatewaySessionManager {
  const sessions = new Map<string, Codara>();
  const maxSessions = options.maxSessions ?? 100;

  return {
    async getOrCreate(sessionKey) {
      let session = sessions.get(sessionKey);
      if (session) return session;

      if (sessions.size >= maxSessions) {
        // Evict oldest session
        const oldest = sessions.keys().next().value;
        if (oldest) {
          const evicted = sessions.get(oldest);
          sessions.delete(oldest);
          await evicted?.dispose();
        }
      }

      session = await options.createRuntime(sessionKey);
      sessions.set(sessionKey, session);
      return session;
    },

    get(sessionKey) {
      return sessions.get(sessionKey);
    },

    async remove(sessionKey) {
      const session = sessions.get(sessionKey);
      sessions.delete(sessionKey);
      await session?.dispose();
    },

    activeCount() {
      return sessions.size;
    },

    async disposeAll() {
      const promises = [...sessions.values()].map((s) => s.dispose());
      await Promise.allSettled(promises);
      sessions.clear();
    },
  };
}
```

- [ ] **Step 2: Write tests**
- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(gateway): 会话管理 — 多租户 session key 映射"
```

### Task 4: Gateway Core + Outbound

**Files:**
- Create: `src/gateway/outbound.ts`
- Create: `src/gateway/gateway.ts`
- Create: `src/gateway/config.ts`
- Create: `src/gateway/index.ts`

- [ ] **Step 1: Create outbound utilities**

Create `src/gateway/outbound.ts`:

```typescript
/** Split text into chunks respecting the platform's character limit. */
export function chunkText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline within limit
    let splitAt = remaining.lastIndexOf('\n', limit);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', limit);
    if (splitAt <= 0) splitAt = limit;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  return chunks;
}
```

- [ ] **Step 2: Create gateway config loader**

Create `src/gateway/config.ts`:

```typescript
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {GatewayConfig} from './types';

const CONFIG_FILE = 'gateway.json';

export async function loadGatewayConfig(configPath?: string): Promise<GatewayConfig> {
  const filePath = configPath ?? path.join(homedir(), '.codara', CONFIG_FILE);
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as GatewayConfig;
  } catch {
    return {channels: {}};
  }
}

/** Expand $ENV_VAR references in config values. */
export function expandEnvVars(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? '');
}
```

- [ ] **Step 3: Create Gateway main class**

Create `src/gateway/gateway.ts`:

```typescript
import type {ChannelPlugin} from '@integration/channel/contracts';
import type {InboundMessage, GatewayConfig, StopHandle} from './types';
import {createGatewayRouter, type GatewayRouter} from './router';
import {createGatewaySessionManager, type GatewaySessionManager} from './session-manager';
import {chunkText} from './outbound';
import {createCodaraRuntime} from '@codara/facade';
import {HumanMessage} from '@langchain/core/messages';
import type {Codara} from '@codara/types';

export interface CodaraGatewayOptions {
  config: GatewayConfig;
  createRuntime?: (sessionKey: string) => Promise<Codara>;
  plugins?: ChannelPlugin[];
}

export class CodaraGateway {
  private readonly plugins = new Map<string, ChannelPlugin>();
  private readonly handles = new Map<string, StopHandle>();
  private readonly router: GatewayRouter;
  private readonly sessionManager: GatewaySessionManager;
  private readonly config: GatewayConfig;

  constructor(options: CodaraGatewayOptions) {
    this.config = options.config;
    this.router = createGatewayRouter(options.config);
    this.sessionManager = createGatewaySessionManager({
      createRuntime: options.createRuntime ?? ((key) => createCodaraRuntime({sessionId: key})),
    });
    for (const plugin of options.plugins ?? []) {
      this.plugins.set(plugin.id, plugin);
    }
  }

  registerPlugin(plugin: ChannelPlugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  async start(): Promise<void> {
    for (const [channelId, plugin] of this.plugins) {
      const channelConfig = this.config.channels[channelId];
      if (!channelConfig?.enabled) continue;

      for (const [accountId, accountConfig] of Object.entries(channelConfig.accounts)) {
        const account = plugin.resolveAccount(accountConfig, accountId);
        if (!account) continue;

        const handle = await plugin.startListening({
          account,
          accountId,
          config: accountConfig,
          onMessage: (msg) => this.handleInbound(msg),
        });
        this.handles.set(`${channelId}:${accountId}`, handle);
      }
    }
  }

  async stop(): Promise<void> {
    for (const handle of this.handles.values()) {
      await handle.stop();
    }
    this.handles.clear();
    await this.sessionManager.disposeAll();
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    // 1. Access control
    if (!this.router.isAllowed(msg)) return;

    // 2. @mention check for groups
    if (this.router.requiresMention(msg)) {
      // TODO: Check if bot is mentioned in msg.text
      // For now, allow all (platform-specific mention detection in adapters)
    }

    // 3. Resolve session
    const sessionKey = this.router.buildSessionKey(msg);
    const session = await this.sessionManager.getOrCreate(sessionKey);

    // 4. Get plugin for outbound
    const plugin = this.plugins.get(msg.channel);
    const channelConfig = this.config.channels[msg.channel];
    const accountConfig = channelConfig?.accounts[msg.accountId];
    const account = plugin?.resolveAccount(accountConfig ?? {}, msg.accountId);

    // 5. Send typing indicator
    if (plugin && account) {
      await plugin.sendTyping?.(account, {accountId: msg.accountId, to: msg.peer.id, text: ''});
    }

    // 6. Stream response
    try {
      const stream = session.stream(msg.text);
      let fullResponse = '';

      for await (const chunk of stream) {
        // Accumulate text chunks
        if (chunk && typeof chunk === 'object' && 'content' in chunk) {
          const content = (chunk as {content?: string}).content;
          if (typeof content === 'string') {
            fullResponse += content;
          }
        }
      }

      // 7. Send reply
      if (plugin && account && fullResponse.trim()) {
        const textLimit = plugin.capabilities.textLimit;
        const chunks = chunkText(fullResponse, textLimit);
        for (const text of chunks) {
          await plugin.sendText(account, {
            accountId: msg.accountId,
            to: msg.peer.id,
            text,
            replyToId: msg.messageId,
          });
        }
      }
    } catch (error) {
      // Send error message
      if (plugin && account) {
        await plugin.sendText(account, {
          accountId: msg.accountId,
          to: msg.peer.id,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  getSessionManager(): GatewaySessionManager {
    return this.sessionManager;
  }
}
```

- [ ] **Step 4: Create barrel export**

Create `src/gateway/index.ts`:

```typescript
export {CodaraGateway, type CodaraGatewayOptions} from './gateway';
export {createGatewayRouter, type GatewayRouter} from './router';
export {createGatewaySessionManager, type GatewaySessionManager} from './session-manager';
export {loadGatewayConfig, expandEnvVars} from './config';
export {chunkText} from './outbound';
export * from './types';
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(gateway): Gateway 核心 — 入站处理 + 出站分片 + 配置加载"
```

---

## Chunk 3: Telegram Adapter

### Task 5: Telegram Bot API Client

**Files:**
- Create: `src/integration/channel/telegram/api.ts`
- Create: `src/integration/channel/telegram/types.ts`
- Test: `tests/unit/channel/telegram/api.test.ts`

Reference: `tmp/openclaw/extensions/telegram/src/send.ts` and `src/api-fetch.ts`

- [ ] **Step 1: Create Telegram types**

Create `src/integration/channel/telegram/types.ts`:

```typescript
/** Telegram Bot API types (subset needed for Codara). */

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {id: number; type: 'private' | 'group' | 'supergroup' | 'channel'; title?: string};
  from?: {id: number; is_bot: boolean; first_name: string; username?: string};
  text?: string;
  caption?: string;
  photo?: {file_id: string; width: number; height: number}[];
  document?: {file_id: string; file_name?: string; mime_type?: string};
  reply_to_message?: TelegramMessage;
  media_group_id?: string;
  entities?: {type: string; offset: number; length: number}[];
}

export interface TelegramCallbackQuery {
  id: string;
  from: {id: number; first_name: string; username?: string};
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramSendResult {
  ok: boolean;
  result?: {message_id: number; chat: {id: number}};
}

export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export type TelegramInlineKeyboard = TelegramInlineKeyboardButton[][];

export interface TelegramAccountConfig {
  botToken: string;
  allowUsers?: string[];
  allowGroups?: string[];
  groupPolicy?: {requireMention?: boolean};
  pollingTimeout?: number;
}
```

- [ ] **Step 2: Create Telegram API client**

Create `src/integration/channel/telegram/api.ts`:

Reference: OpenClaw `tmp/openclaw/extensions/telegram/src/send.ts` for API patterns.

```typescript
import type {TelegramSendResult, TelegramUpdate, TelegramInlineKeyboard} from './types';

const BASE_URL = 'https://api.telegram.org/bot';

export class TelegramApi {
  constructor(private readonly token: string) {}

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const url = `${BASE_URL}${this.token}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: params ? JSON.stringify(params) : undefined,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram API ${method} failed (${res.status}): ${body}`);
    }
    return res.json() as T;
  }

  async getUpdates(offset?: number, timeout = 30): Promise<TelegramUpdate[]> {
    const result = await this.call<{ok: boolean; result: TelegramUpdate[]}>('getUpdates', {
      offset,
      timeout,
      limit: 100,
      allowed_updates: ['message', 'callback_query'],
    });
    return result.result;
  }

  async sendMessage(chatId: number | string, text: string, options?: {
    parse_mode?: 'HTML' | 'Markdown';
    reply_to_message_id?: number;
    reply_markup?: {inline_keyboard: TelegramInlineKeyboard};
  }): Promise<TelegramSendResult> {
    return this.call<TelegramSendResult>('sendMessage', {
      chat_id: chatId,
      text,
      ...options,
    });
  }

  async sendChatAction(chatId: number | string, action = 'typing'): Promise<void> {
    await this.call('sendChatAction', {chat_id: chatId, action});
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', {callback_query_id: callbackQueryId, text});
  }

  async deleteWebhook(): Promise<void> {
    await this.call('deleteWebhook', {drop_pending_updates: false});
  }
}
```

- [ ] **Step 3: Write API tests (mock fetch)**
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(telegram): Bot API 客户端 — getUpdates + sendMessage + typing"
```

### Task 6: Telegram Polling + Plugin

**Files:**
- Create: `src/integration/channel/telegram/polling.ts`
- Create: `src/integration/channel/telegram/plugin.ts`
- Create: `src/integration/channel/telegram/index.ts`
- Test: `tests/unit/channel/telegram/polling.test.ts`
- Test: `tests/unit/channel/telegram/plugin.test.ts`

Reference: OpenClaw `tmp/openclaw/extensions/telegram/src/polling-session.ts` and `src/bot-handlers.runtime.ts`

- [ ] **Step 1: Create polling loop**

Create `src/integration/channel/telegram/polling.ts`:

```typescript
import {TelegramApi} from './api';
import type {TelegramUpdate, TelegramMessage} from './types';
import type {InboundMessage, StopHandle} from '@gateway/types';

export interface TelegramPollingOptions {
  api: TelegramApi;
  accountId: string;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onCallbackQuery?: (queryId: string, data: string, chatId: number, messageId: number) => Promise<void>;
  pollingTimeout?: number;
}

export function startTelegramPolling(options: TelegramPollingOptions): StopHandle {
  const {api, accountId, onMessage, onCallbackQuery, pollingTimeout = 30} = options;
  let offset: number | undefined;
  let running = true;

  const loop = async () => {
    // Clear any existing webhook first
    try { await api.deleteWebhook(); } catch { /* ignore */ }

    while (running) {
      try {
        const updates = await api.getUpdates(offset, pollingTimeout);
        for (const update of updates) {
          offset = update.update_id + 1;
          if (update.message) {
            const msg = normalizeTelegramMessage(update.message, accountId);
            if (msg) await onMessage(msg);
          }
          if (update.callback_query?.data && onCallbackQuery) {
            const q = update.callback_query;
            await onCallbackQuery(
              q.id,
              q.data,
              q.message?.chat.id ?? 0,
              q.message?.message_id ?? 0,
            );
            await api.answerCallbackQuery(q.id);
          }
        }
      } catch (error) {
        if (!running) break;
        console.error('[Telegram] Polling error, retrying in 5s:', error);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };

  // Start polling in background
  const loopPromise = loop();

  return {
    async stop() {
      running = false;
      await loopPromise.catch(() => {});
    },
  };
}

function normalizeTelegramMessage(msg: TelegramMessage, accountId: string): InboundMessage | null {
  const text = msg.text ?? msg.caption;
  if (!text || !msg.from) return null;

  return {
    channel: 'telegram',
    accountId,
    messageId: String(msg.message_id),
    sender: {
      id: String(msg.from.id),
      name: msg.from.first_name,
      username: msg.from.username,
    },
    peer: {
      kind: msg.chat.type === 'private' ? 'direct' : 'group',
      id: String(msg.chat.id),
      name: msg.chat.title,
    },
    text,
    timestamp: msg.date * 1000,
    raw: msg,
  };
}
```

- [ ] **Step 2: Create Telegram plugin**

Create `src/integration/channel/telegram/plugin.ts`:

```typescript
import {z} from 'zod';
import {TelegramApi} from './api';
import {startTelegramPolling} from './polling';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {OutboundContext, PausePromptContext, SendResult} from '@gateway/types';
import type {TelegramAccountConfig, TelegramInlineKeyboard} from './types';

const telegramConfigSchema = z.object({
  botToken: z.string().min(1),
  allowUsers: z.array(z.string()).optional(),
  allowGroups: z.array(z.string()).optional(),
  groupPolicy: z.object({requireMention: z.boolean().optional()}).optional(),
  pollingTimeout: z.number().optional(),
});

interface TelegramAccount {
  token: string;
  api: TelegramApi;
  config: TelegramAccountConfig;
}

export const telegramPlugin: ChannelPlugin<TelegramAccount> = {
  id: 'telegram',
  name: 'Telegram',
  capabilities: {
    chatTypes: ['direct', 'group'],
    streaming: true,
    threads: false,
    media: true,
    reactions: true,
    textLimit: 4096,
  },

  configSchema: telegramConfigSchema,

  resolveAccount(config, _accountId) {
    const parsed = telegramConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;
    const token = parsed.data.botToken.startsWith('$')
      ? (process.env[parsed.data.botToken.slice(1)] ?? '')
      : parsed.data.botToken;
    if (!token) return undefined;
    return {token, api: new TelegramApi(token), config: parsed.data};
  },

  async startListening(ctx: GatewayListenContext<TelegramAccount>) {
    const pendingPauses = new Map<string, (data: string) => void>();

    return startTelegramPolling({
      api: ctx.account.api,
      accountId: ctx.accountId,
      onMessage: ctx.onMessage,
      onCallbackQuery: async (queryId, data, _chatId, _messageId) => {
        // Check if this is a pause response
        const resolver = pendingPauses.get(data.split(':')[1] ?? '');
        if (resolver) {
          resolver(data);
        }
        if (ctx.onPauseResponse) {
          ctx.onPauseResponse(data.split(':')[1] ?? '', data);
        }
      },
      pollingTimeout: ctx.account.config.pollingTimeout,
    });
  },

  async sendText(account, ctx: OutboundContext): Promise<SendResult> {
    try {
      const result = await account.api.sendMessage(ctx.to, ctx.text, {
        parse_mode: 'HTML',
        ...(ctx.replyToId ? {reply_to_message_id: Number(ctx.replyToId)} : {}),
      });
      return {ok: true, messageId: String(result.result?.message_id)};
    } catch (error) {
      // Fallback: try without HTML parse mode
      try {
        const result = await account.api.sendMessage(ctx.to, ctx.text, {
          ...(ctx.replyToId ? {reply_to_message_id: Number(ctx.replyToId)} : {}),
        });
        return {ok: true, messageId: String(result.result?.message_id)};
      } catch (fallbackError) {
        return {ok: false, error: String(fallbackError)};
      }
    }
  },

  async sendTyping(account, ctx: OutboundContext): Promise<void> {
    try {
      await account.api.sendChatAction(ctx.to, 'typing');
    } catch { /* best-effort */ }
  },

  async sendPausePrompt(account, ctx: PausePromptContext): Promise<SendResult> {
    const keyboard: TelegramInlineKeyboard = [
      ctx.actions.map((action) => ({
        text: action.label,
        callback_data: `pause:${ctx.pause.id}:${action.id}`,
      })),
    ];

    try {
      const result = await account.api.sendMessage(ctx.to, ctx.text, {
        parse_mode: 'HTML',
        reply_markup: {inline_keyboard: keyboard},
      });
      return {ok: true, messageId: String(result.result?.message_id)};
    } catch (error) {
      return {ok: false, error: String(error)};
    }
  },
};
```

- [ ] **Step 3: Create barrel export**

Create `src/integration/channel/telegram/index.ts`:

```typescript
export {telegramPlugin} from './plugin';
export {TelegramApi} from './api';
export {startTelegramPolling} from './polling';
export type {TelegramAccountConfig} from './types';
```

- [ ] **Step 4: Write tests**
- [ ] **Step 5: Run all tests**

```bash
bun test
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(telegram): Telegram 适配器 — 长轮询 + 消息发送 + HIL 按钮"
```

---

## Chunk 4: Integration + Gateway Entry Point

### Task 7: Update Channel Registry + Wire Gateway

**Files:**
- Modify: `src/integration/channel/registry.ts`
- Modify: `src/integration/channel/index.ts`
- Create: `src/gateway/main.ts` (gateway entry point)

- [ ] **Step 1: Update channel index to export new contracts**

Modify `src/integration/channel/index.ts`:

```typescript
export {ChannelRegistry} from './registry';
export {createChannelHILOptions} from './hil-adapter';
export type {ChannelPlugin, ChannelPluginCapabilities, GatewayListenContext} from './contracts';
export {telegramPlugin} from './telegram';
```

- [ ] **Step 2: Create gateway entry point**

Create `src/gateway/main.ts`:

```typescript
import {CodaraGateway} from './gateway';
import {loadGatewayConfig} from './config';
import {telegramPlugin} from '@integration/channel/telegram';

export async function startGateway(configPath?: string): Promise<CodaraGateway> {
  const config = await loadGatewayConfig(configPath);

  const gateway = new CodaraGateway({
    config,
    plugins: [telegramPlugin],
  });

  await gateway.start();

  console.log(`[Gateway] Started with ${gateway.getSessionManager().activeCount()} active sessions`);
  console.log(`[Gateway] Listening on channels: ${Object.keys(config.channels).filter((c) => config.channels[c].enabled).join(', ') || 'none'}`);

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('[Gateway] Shutting down...');
    await gateway.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return gateway;
}

// Direct execution: bun run src/gateway/main.ts
if (import.meta.main) {
  startGateway().catch((error) => {
    console.error('[Gateway] Fatal error:', error);
    process.exit(1);
  });
}
```

- [ ] **Step 3: Add dev script to package.json**

Add to `scripts`:
```json
"dev:gateway": "bun run --watch src/gateway/main.ts"
```

- [ ] **Step 4: Run full test suite**

```bash
bun test
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(gateway): Gateway 入口 + Telegram 集成 + dev:gateway 脚本"
```

### Task 8: Update Architecture Doc

**Files:**
- Modify: `docs/architecture-next/01-global-architecture-overview.md`

- [ ] **Step 1: Add gateway to architecture doc**

Add `gateway/` to the directory tree in Section 4. Add it to the bounded context list in Section 2. Update the DDD layer mapping in Section 5 — gateway is Presentation layer alongside cli/desktop/server.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "docs: 架构文档增加 Gateway 限界上下文"
```

### Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
bun test
```
Expected: All existing tests pass + new gateway/telegram tests pass

- [ ] **Step 2: Verify no import issues**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit and push**

```bash
git push -u origin feature/lordfoxfairy/multi-channel-gateway
```

---

## Parallelization Strategy

```
Task 1 (contracts) ───────── sequential, foundation
         │
         ├── Task 2 (router)          ─┐
         ├── Task 3 (session manager)  ├── parallel
         └── Task 4 (gateway core)    ─┘
                    │
         ├── Task 5 (telegram api)    ─┐
         └── Task 6 (telegram plugin)  ├── sequential (6 depends on 5)
                    │                  ─┘
         Task 7 (integration)  ─── sequential
         Task 8 (docs)         ─── parallel with Task 7
         Task 9 (verification) ─── last
```
