import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {OutboundContext, PausePromptContext, SendResult, StopHandle} from '@gateway/types';
import {WeComApi} from './api';
import {startWeComWebhook} from './webhook';

/** Resolved account — ready for use after config parsing. */
export interface WeComAccount {
  corpId: string;
  corpSecret: string;
  agentId: number;
  token: string;
  encodingAESKey: string;
  api: WeComApi;
  webhookPort: number;
  webhookPath: string;
}

const wecomAccountConfigSchema = z.object({
  corpId: z.string().min(1, 'corpId is required'),
  corpSecret: z.string().min(1, 'corpSecret is required'),
  agentId: z.number().int().positive('agentId must be a positive integer'),
  token: z.string().min(1, 'token is required'),
  encodingAESKey: z.string().min(1, 'encodingAESKey is required').refine(
    (v) => v.startsWith('$') || v.length === 43,
    'encodingAESKey must be 43 characters (or $ENV_VAR reference)',
  ),
  webhookPort: z.number().int().positive().optional().default(9322),
  webhookPath: z.string().optional().default('/wecom/webhook'),
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

export const wecomPlugin: ChannelPlugin<WeComAccount> = {
  id: 'wecom',
  name: '企业微信',

  capabilities: {
    chatTypes: ['direct', 'group'],
    streaming: false,
    threads: false,
    media: true,
    reactions: false,
    textLimit: 2048,
  },

  configSchema: wecomAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): WeComAccount | undefined {
    const parsed = wecomAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const corpId = resolveEnvValue(data.corpId);
    const corpSecret = resolveEnvValue(data.corpSecret);
    const agentId = data.agentId;
    const token = resolveEnvValue(data.token);
    const encodingAESKey = resolveEnvValue(data.encodingAESKey);

    return {
      corpId,
      corpSecret,
      agentId,
      token,
      encodingAESKey,
      api: new WeComApi(corpId, corpSecret, agentId),
      webhookPort: data.webhookPort,
      webhookPath: data.webhookPath,
    };
  },

  async startListening(ctx: GatewayListenContext<WeComAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onPauseResponse} = ctx;

    const onCardAction = (eventKey: string, taskId: string, userId: string) => {
      if (!onPauseResponse) return;
      onPauseResponse(taskId, {actionId: eventKey, from: {id: userId}});
    };

    return startWeComWebhook({
      port: account.webhookPort,
      path: account.webhookPath,
      token: account.token,
      encodingAESKey: account.encodingAESKey,
      corpId: account.corpId,
      accountId,
      onMessage,
      onCardAction,
    });
  },

  async sendText(account: WeComAccount, ctx: OutboundContext): Promise<SendResult> {
    try {
      // Use markdown for richer formatting support
      const result = await account.api.sendMarkdownMessage(ctx.to, ctx.text);
      return {ok: true, messageId: result.msgid};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  async sendPausePrompt(account: WeComAccount, ctx: PausePromptContext): Promise<SendResult> {
    try {
      const buttons = ctx.actions.map((a) => ({
        text: a.label,
        style: a.style === 'approve' ? 1 : a.style === 'reject' ? 3 : 2,
        key: a.id,
      }));

      const result = await account.api.sendTemplateCard(
        ctx.to,
        '需要审批',
        ctx.text,
        buttons,
      );
      return {ok: true, messageId: result.msgid};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },
};
