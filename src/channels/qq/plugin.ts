import {z} from 'zod';
import type {ChannelPlugin, GatewayListenContext} from '@channels/contracts';
import type {InboundMessage, OutboundContext, ReviewPromptContext, SendResult, StopHandle} from '@gateway/types';
import {resolveEnvValue} from '@channels/utils';
import {OneBotWsClient} from './ws-client';
import type {OneBotEvent, OneBotMessageEvent, OneBotMessageSegment} from './types';

// ── Account ────────────────────────────────────────────────────────────

/** Resolved account — ready for use after config parsing. */
export interface QQAccount {
  wsUrl: string;
  accessToken?: string;
  allowUsers?: string[];
  allowGroups?: string[];
  groupPolicy?: {requireMention?: boolean};
  selfId?: string;
  /** Attached at runtime by startListening. */
  client?: OneBotWsClient;
  /** Pending review prompts, keyed by reviewId. Managed by startListening + sendReviewPrompt. */
  pendingReviews?: Map<string, PendingReview>;
}

interface PendingReview {
  userId: string;
  peerId: string;
  actions: {id: string; label: string}[];
}

// ── Config Schema ──────────────────────────────────────────────────────

const qqAccountConfigSchema = z.object({
  wsUrl: z.string().min(1, 'wsUrl is required'),
  accessToken: z.string().optional(),
  allowUsers: z.array(z.string()).optional(),
  allowGroups: z.array(z.string()).optional(),
  groupPolicy: z.object({requireMention: z.boolean().optional()}).optional(),
  selfId: z.string().optional(),
});

// ── Helpers ────────────────────────────────────────────────────────────

function isMessageEvent(event: OneBotEvent): event is OneBotMessageEvent {
  return event.post_type === 'message';
}

function extractText(segments: OneBotMessageSegment[]): string {
  return segments
    .filter((s) => s.type === 'text')
    .map((s) => s.data.text ?? '')
    .join('')
    .trim();
}

function extractMediaUrls(segments: OneBotMessageSegment[]): string[] {
  return segments.filter((s) => s.type === 'image' && s.data.url).map((s) => s.data.url!);
}

function isBotMentioned(segments: OneBotMessageSegment[], selfId: string): boolean {
  return segments.some((s) => s.type === 'at' && s.data.qq === selfId);
}

function extractReplyId(segments: OneBotMessageSegment[]): string | undefined {
  const reply = segments.find((s) => s.type === 'reply');
  return reply?.data.id;
}

// ── Normalize ──────────────────────────────────────────────────────────

/**
 * Normalize an OneBot message event into Codara's InboundMessage format.
 */
export function normalizeOneBotMessage(event: OneBotMessageEvent, accountId: string, selfId?: string): InboundMessage {
  const peerKind = event.message_type === 'private' ? 'direct' : 'group';
  // For groups, prefix peer.id with "group:" so sendText can distinguish target type.
  const rawPeerId = event.message_type === 'group' ? String(event.group_id) : String(event.user_id);
  const peerId = event.message_type === 'group' ? `group:${rawPeerId}` : rawPeerId;
  const displayName = event.sender.card || event.sender.nickname;

  // QQ uses @-segments in message arrays to mention users.
  const isMentioned = selfId ? isBotMentioned(event.message, selfId) : false;

  return {
    channel: 'qq',
    accountId,
    messageId: String(event.message_id),
    sender: {
      id: String(event.user_id),
      name: displayName,
      username: String(event.user_id),
    },
    peer: {
      kind: peerKind,
      id: peerId,
      name: event.message_type === 'group' ? undefined : displayName,
    },
    text: extractText(event.message),
    mediaUrls: extractMediaUrls(event.message),
    replyToId: extractReplyId(event.message),
    isMentioned,
    timestamp: event.time * 1000,
    raw: event,
  };
}

// ── Plugin ─────────────────────────────────────────────────────────────

