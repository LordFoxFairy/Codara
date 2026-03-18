import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {OutboundContext, PausePromptContext, SendResult, StopHandle} from '@gateway/types';
import {FeishuApi} from './api';
import {startFeishuWebhook} from './webhook';

/** Resolved account — ready for use after config parsing. */
export interface FeishuAccount {
  appId: string;
  appSecret: string;
  api: FeishuApi;
  verifyToken?: string;
  encryptKey?: string;
  webhookPort: number;
  webhookPath: string;
}

const feishuAccountConfigSchema = z.object({
  appId: z.string().min(1, 'appId is required'),
  appSecret: z.string().min(1, 'appSecret is required'),
  verifyToken: z.string().optional(),
  encryptKey: z.string().optional(),
  webhookPort: z.number().int().positive().optional().default(9321),
  webhookPath: z.string().optional().default('/feishu/webhook'),
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

/**
 * Build a Feishu interactive card JSON for pause prompt (HIL).
 */
function buildPauseCard(
  text: string,
  pauseId: string,
  actions: Array<{id: string; label: string; style: 'approve' | 'reject' | 'edit'}>,
): string {
  const buttons = actions.map((a) => ({
    tag: 'button',
    text: {tag: 'plain_text', content: a.label},
    type: a.style === 'approve' ? 'primary' : a.style === 'reject' ? 'danger' : 'default',
    value: {action: a.id, pauseId},
  }));

  const card = {
    config: {wide_screen_mode: true},
    header: {title: {tag: 'plain_text', content: '需要审批'}},
    elements: [
      {tag: 'div', text: {tag: 'lark_md', content: text}},
      {tag: 'action', actions: buttons},
    ],
  };

  return JSON.stringify(card);
}

export const feishuPlugin: ChannelPlugin<FeishuAccount> = {
  id: 'feishu',
  name: '飞书',

  capabilities: {
    chatTypes: ['direct', 'group'],
    streaming: false,
    threads: true,
    media: true,
    reactions: true,
    textLimit: 30000,
  },

  configSchema: feishuAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): FeishuAccount | undefined {
    const parsed = feishuAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const appId = resolveEnvValue(data.appId);
    const appSecret = resolveEnvValue(data.appSecret);

    return {
      appId,
      appSecret,
      api: new FeishuApi(appId, appSecret),
      verifyToken: data.verifyToken ? resolveEnvValue(data.verifyToken) : undefined,
      encryptKey: data.encryptKey ? resolveEnvValue(data.encryptKey) : undefined,
      webhookPort: data.webhookPort,
      webhookPath: data.webhookPath,
    };
  },

  async startListening(ctx: GatewayListenContext<FeishuAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onPauseResponse} = ctx;

    const onCardAction = (_actionTag: string, actionValue: unknown, userId: string) => {
      if (!onPauseResponse) return;

      const value = actionValue as Record<string, string> | undefined;
      if (value?.pauseId && value?.action) {
        onPauseResponse(value.pauseId, {actionId: value.action, from: {id: userId}});
      }
    };

    return startFeishuWebhook({
      port: account.webhookPort,
      path: account.webhookPath,
      encryptKey: account.encryptKey,
      verifyToken: account.verifyToken,
      accountId,
      onMessage,
      onCardAction,
    });
  },

  async sendText(account: FeishuAccount, ctx: OutboundContext): Promise<SendResult> {
    try {
      // Use "text" message type with lark_md content for rich text
      const content = JSON.stringify({text: ctx.text});

      if (ctx.replyToId) {
        const result = await account.api.replyMessage(ctx.replyToId, content, 'text');
        return {ok: true, messageId: result.data?.message_id};
      }

      const result = await account.api.sendMessage(ctx.to, 'chat_id', content, 'text');
      return {ok: true, messageId: result.data?.message_id};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  async sendPausePrompt(account: FeishuAccount, ctx: PausePromptContext): Promise<SendResult> {
    try {
      const cardContent = buildPauseCard(ctx.text, ctx.pause.id, ctx.actions);

      if (ctx.replyToId) {
        const result = await account.api.replyMessage(ctx.replyToId, cardContent, 'interactive');
        return {ok: true, messageId: result.data?.message_id};
      }

      const result = await account.api.sendMessage(ctx.to, 'chat_id', cardContent, 'interactive');
      return {ok: true, messageId: result.data?.message_id};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },
};
