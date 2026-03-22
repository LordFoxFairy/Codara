import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {OutboundContext, ReviewPromptContext, SendResult, StopHandle} from '@gateway/types';
import {TelegramApi, TelegramApiError} from './api';
import {startTelegramPolling} from './polling';
import type {TelegramCallbackQuery} from './types';

/** Resolved account — ready for use after config parsing. */
export interface TelegramAccount {
  botToken: string;
  api: TelegramApi;
  allowUsers?: string[];
  allowGroups?: string[];
  groupPolicy?: {requireMention?: boolean};
  pollingTimeout?: number;
}

const telegramAccountConfigSchema = z.object({
  botToken: z.string().min(1, 'botToken is required'),
  allowUsers: z.array(z.string()).optional(),
  allowGroups: z.array(z.string()).optional(),
  groupPolicy: z
    .object({requireMention: z.boolean().optional()})
    .optional(),
  pollingTimeout: z.number().int().positive().optional(),
});

/**
 * Resolve `$ENV_VAR` syntax in a string value.
 * If the value starts with `$`, treat the rest as an env variable name.
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

  configSchema: telegramAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): TelegramAccount | undefined {
    const parsed = telegramAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const token = resolveEnvValue(data.botToken);
    return {
      botToken: token,
      api: new TelegramApi(token),
      allowUsers: data.allowUsers,
      allowGroups: data.allowGroups,
      groupPolicy: data.groupPolicy,
      pollingTimeout: data.pollingTimeout,
    };
  },

  async startListening(ctx: GatewayListenContext<TelegramAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onReviewResponse} = ctx;

    const onCallbackQuery = (query: TelegramCallbackQuery) => {
      // Acknowledge the button press
      account.api.answerCallbackQuery(query.id).catch(() => {});

      // Parse review callback data: `review:{reviewId}:{actionId}`
      if (query.data?.startsWith('review:') && onReviewResponse) {
        const parts = query.data.split(':');
        if (parts.length >= 3) {
          const reviewId = parts[1];
          const actionId = parts.slice(2).join(':');
          onReviewResponse(reviewId, {actionId, from: query.from});
        }
      }
    };

    return startTelegramPolling({
      token: account.botToken,
      accountId,
      pollingTimeout: account.pollingTimeout,
      onMessage,
      onCallbackQuery,
    });
  },

  async sendText(account: TelegramAccount, ctx: OutboundContext): Promise<SendResult> {
    try {
      // Try HTML first for rich formatting
      const result = await account.api.sendMessage(ctx.to, ctx.text, {
        parse_mode: 'HTML',
        reply_to_message_id: ctx.replyToId ? Number(ctx.replyToId) : undefined,
      });
      return {ok: true, messageId: String(result.message_id)};
    } catch (err) {
      // If HTML parse fails, fallback to plain text
      if (err instanceof TelegramApiError && err.statusCode === 400) {
        try {
          const result = await account.api.sendMessage(ctx.to, ctx.text, {
            reply_to_message_id: ctx.replyToId ? Number(ctx.replyToId) : undefined,
          });
          return {ok: true, messageId: String(result.message_id)};
        } catch (fallbackErr) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : 'Unknown error';
          return {ok: false, error: msg};
        }
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  async sendTyping(account: TelegramAccount, ctx: OutboundContext): Promise<void> {
    await account.api.sendChatAction(ctx.to, 'typing');
  },

  async sendReviewPrompt(account: TelegramAccount, ctx: ReviewPromptContext): Promise<SendResult> {
    const keyboard = [
        ctx.actions.map((a) => ({
          text: a.label,
          callback_data: `review:${ctx.review.id}:${a.id}`,
        })),
      ];

    try {
      const result = await account.api.sendMessage(ctx.to, ctx.text, {
        parse_mode: 'HTML',
        reply_markup: {inline_keyboard: keyboard},
        reply_to_message_id: ctx.replyToId ? Number(ctx.replyToId) : undefined,
      });
      return {ok: true, messageId: String(result.message_id)};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },
};
