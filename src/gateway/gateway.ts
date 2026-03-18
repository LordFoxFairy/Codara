import type {ChannelPlugin} from '@integration/channel/contracts';
import type {ChannelType} from '@shared/contracts/channel';
import type {GatewayConfig, InboundMessage, StopHandle} from './types';
import type {GatewaySessionFactory} from './session-manager';
import type {DebouncedHandler} from './debounce';
import {createGatewayRouter} from './router';
import {createGatewaySessionManager} from './session-manager';
import {chunkMarkdown} from './outbound';
import {createDebouncedHandler} from './debounce';
import {GatewayChannelBridge} from './channel-bridge';
import {ChannelRegistry} from '@integration/channel/registry';

export interface GatewayOptions {
  config: GatewayConfig;
  plugins: ChannelPlugin[];
  createSession: GatewaySessionFactory;
  maxSessions?: number;
  /** Optional pre-created ChannelRegistry. If not provided, one will be created. */
  channelRegistry?: ChannelRegistry;
}

export class Gateway {
  private readonly config: GatewayConfig;
  private readonly plugins: Map<string, ChannelPlugin>;
  private readonly router;
  private readonly sessionManager;
  private readonly stopHandles: StopHandle[] = [];
  private readonly accounts = new Map<string, unknown>();
  private readonly channelRegistry: ChannelRegistry;
  private readonly bridges = new Map<string, GatewayChannelBridge>();
  private debouncer?: DebouncedHandler;

  constructor(options: GatewayOptions) {
    this.config = options.config;
    this.plugins = new Map(options.plugins.map((p) => [p.id, p]));
    this.router = createGatewayRouter(options.config);
    this.sessionManager = createGatewaySessionManager({
      createSession: options.createSession,
      sessionConfig: {
        ...options.config.session,
        maxSessions: options.maxSessions ?? options.config.session?.maxSessions,
      },
    });
    this.channelRegistry = options.channelRegistry ?? new ChannelRegistry();
  }

  /** Expose the ChannelRegistry so callers can pass it to session creation. */
  getChannelRegistry(): ChannelRegistry {
    return this.channelRegistry;
  }

  async start(): Promise<void> {
    this.debouncer = createDebouncedHandler((msg) => this.handleInbound(msg));

    for (const [channelId, channelConfig] of Object.entries(this.config.channels)) {
      if (!channelConfig.enabled) continue;
      const plugin = this.plugins.get(channelId);
      if (!plugin) continue;

      for (const [accountId, accountConfig] of Object.entries(channelConfig.accounts)) {
        const account = plugin.resolveAccount(accountConfig, accountId);
        if (!account) continue;

        this.accounts.set(`${channelId}:${accountId}`, account);

        const debouncer = this.debouncer;
        const handle = await plugin.startListening({
          account,
          accountId,
          config: accountConfig,
          onMessage: (msg) => debouncer.add(msg),
          onPauseResponse: (pauseId, payload) => this.handlePauseResponse(pauseId, payload),
        });
        this.stopHandles.push(handle);
      }
    }
  }

  async stop(): Promise<void> {
    this.debouncer?.dispose();
    this.debouncer = undefined;
    await Promise.allSettled(this.stopHandles.map((h) => h.stop()));
    this.stopHandles.length = 0;
    await this.sessionManager.disposeAll();
    await this.channelRegistry.disposeAll();
    this.bridges.clear();
  }

  async handleInbound(msg: InboundMessage): Promise<void> {
    const plugin = this.plugins.get(msg.channel);
    if (!plugin) return;

    if (!this.router.isAllowed(msg)) return;
    if (this.router.requiresMention(msg)) return;

    const profile = this.router.resolveProfile(msg);
    const account = this.accounts.get(`${msg.channel}:${msg.accountId}`);
    if (!account) return;

    // Ensure a GatewayChannelBridge exists for this conversation
    const bridge = this.getOrCreateBridge(plugin, account, msg);

    try {
      const {session} = await this.sessionManager.getOrCreate(msg, profile);

      if (plugin.sendTyping) {
        plugin.sendTyping(account, {accountId: msg.accountId, to: msg.peer.id, text: ''}).catch(() => {});
      }

      let response: string;

      if (session.stream) {
        // Prefer streaming: accumulate full response while sending periodic typing indicators
        let fullResponse = '';
        const typingInterval = plugin.sendTyping
          ? setInterval(() => {
            plugin.sendTyping!(account, {accountId: msg.accountId, to: msg.peer.id, text: ''}).catch(() => {});
          }, 5000)
          : undefined;

        try {
          for await (const chunk of session.stream(msg.text)) {
            fullResponse += chunk;
          }
        } finally {
          if (typingInterval) clearInterval(typingInterval);
        }
        response = fullResponse;
      } else {
        // Fallback to invoke
        response = await session.invoke(msg.text);
      }

      const chunks = chunkMarkdown(response, {limit: plugin.capabilities.textLimit});

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

  /**
   * Handle a pause response from a plugin callback (e.g., InlineKeyboard button click).
   * Iterates all bridges to find the one holding the pending pause.
   */
  handlePauseResponse(pauseId: string, payload: unknown): boolean {
    const decision = typeof payload === 'string' ? payload : (payload as {decision?: string})?.decision ?? 'reject';

    for (const bridge of this.bridges.values()) {
      if (bridge.handlePauseResponse(pauseId, decision)) {
        return true;
      }
    }
    return false;
  }

  /** Get or create a bridge for a conversation, registering it with the ChannelRegistry. */
  private getOrCreateBridge(plugin: ChannelPlugin, account: unknown, msg: InboundMessage): GatewayChannelBridge {
    const bridgeKey = `${msg.channel}:${msg.accountId}:${msg.peer.id}`;
    let bridge = this.bridges.get(bridgeKey);
    if (!bridge) {
      bridge = new GatewayChannelBridge(plugin, account, msg.peer.id, msg.accountId, msg.channel as ChannelType);
      this.bridges.set(bridgeKey, bridge);

      // Register with the ChannelRegistry so HIL middleware can route pauses
      if (!this.channelRegistry.get(bridge.id)) {
        this.channelRegistry.register(bridge);
      }
    }
    return bridge;
  }
}
