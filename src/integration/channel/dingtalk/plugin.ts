/**
 * DingTalk ChannelPlugin implementation.
 *
 * Integrates DingTalk robot messaging with the Codara Multi-Channel Gateway.
 * Uses sessionWebhook (per-message callback URL) for outbound replies.
 * Supports text (via markdown), and review action cards with callback buttons.
 */

import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@integration/channel/contracts';
import type {OutboundContext, ReviewPromptContext, SendResult, StopHandle} from '@gateway/types';
import {resolveEnvValue} from '@integration/channel/utils';
import {DingTalkApi, DingTalkApiError} from './api';
import {startDingTalkWebhook} from './webhook';
import type {DingTalkActionCardButton} from './types';

const DEFAULT_WEBHOOK_PORT = 8075;
const DEFAULT_WEBHOOK_PATH = '/dingtalk/webhook';

/** Resolved account — ready for use after config parsing. */
export interface DingTalkAccount {
  appSecret: string;
  api: DingTalkApi;
  webhookPort: number;
  webhookPath: string;
  callbackBaseUrl?: string;
}

const dingtalkAccountConfigSchema = z.object({
  appSecret: z.string().min(1, 'appSecret is required'),
  webhookPort: z.number().int().positive().optional(),
  webhookPath: z.string().optional(),
  callbackBaseUrl: z.url().optional(),
});

export const dingtalkPlugin: ChannelPlugin<DingTalkAccount> = {
  id: 'dingtalk',
  name: '钉钉',

  capabilities: {
    chatTypes: ['direct', 'group'],
    streaming: false,
    threads: false,
    media: false,
    reactions: false,
    textLimit: 20000,
  },

  configSchema: dingtalkAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): DingTalkAccount | undefined {
    const parsed = dingtalkAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const secret = resolveEnvValue(data.appSecret);
    return {
      appSecret: secret,
      api: new DingTalkApi(),
      webhookPort: data.webhookPort ?? DEFAULT_WEBHOOK_PORT,
      webhookPath: data.webhookPath ?? DEFAULT_WEBHOOK_PATH,
      callbackBaseUrl: data.callbackBaseUrl,
    };
  },

  async startListening(ctx: GatewayListenContext<DingTalkAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onReviewResponse} = ctx;

    const onReviewCallback = (action: string, reviewId: string) => {
      if (onReviewResponse) {
        onReviewResponse(reviewId, {actionId: action});
      }
    };

    return startDingTalkWebhook({
      accountId,
      appSecret: account.appSecret,
      api: account.api,
      port: account.webhookPort,
      path: account.webhookPath,
      onMessage,
      onReviewCallback,
      callbackBaseUrl: account.callbackBaseUrl,
    });
  },

  async sendText(account: DingTalkAccount, ctx: OutboundContext): Promise<SendResult> {
    try {
      // Use markdown for richer formatting (DingTalk markdown supports bold, links, etc.)
      const title = '回复';
      await account.api.sendMarkdown(ctx.to, title, ctx.text);
      return {ok: true};
    } catch (err) {
      if (err instanceof DingTalkApiError) {
        return {ok: false, error: err.message};
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  async sendReviewPrompt(account: DingTalkAccount, ctx: ReviewPromptContext): Promise<SendResult> {
    try {
      const buttons: DingTalkActionCardButton[] = ctx.actions.map((a) => {
        // Build callback URL for each action button
        const callbackUrl = account.callbackBaseUrl
          ? `${account.callbackBaseUrl}${account.webhookPath}/callback?action=${encodeURIComponent(a.id)}&id=${encodeURIComponent(ctx.review.id)}`
          : `dingtalk://dingtalkclient/page/link?pc_slide=false&url=${encodeURIComponent('about:blank')}`;

        return {title: a.label, actionURL: callbackUrl};
      });

      await account.api.sendActionCard(ctx.to, ctx.text, ctx.text, buttons);
      return {ok: true};
    } catch (err) {
      if (err instanceof DingTalkApiError) {
        return {ok: false, error: err.message};
      }
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },
};
