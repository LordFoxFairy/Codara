import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {InboundMessage, OutboundContext, ReviewPromptContext, SendResult, StopHandle} from '@gateway/types';
import {DiscordApi} from './api';
import {DiscordGatewayClient} from './gateway-ws';
import type {DiscordMessage, DiscordInteraction, DiscordActionRow} from './types';
import {ButtonStyle, ComponentType, InteractionCallbackType, InteractionType} from './types';

// ── Account ────────────────────────────────────────────────────────────

/** Resolved account — ready for use after config parsing. */
export interface DiscordAccount {
  botToken: string;
  api: DiscordApi;
  allowGuilds?: string[];
  allowChannels?: string[];
}

// ── Config Schema ──────────────────────────────────────────────────────

const discordAccountConfigSchema = z.object({
  botToken: z.string().min(1, 'botToken is required'),
  allowGuilds: z.array(z.string()).optional(),
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
 * Normalize a Discord MESSAGE_CREATE event into Codara's InboundMessage format.
 */
export function normalizeDiscordMessage(msg: DiscordMessage, accountId: string): InboundMessage {
  const peerKind: 'direct' | 'group' | 'channel' = msg.guild_id ? 'group' : 'direct';

  return {
    channel: 'discord',
    accountId,
    messageId: msg.id,
    sender: {
      id: msg.author.id,
      name: msg.author.username,
      username: msg.author.username,
    },
    peer: {
      kind: peerKind,
      id: msg.channel_id,
      name: undefined,
    },
    text: msg.content,
    replyToId: msg.referenced_message?.id,
    timestamp: new Date(msg.timestamp).getTime(),
    raw: msg,
  };
}

// ── Plugin ─────────────────────────────────────────────────────────────

export const discordPlugin: ChannelPlugin<DiscordAccount> = {
  id: 'discord',
  name: 'Discord',

  capabilities: {
    chatTypes: ['direct', 'group'],
    streaming: false,
    threads: true,
    media: true,
    reactions: true,
    textLimit: 2000,
  },

  configSchema: discordAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): DiscordAccount | undefined {
    const parsed = discordAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const token = resolveEnvValue(data.botToken);
    return {
      botToken: token,
      api: new DiscordApi(token),
      allowGuilds: data.allowGuilds,
      allowChannels: data.allowChannels,
    };
  },

  async startListening(ctx: GatewayListenContext<DiscordAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onReviewResponse} = ctx;

    const gateway = new DiscordGatewayClient({
      botToken: account.botToken,

      onMessageCreate(message: DiscordMessage) {
        // Access control
        if (account.allowGuilds && message.guild_id && !account.allowGuilds.includes(message.guild_id)) {
          return;
        }
        if (account.allowChannels && !account.allowChannels.includes(message.channel_id)) {
          return;
        }

        const inbound = normalizeDiscordMessage(message, accountId);
        if (inbound.text) {
          onMessage(inbound).catch((err) => {
            console.error('[discord] Error processing message:', err);
          });
        }
      },

      onInteractionCreate(interaction: DiscordInteraction) {
        // Handle button clicks (MESSAGE_COMPONENT interactions)
        if (interaction.type !== InteractionType.MESSAGE_COMPONENT) return;
        if (!interaction.data?.custom_id) return;

        // ACK the interaction immediately (DEFERRED_UPDATE_MESSAGE)
        account.api
          .createInteractionResponse(interaction.id, interaction.token, InteractionCallbackType.DEFERRED_UPDATE_MESSAGE)
          .catch(() => {});

        // Parse custom_id: `{actionId}:{reviewId}`
        const customId = interaction.data.custom_id;
        const colonIndex = customId.indexOf(':');
        if (colonIndex === -1 || !onReviewResponse) return;

        const actionId = customId.slice(0, colonIndex);
        const reviewId = customId.slice(colonIndex + 1);
        const userId = interaction.member?.user?.id ?? interaction.user?.id ?? 'unknown';
        onReviewResponse(reviewId, {actionId, from: {id: userId}});
      },
    });

    await gateway.connect();

    return {
      async stop() {
        await gateway.disconnect();
      },
    };
  },

  async sendText(account: DiscordAccount, ctx: OutboundContext): Promise<SendResult> {
    try {
      const result = await account.api.sendMessage(ctx.to, ctx.text);
      return {ok: true, messageId: result.id};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  async sendTyping(account: DiscordAccount, ctx: OutboundContext): Promise<void> {
    await account.api.triggerTyping(ctx.to);
  },

  async sendReviewPrompt(account: DiscordAccount, ctx: ReviewPromptContext): Promise<SendResult> {
    const buttonType = ComponentType.BUTTON;
    const buttons = ctx.actions.map((a) => ({
      type: buttonType,
      style: a.style === 'approve' ? ButtonStyle.SUCCESS : a.style === 'reject' ? ButtonStyle.DANGER : ButtonStyle.SECONDARY,
      label: a.label,
      custom_id: `${a.id}:${ctx.review.id}`,
    }));

    const actionRowType = ComponentType.ACTION_ROW;
    const components: DiscordActionRow[] = [
      {type: actionRowType, components: buttons},
    ];

    try {
      const result = await account.api.sendMessage(ctx.to, ctx.text, {components});
      return {ok: true, messageId: result.id};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },
};
