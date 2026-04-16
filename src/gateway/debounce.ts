/**
 * @module gateway/debounce
 *
 * Debounced message handler for IM platforms.
 *
 * Users in IM apps often send multiple short messages in rapid succession.
 * This module buffers those messages and merges them before dispatching to
 * the agent, avoiding redundant processing and reducing API calls.
 */

import type {InboundMessage} from './types';

export interface DebounceOptions {
  /** Debounce window in ms (default: 1500) */
  windowMs?: number;
  /** Max messages to buffer before force-flush (default: 10) */
  maxBuffer?: number;
}

export interface DebouncedHandler {
  /** Add a message to the buffer. May trigger immediate or delayed processing. */
  add(msg: InboundMessage): void;
  /** Force flush all pending buffers */
  flush(): Promise<void>;
  /** Dispose all timers */
  dispose(): void;
}

interface BufferEntry {
  messages: InboundMessage[];
  timer: ReturnType<typeof setTimeout>;
}

function bufferKey(msg: InboundMessage): string {
  return `${msg.channel}:${msg.accountId}:${msg.peer.id}:${msg.sender.id}`;
}

function mergeMessages(messages: InboundMessage[]): InboundMessage {
  const last = messages[messages.length - 1]!;
  return {
    ...last,
    text: messages.map((m) => m.text).join('\n'),
    mediaUrls: messages.flatMap((m) => m.mediaUrls ?? []),
  };
}

/**
 * Creates a debounced message handler.
 *
 * When messages arrive within `windowMs` of each other from the same peer,
 * they are merged into a single message (text concatenated with \n).
 *
 * Use case: Users who send multiple short messages rapidly in IM:
 *   "帮我"
 *   "看看这个文件"
 *   "src/index.ts"
 * → Merged into: "帮我\n看看这个文件\nsrc/index.ts"
 *
 * @param handler  — called with the merged message when the debounce window fires.
 * @param options  — debounce timing configuration.
 * @param onError  — called when `handler` rejects. If omitted, errors are silently lost.
 */
export function createDebouncedHandler(
  handler: (msg: InboundMessage) => Promise<void>,
  options?: DebounceOptions,
  onError?: (err: unknown, msg: InboundMessage) => void,
): DebouncedHandler {
  const windowMs = options?.windowMs ?? 1500;
  const maxBuffer = options?.maxBuffer ?? 10;
  const buffers = new Map<string, BufferEntry>();

  function flushKey(key: string): Promise<void> {
    const entry = buffers.get(key);
    if (!entry) return Promise.resolve();
    clearTimeout(entry.timer);
    buffers.delete(key);
    const merged = mergeMessages(entry.messages);
    return handler(merged).catch((err) => {
      if (onError) onError(err, merged);
    });
  }

  function add(msg: InboundMessage): void {
    const key = bufferKey(msg);
    const existing = buffers.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(msg);

      if (existing.messages.length >= maxBuffer) {
        void flushKey(key);
        return;
      }

      existing.timer = setTimeout(() => void flushKey(key), windowMs);
    } else {
      const timer = setTimeout(() => void flushKey(key), windowMs);
      buffers.set(key, {messages: [msg], timer});
    }
  }

  async function flush(): Promise<void> {
    const keys = [...buffers.keys()];
    await Promise.all(keys.map((k) => flushKey(k)));
  }

  function dispose(): void {
    for (const entry of buffers.values()) {
      clearTimeout(entry.timer);
    }
    buffers.clear();
  }

  return {add, flush, dispose};
}
