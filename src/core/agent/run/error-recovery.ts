/**
 * Staged error recovery helpers for the agent loop.
 *
 * Stage 1: Context window exhaustion → auto-compact (handled inline)
 * Stage 2: Rate limit (429) → wait retry-after then retry once per turn
 * Stage 3: Transient API error (5xx / timeout / network) → retry once per turn
 * Stage 4: Unrecoverable → propagate
 */

/**
 * Detect rate-limit / 429 errors from the model API.
 */
export function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests');
  }
  return false;
}

/**
 * Detect transient server / network errors that are safe to retry once.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('500') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('timeout') ||
      msg.includes('econnreset') ||
      msg.includes('network')
    );
  }
  return false;
}

/** Maximum wait time we're willing to honour from a retry-after header (ms). */
const MAX_RETRY_AFTER_MS = 60_000;
/** Default back-off when no retry-after header is present (ms). */
const DEFAULT_RETRY_AFTER_MS = 5_000;

/**
 * Extract the `retry-after` value (in **milliseconds**) from an error object.
 *
 * Looks for a `headers` property (plain object or Headers-like with `.get()`).
 * Returns `undefined` only when the extracted value exceeds the safety cap, so
 * callers can decide whether to honour the wait.
 */
export function extractRetryAfter(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const headers =
      (error as Record<string, unknown>).headers ??
      ((error as Record<string, unknown>).response as Record<string, unknown> | undefined)?.headers;

    if (headers) {
      const raw =
        (headers as Record<string, unknown>)['retry-after'] ??
        (typeof (headers as {get?: unknown}).get === 'function'
          ? (headers as {get(name: string): string | null}).get('retry-after')
          : undefined);

      if (raw !== undefined && raw !== null) {
        const seconds = Number.parseInt(String(raw), 10);
        if (!Number.isNaN(seconds)) {
          const ms = seconds * 1000;
          return ms <= MAX_RETRY_AFTER_MS ? ms : undefined;
        }
      }
    }
  }
  // Default back-off
  return DEFAULT_RETRY_AFTER_MS;
}
