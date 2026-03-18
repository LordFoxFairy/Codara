import type {InboundMessage, StopHandle} from '@gateway/types';
import {TelegramApi} from './api';
import type {TelegramCallbackQuery, TelegramMessage, TelegramUpdate} from './types';

const RETRY_DELAY_MS = 5_000;
const DEFAULT_POLLING_TIMEOUT = 30;

export interface TelegramPollingOptions {
  token: string;
  accountId: string;
  pollingTimeout?: number;
  onMessage: (msg: InboundMessage) => Promise<void>;
  onCallbackQuery?: (query: TelegramCallbackQuery) => void;
}

/**
 * Normalize a TelegramMessage into Codara's InboundMessage format.
 */
export function normalizeTelegramMessage(
  msg: TelegramMessage,
  accountId: string,
): InboundMessage {
  const chatType = msg.chat.type;
  const peerKind: 'direct' | 'group' | 'channel' =
    chatType === 'private' ? 'direct' : chatType === 'channel' ? 'channel' : 'group';

  return {
    channel: 'telegram',
    accountId,
    messageId: String(msg.message_id),
    sender: {
      id: msg.from ? String(msg.from.id) : 'unknown',
      name: msg.from?.first_name,
      username: msg.from?.username,
    },
    peer: {
      kind: peerKind,
      id: String(msg.chat.id),
      name: msg.chat.title,
    },
    text: msg.text ?? msg.caption ?? '',
    replyToId: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
    timestamp: msg.date * 1000,
    raw: msg,
  };
}

/**
 * Start long polling for Telegram updates.
 *
 * 1. Clears any existing webhook
 * 2. Loops calling getUpdates with long polling
 * 3. Normalizes messages and dispatches via onMessage
 * 4. On error: logs, waits 5s, retries
 */
export function startTelegramPolling(options: TelegramPollingOptions): StopHandle {
  const {token, accountId, pollingTimeout, onMessage, onCallbackQuery} = options;
  const api = new TelegramApi(token);
  const timeout = pollingTimeout ?? DEFAULT_POLLING_TIMEOUT;

  let running = true;
  let offset: number | undefined;

  const loop = async () => {
    // Clear any previous webhook before polling
    try {
      await api.deleteWebhook();
    } catch (err) {
      console.error('[telegram] Failed to clear webhook:', err);
    }

    while (running) {
      try {
        const updates = await api.getUpdates(offset, timeout);
        for (const update of updates) {
          offset = update.update_id + 1;
          await processUpdate(update);
        }
      } catch (err) {
        if (!running) break;
        console.error('[telegram] Polling error:', err);
        await sleep(RETRY_DELAY_MS);
      }
    }
  };

  const processUpdate = async (update: TelegramUpdate) => {
    if (update.callback_query) {
      onCallbackQuery?.(update.callback_query);
      return;
    }

    if (update.message) {
      const inbound = normalizeTelegramMessage(update.message, accountId);
      if (inbound.text) {
        await onMessage(inbound);
      }
    }
  };

  // Start the loop (fire and forget — errors are caught inside)
  const loopPromise = loop();

  return {
    async stop() {
      running = false;
      await loopPromise;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
