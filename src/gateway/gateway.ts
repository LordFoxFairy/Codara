/**
 * @module gateway
 *
 * IM message gateway — connects Codara to external messaging platforms
 * (Telegram, Discord, Slack, DingTalk, Feishu, WeCom, QQ).
 *
 * Inbound message pipeline:
 *   1. receive  — ChannelPlugin.onMessage → debouncer
 *   2. validate — router.isAllowed + requiresMention
 *   3. route    — resolve plugin, account, profile, bridge
 *   4. process  — session.stream / session.invoke
 *   5. respond  — chunkMarkdown → plugin.sendText
 */

import type {ChannelPlugin} from '@channels/contracts';
import type {ChannelType} from '@shared/channel-types';
import type {GatewayConfig, InboundMessage, StopHandle} from './types';
import type {GatewaySessionFactory, GatewaySession} from './session-manager';
import type {DebouncedHandler} from './debounce';
import {createGatewayRouter} from './router';
import {createGatewaySessionManager} from './session-manager';
import {chunkMarkdown} from './outbound';
import {createDebouncedHandler} from './debounce';
import {GatewayChannelBridge} from './channel-bridge';
import {ChannelRegistry} from '@channels/registry';

export interface GatewayOptions {
  config: GatewayConfig;
  plugins: ChannelPlugin[];
  createSession: GatewaySessionFactory;
  maxSessions?: number;
  /** Pre-created ChannelRegistry. If omitted, a new one is created. */
  channelRegistry?: ChannelRegistry;
  /** Called when the debounced handler fails. If omitted, errors are logged to stderr. */
  onError?: (err: unknown, msg: InboundMessage) => void;
}

/**
 * Gateway orchestrator — manages channel plugins, routing, session lifecycle,
 * and message debouncing for all connected IM platforms.
 */