export const qqPlugin: ChannelPlugin<QQAccount> = {
  id: 'qq',
  name: 'QQ',

  capabilities: {
    chatTypes: ['direct', 'group'],
    streaming: false,
    threads: false,
    media: true,
    reactions: true,
    textLimit: 4500,
  },

  configSchema: qqAccountConfigSchema,

  resolveAccount(config: Record<string, unknown>): QQAccount | undefined {
    const parsed = qqAccountConfigSchema.safeParse(config);
    if (!parsed.success) return undefined;

    const data = parsed.data;
    const wsUrl = resolveEnvValue(data.wsUrl);
    return {
      wsUrl,
      accessToken: data.accessToken ? resolveEnvValue(data.accessToken) : undefined,
      allowUsers: data.allowUsers,
      allowGroups: data.allowGroups,
      groupPolicy: data.groupPolicy,
      selfId: data.selfId,
    };
  },

  async startListening(ctx: GatewayListenContext<QQAccount>): Promise<StopHandle> {
    const {account, accountId, onMessage, onReviewResponse} = ctx;
    const client = new OneBotWsClient(account.wsUrl, account.accessToken);
    const pendingReviews = new Map<string, PendingReview>();

    // Attach to account so sendText/sendReviewPrompt can reuse the connection.
    account.client = client;
    account.pendingReviews = pendingReviews;

    let selfId = account.selfId;

    client.onEvent((event: OneBotEvent) => {
      if (!isMessageEvent(event)) return;

      // Auto-detect bot's QQ ID from first event
      if (!selfId) {
        selfId = String(event.self_id);
        account.selfId = selfId;
      }

      const msg = normalizeOneBotMessage(event, accountId, selfId);

      // Access control
      if (account.allowUsers && !account.allowUsers.includes(msg.sender.id)) return;
      if (event.message_type === 'group' && account.allowGroups && !account.allowGroups.includes(String(event.group_id))) {
        return;
      }

      // Group policy: require @mention
      if (event.message_type === 'group' && account.groupPolicy?.requireMention && selfId && !isBotMentioned(event.message, selfId)) {
        return;
      }

      // Check if this is a numbered response to a pending review prompt
      if (onReviewResponse && pendingReviews.size > 0) {
        const text = msg.text.trim();
        for (const [reviewId, review] of pendingReviews) {
          // Match by peer (same chat). If userId is set, also match sender.
          const peerMatch = review.peerId === msg.peer.id;
          const userMatch = !review.userId || review.userId === msg.sender.id;
          if (peerMatch && userMatch) {
            const choiceIndex = parseInt(text, 10);
            if (choiceIndex >= 1 && choiceIndex <= review.actions.length) {
              const actionId = review.actions[choiceIndex - 1].id;
              pendingReviews.delete(reviewId);
              onReviewResponse(reviewId, {actionId, from: {userId: msg.sender.id}});
              return; // Consumed as review response
            }
          }
        }
      }

      if (!msg.text) return;
      onMessage(msg).catch((err) => {
        console.error('[qq] Error processing message:', err);
      });
    });

    await client.connect();

    return {
      async stop() {
        account.client = undefined;
        account.pendingReviews = undefined;
        await client.disconnect();
      },
    };
  },

  async sendText(account: QQAccount, ctx: OutboundContext): Promise<SendResult> {
    const client = account.client;
    if (!client?.connected) {
      return {ok: false, error: 'WebSocket client not connected'};
    }

    try {
      const message: OneBotMessageSegment[] = [{type: 'text', data: {text: ctx.text}}];
      const to = ctx.to;

      let messageId: number;
      if (to.startsWith('group:')) {
        const groupId = Number(to.slice(6));
        messageId = await client.sendGroupMsg(groupId, message);
      } else {
        const userId = Number(to);
        messageId = await client.sendPrivateMsg(userId, message);
      }

      return {ok: true, messageId: String(messageId)};
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      return {ok: false, error: msg};
    }
  },

  async sendTyping(_account: QQAccount, _ctx: OutboundContext): Promise<void> {
    // OneBot v11 does not support typing indicators — no-op
  },

  async sendReviewPrompt(account: QQAccount, ctx: ReviewPromptContext): Promise<SendResult> {
    // QQ doesn't have inline buttons — send numbered text options.
    const lines = [ctx.text, '', '回复数字选择:'];
    for (let i = 0; i < ctx.actions.length; i++) {
      lines.push(`${i + 1}. ${ctx.actions[i].label}`);
    }
    const text = lines.join('\n');

    // Track this review so inbound number replies can be matched.
    if (account.pendingReviews) {
      // For groups, peerId includes "group:" prefix matching normalizeOneBotMessage output
      account.pendingReviews.set(ctx.review.id, {
        userId: '', // Will match any user in this peer (first responder wins)
        peerId: ctx.to,
        actions: ctx.actions.map((a) => ({id: a.id, label: a.label})),
      });
    }

    return qqPlugin.sendText(account, {...ctx, text});
  },
};
