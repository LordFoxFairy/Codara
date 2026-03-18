import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {InboundMessage, OutboundContext, PausePromptContext, SendResult, StopHandle} from '@gateway/types';
import {SlackApi} from './api';
import {SlackSocketModeClient} from './socket-mode';
import type {SlackAccountConfig, SlackBlock, SlackMessageEvent, SlackInteractivePayload} from './types';

// ── Account ────────────────────────────────────────────────────────────

/** Resolved account — ready for use after config parsing. */
export interface SlackAccount {
  botToken: string;
  appToken: string;
  api: SlackApi;
  allowUsers?: string[];
  allowChannels?: string[];
}

// ── Config Schema ──────────────────────────────────────────────────────

const slackAccountConfigSchema = z.object({
  botToken: z.string().min(1, 'botToken is required'),
  appToken: z.string().min(1, 'appToken is required'),
  allowUsers: z.array(z.string()).optional(),
  allowChannels: z.array(z.string()).optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Resolve `$ENV_VAR` syntax. If value starts with `$`, read from env.
 */
function resolveEnvValue(value: string): string {
  if (value.startsWith('$')) {
    const envKey = value.slice(1);
    const envValue = process.env[envKey];
    if (!envValue) {
      throw new Error(`Environment variable "${envKey}" is not set (referenced as "${value}")`);
    }
    return envValue;
  }
  return value;
}

// ── Normalize ──────────────────────────────────────────────────────────

/**
 * Normalize a Slack message event into Codara's InboundMessage format.
 */
export function normalizeSlackMessage(event: SlackMessageEvent, accountId: string): InboundMessage {
  // Slack channels starting with "D" are DMs, "C"/"G" are channels/groups
  const channelId = event.channel;
  const peerKind: 'direct' | 'group' = channelId.startsWith('D') ? 'direct' : 'group';

  return {
    channel: 'slack',
    accountId,
    messageId: event.ts,
    sender: {
      id: event.user,
    },
    peer: {
      kind: peerKind,
      id: channelId,
    },
    text: event.text,
    threadId: event.thread_ts,
    timestamp: Math.floor(parseFloat(event.ts) * 1000),
    raw: event,
  };
}

// ── Plugin ─────────────────────────────────────────────────────────────

export const slackPlugin: ChannelPlugin<SlackAccount> = {
  id: 'slack',
  name: 'Slack',

  capabilities: {
    chatTypes: ['direct', 'group', 'channel'],
    streaming: false,
    threads: true,
    media: true,
    reactions: true,
    textLimit: 40000,
  },

  configSchema: slackAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): SlackAccount | undefined {
    const parsed = slackAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const botToken = resolveEnvValue(data.botToken);
    const appToken = resolveEnvValue(data.appToken);
    return {
      botToken,
      appToken,
      api: new SlackApi(botToken),
      allowUsers: data.allowUsers,
      allowChannels: data.allowChannels,
    };
  },

  async startListening(ctx: GatewayListenContext<SlackAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onPauseResponse} = ctx;

    const socketMode = new SlackSocketModeClient({
      appToken: account.appToken,

      onMessage(event: SlackMessageEvent) {
        // Access control
        if (account.allowUsers && !account.allowUsers.includes(event.user)) {
          return;
        }
        if (account.allowChannels && !account.allowChannels.includes(event.channel)) {
          return;
        }

        const inbound = normalizeSlackMessage(event, accountId);
        if (inbound.text) {
          onMessage(inbound).catch((err) => {
            console.error('[slack] Error processing message:', err);
          });
        }
      },

      onInteraction(payload: SlackInteractivePayload) {
        if (!onPauseResponse) return;
        if (payload.type !== 'block_actions' || !payload.actions.length) return;

        const action = payload.actions[0];
        const actionId = action.action_id;

        // Parse action_id: `{actionId}:{pauseId}`
        const colonIndex = actionId.indexOf(':');
        if (colonIndex === -1) return;

        const parsedActionId = actionId.slice(0, colonIndex);
        const pauseId = actionId.slice(colonIndex + 1);
        const userId = payload.user?.id ?? 'unknown';
        onPauseResponse(pauseId, {actionId: parsedActionId, from: {id: userId}});
      },
    });

    await socketMode.connect();

    return {
      async stop() {
        await socketMode.disconnect();
      },
    };
  },

  async sendText(account: SlackAccount, ctx: OutboundContext): Promise<SendResult> {
    try {
      const result = await account.api.postMessage(ctx.to, ctx.text, {
        thread_ts: ctx.threadId,
      });
      return {ok: true, messageId: result.ts};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  // Slack doesn't have a dedicated "typing" API for bots
  async sendTyping(_account: SlackAccount, _ctx: OutboundContext): Promise<void> {
    // No-op: Slack doesn't expose typing indicators for bot users
  },

  async sendPausePrompt(account: SlackAccount, ctx: PausePromptContext): Promise<SendResult> {
    const buttons = ctx.actions.map((a) => ({
      type: 'button' as const,
      text: {type: 'plain_text' as const, text: a.label},
      action_id: `${a.id}:${ctx.pause.id}`,
      style: a.style === 'approve' ? ('primary' as const) : a.style === 'reject' ? ('danger' as const) : undefined,
    }));

    const blocks: SlackBlock[] = [
      {type: 'section', text: {type: 'mrkdwn', text: ctx.text}},
      {type: 'actions', elements: buttons},
    ];

    try {
      const result = await account.api.postMessage(ctx.to, ctx.text, {
        thread_ts: ctx.threadId,
        blocks,
      });
      return {ok: true, messageId: result.ts};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },
};
