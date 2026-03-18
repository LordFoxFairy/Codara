import type {ChannelPlugin} from '@integration/channel/contracts';
import type {GatewayConfig, InboundMessage, StopHandle} from './types';
import type {GatewaySessionFactory} from './session-manager';
import {createGatewayRouter} from './router';
import {createGatewaySessionManager} from './session-manager';
import {chunkText} from './outbound';

export interface GatewayOptions {
  config: GatewayConfig;
  plugins: ChannelPlugin[];
  createSession: GatewaySessionFactory;
  maxSessions?: number;
}

export class Gateway {
  private readonly config: GatewayConfig;
  private readonly plugins: Map<string, ChannelPlugin>;
  private readonly router;
  private readonly sessionManager;
  private readonly stopHandles: StopHandle[] = [];
  private readonly accounts = new Map<string, unknown>();

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.plugins = new Map(options.plugins.map((p) => [p.id, p]));
    this.router = createGatewayRouter(options.config);
    this.sessionManager = createGatewaySessionManager({
      createSession: options.createSession,
      maxSessions: options.maxSessions,
    });
  }

  async start(): Promise<void> {
    for (const [channelId, channelConfig] of Object.entries(this.config.channels)) {
      if (!channelConfig.enabled) continue;
      const plugin = this.plugins.get(channelId);
      if (!plugin) continue;

      for (const [accountId, accountConfig] of Object.entries(channelConfig.accounts)) {
        const account = plugin.resolveAccount(accountConfig, accountId);
        if (!account) continue;

        this.accounts.set(`${channelId}:${accountId}`, account);

        const handle = await plugin.startListening({
          account,
          accountId,
          config: accountConfig,
          onMessage: (msg) => this.handleInbound(msg),
        });
        this.stopHandles.push(handle);
      }
    }
  }

  async stop(): Promise<void> {
    await Promise.allSettled(this.stopHandles.map((h) => h.stop()));
    this.stopHandles.length = 0;
    await this.sessionManager.disposeAll();
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const plugin = this.plugins.get(msg.channel);
    if (!plugin) return;

    if (!this.router.isAllowed(msg)) return;
    if (this.router.requiresMention(msg)) return;

    const sessionKey = this.router.buildSessionKey(msg);
    const profile = this.router.resolveProfile(msg);
    const account = this.accounts.get(`${msg.channel}:${msg.accountId}`);
    if (!account) return;

    try {
      const session = await this.sessionManager.getOrCreate(sessionKey, profile);

      if (plugin.sendTyping) {
        plugin.sendTyping(account, {accountId: msg.accountId, to: msg.peer.id, text: ''}).catch(() => {});
      }

      const response = await session.invoke(msg.text);
      const chunks = chunkText(response, plugin.capabilities.textLimit);

      for (const chunk of chunks) {
        await plugin.sendText(account, {
          accountId: msg.accountId,
          to: msg.peer.id,
          text: chunk,
          replyToId: msg.messageId,
        });
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : 'Internal error';
      await plugin
        .sendText(account, {
          accountId: msg.accountId,
          to: msg.peer.id,
          text: `[Error] ${errorText}`,
          replyToId: msg.messageId,
        })
        .catch(() => {});
    }
  }
}