export class Gateway {
  private readonly config: GatewayConfig;
  private readonly plugins: Map<string, ChannelPlugin>;
  private readonly router;
  private readonly sessionManager;
  private readonly stopHandles: StopHandle[] = [];
  private readonly accounts = new Map<string, unknown>();
  private readonly channelRegistry: ChannelRegistry;
  private readonly bridges = new Map<string, GatewayChannelBridge>();
  private readonly onError: (err: unknown, msg: InboundMessage) => void;
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
    this.onError = options.onError ?? ((err) => {
      console.error('[Gateway] Unhandled debounce error:', err);
    });
  }

  /** Expose the ChannelRegistry so callers can pass it to session creation. */
  getChannelRegistry(): ChannelRegistry {
    return this.channelRegistry;
  }

  async start(): Promise<void> {
    this.debouncer = createDebouncedHandler(
      (msg) => this.handleInbound(msg),
      undefined,
      (err, msg) => this.onError(err, msg),
    );

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
          onMessage: async (msg) => { debouncer.add(msg); },
          onReviewResponse: (reviewId, payload) => this.handleReviewResponse(reviewId, payload),
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

  // ── Inbound Pipeline ────────────────────────────────────────────────

  /**
   * Full inbound pipeline: validate → route → process → respond.
   * Each step is a small focused method; failures send an error reply.
   */
  async handleInbound(msg: InboundMessage): Promise<void> {
    // Step 1: Validate — check channel access and mention requirements.
    const plugin = this.plugins.get(msg.channel);
    if (!plugin) return;
    if (!this.router.isAllowed(msg)) return;
    if (this.router.requiresMention(msg) && !msg.isMentioned) return;

    // Step 2: Route — resolve account, profile, and bridge.
    const routed = this.resolveRoute(plugin, msg);
    if (!routed) return;

    try {
      // Step 3: Process — get/create session and generate response.
      const response = await this.processMessage(routed, msg);

      // Step 4: Respond — chunk and send.
      await this.sendResponse(routed, msg, response);
    } catch (err) {
      await this.sendError(routed, msg, err);
    }
  }

  /** Resolve plugin, account, profile, and bridge for a validated message. */
  private resolveRoute(plugin: ChannelPlugin, msg: InboundMessage): ResolvedRoute | undefined {
    const profile = this.router.resolveProfile(msg);
    const account = this.accounts.get(`${msg.channel}:${msg.accountId}`);
    if (!account) return undefined;

    this.getOrCreateBridge(plugin, account, msg);

    return {plugin, account, profile};
  }

  /** Get or create session, send typing, and invoke/stream the agent. */
  private async processMessage(route: ResolvedRoute, msg: InboundMessage): Promise<string> {
    const {plugin, account, profile} = route;
    const {session} = await this.sessionManager.getOrCreate(msg, profile);

    this.sendTypingIndicator(plugin, account, msg);

    // Prefer streaming (all sessions implement it); fall back to invoke only
    // if a future session type makes stream optional.
    return await this.streamResponse(plugin, account, msg, session);
  }

  /** Stream response with periodic typing indicators. */
  private async streamResponse(
    plugin: ChannelPlugin,
    account: unknown,
    msg: InboundMessage,
    session: GatewaySession,
  ): Promise<string> {
    let fullResponse = '';
    const typingInterval = plugin.sendTyping
      ? setInterval(() => { this.sendTypingIndicator(plugin, account, msg); }, 5000)
      : undefined;

    try {
      for await (const chunk of session.stream(msg.text)) {
        fullResponse += chunk;
      }
    } finally {
      if (typingInterval) clearInterval(typingInterval);
    }
    return fullResponse;
  }

  /** Chunk markdown and send each chunk as a reply. */
  private async sendResponse(route: ResolvedRoute, msg: InboundMessage, response: string): Promise<void> {
    const chunks = chunkMarkdown(response, {limit: route.plugin.capabilities.textLimit});

    for (const chunk of chunks) {
      await route.plugin.sendText(route.account, {
        accountId: msg.accountId,
        to: msg.peer.id,
        text: chunk,
        replyToId: msg.messageId,
        threadId: msg.threadId,
      });
    }
  }

  /** Send an error reply to the user. */
  private async sendError(route: ResolvedRoute, msg: InboundMessage, err: unknown): Promise<void> {
    const errorText = err instanceof Error ? err.message : 'Internal error';
    await route.plugin
      .sendText(route.account, {
        accountId: msg.accountId,
        to: msg.peer.id,
        text: `[Error] ${errorText}`,
        replyToId: msg.messageId,
        threadId: msg.threadId,
      })
      .catch(() => {});
  }

  /** Fire-and-forget typing indicator. */
  private sendTypingIndicator(plugin: ChannelPlugin, account: unknown, msg: InboundMessage): void {
    if (plugin.sendTyping) {
      plugin.sendTyping(account, {accountId: msg.accountId, to: msg.peer.id, text: '', threadId: msg.threadId}).catch(() => {});
    }
  }

  // ── Review Responses ────────────────────────────────────────────────

  /**
   * Handle a review response from a plugin callback (e.g., InlineKeyboard button click).
   * Iterates all bridges to find the one holding the pending review.
   */
  handleReviewResponse(reviewId: string, payload: unknown): boolean {
    const decision = typeof payload === 'string' ? payload : (payload as {decision?: string})?.decision ?? 'reject';

    for (const bridge of this.bridges.values()) {
      if (bridge.handleReviewResponse(reviewId, decision)) {
        return true;
      }
    }
    return false;
  }

  // ── Bridge Management ───────────────────────────────────────────────

  /** Get or create a bridge for a conversation, registering it with the ChannelRegistry. */
  private getOrCreateBridge(plugin: ChannelPlugin, account: unknown, msg: InboundMessage): GatewayChannelBridge {
    const bridgeKey = `${msg.channel}:${msg.accountId}:${msg.peer.id}`;
    let bridge = this.bridges.get(bridgeKey);
    if (!bridge) {
      bridge = new GatewayChannelBridge(plugin, account, msg.peer.id, msg.accountId, msg.channel as ChannelType);
      this.bridges.set(bridgeKey, bridge);

      if (!this.channelRegistry.get(bridge.id)) {
        this.channelRegistry.register(bridge);
      }
    }
    return bridge;
  }
}

// ── Internal Types ────────────────────────────────────────────────────

interface ResolvedRoute {
  plugin: ChannelPlugin;
  account: unknown;
  profile: string | undefined;
}
