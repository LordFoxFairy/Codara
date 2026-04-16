/**
 * Multi-layer error recovery pipeline for the agent loop.
 *
 * Recovery hierarchy (aligned with Claude Code query.ts):
 *
 * Stage 0: Abort — return gracefully
 * Stage 1: Max output tokens → escalate token limit, then multi-turn recovery
 * Stage 2: Context window exhaustion → cheap drain (remove old tool results), then full compact
 * Stage 3: Rate limit (429) → exponential backoff with jitter
 * Stage 4: Transient API error (5xx / timeout / network) → single retry per turn
 * Stage 5: Unrecoverable → propagate
 *
 * Each recovery strategy carries an "already attempted" flag to prevent loops.
 */

// ─── Recovery State ──────────────────────────────────────────────────────────

/** Max number of max_output_tokens multi-turn recovery attempts (matches Claude Code). */
export const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;

/**
 * Mutable recovery state carried across loop iterations.
 * Each flag prevents the same recovery from firing repeatedly.
 */
export interface RecoveryState {
  /** Number of context compaction attempts used so far. */
  compactionAttempts: number;
  /** Whether a cheap drain (strip old tool results) has been attempted for context overflow. */
  cheapDrainAttempted: boolean;
  /** Number of max_output_tokens multi-turn recovery attempts. */
  maxOutputTokensRecoveryCount: number;
  /** Current per-turn rate limit retry attempt (resets each turn). */
  rateLimitAttempt: number;
  /** Whether a transient retry has been used this turn. */
  transientRetried: boolean;
  /** Cumulative token usage across turns for task budget tracking. */
  cumulativeTokensUsed: number;
}

export function createRecoveryState(): RecoveryState {
  return {
    compactionAttempts: 0,
    cheapDrainAttempted: false,
    maxOutputTokensRecoveryCount: 0,
    rateLimitAttempt: 0,
    transientRetried: false,
    cumulativeTokensUsed: 0,
  };
}

/** Reset per-turn flags at the start of each turn. */
export function resetPerTurnFlags(state: RecoveryState): void {
  state.rateLimitAttempt = 0;
  state.transientRetried = false;
}

// ─── Error Classification ────────────────────────────────────────────────────

/** Extract a numeric HTTP status from an error object, if present. */
function getErrorStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    // Most SDK errors expose `.status` directly
    if (typeof record.status === 'number') return record.status;
    // Some wrap it under `.response.status`
    const resp = record.response;
    if (resp && typeof resp === 'object' && typeof (resp as Record<string, unknown>).status === 'number') {
      return (resp as Record<string, unknown>).status as number;
    }
  }
  return undefined;
}

/** Extract the structured error type string (e.g. "rate_limit_error"). */
function getErrorType(error: unknown): string | undefined {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    // Anthropic SDK: error.error.type
    const inner = record.error;
    if (inner && typeof inner === 'object') {
      const t = (inner as Record<string, unknown>).type;
      if (typeof t === 'string') return t;
    }
    // OpenAI SDK: error.type or error.code
    if (typeof record.type === 'string') return record.type;
    if (typeof record.code === 'string') return record.code;
  }
  return undefined;
}

/**
 * Detect rate-limit / 429 errors from the model API.
 *
 * Checks structured fields first (status code, error type), then falls back
 * to message string matching for SDKs that don't expose structured info.
 */
export function isRateLimitError(error: unknown): boolean {
  // Structured check: HTTP 429
  const status = getErrorStatus(error);
  if (status === 429) return true;

  // Structured check: error type
  const errorType = getErrorType(error);
  if (errorType === 'rate_limit_error') return true;

  // Fallback: string matching
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('rate limit') || msg.includes('429') || msg.includes('too many requests');
  }
  return false;
}

/**
 * Detect transient server / network errors that are safe to retry once.
 *
 * Checks structured fields first (5xx status codes), then falls back
 * to message string matching.
 */
export function isTransientError(error: unknown): boolean {
  // Structured check: 5xx server errors
  const status = getErrorStatus(error);
  if (status !== undefined && status >= 500 && status <= 599) return true;

  // Structured check: error type
  const errorType = getErrorType(error);
  if (errorType === 'server_error' || errorType === 'overloaded_error' || errorType === 'api_error') return true;

  // Fallback: string matching
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

/**
 * Detect max_output_tokens truncation from the model response metadata.
 *
 * LangChain models expose the stop reason in response_metadata.
 * Claude Code checks `apiError === 'max_output_tokens'` on their message type;
 * we check the equivalent LangChain fields.
 */
export function isMaxOutputTokensError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('max_output_tokens') ||
    msg.includes('max_tokens') ||
    msg.includes('output token limit') ||
    msg.includes('maximum output')
  );
}

/**
 * Detect context-window / payload-too-large errors (413 or 400 with context messages).
 * This complements `isContextWindowExhausted` in compact.ts for non-compaction scenarios.
 */
export function isContextWindowError(error: unknown): boolean {
  const status = getErrorStatus(error);

  // HTTP 413: Request Entity Too Large
  if (status === 413) return true;

  // HTTP 400 with context-window-related message
  if (status === 400 && error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes('context length exceeded') ||
      msg.includes('maximum context length') ||
      msg.includes('too many tokens') ||
      msg.includes('prompt is too long') ||
      msg.includes('context_length_exceeded')
    ) return true;
  }

  // Structured error type check
  const errorType = getErrorType(error);
  if (errorType === 'context_length_exceeded' || errorType === 'invalid_request_error') {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('context') || msg.includes('token') || msg.includes('too long')) return true;
    }
  }

  return false;
}

// ─── Retry Delay ─────────────────────────────────────────────────────────────

/** Base delay for exponential backoff (ms). Matches Claude Code's BASE_DELAY_MS. */
const BASE_DELAY_MS = 500;
/** Maximum exponential backoff delay (ms). */
const MAX_BACKOFF_MS = 32_000;
/** Maximum wait time we're willing to honour from a retry-after header (ms). */
const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Calculate retry delay with exponential backoff + jitter.
 *
 * Aligned with Claude Code's `getRetryDelay` in withRetry.ts:
 * - If retry-after header present, use it directly (capped at 60s)
 * - Otherwise: min(BASE_DELAY_MS * 2^attempt, MAX_BACKOFF_MS) + random 25% jitter
 *
 * @param attempt  1-based attempt number
 * @param retryAfterMs  retry-after from headers (already in ms), or undefined
 */
export function computeRetryDelay(attempt: number, retryAfterMs?: number): number {
  // Honour retry-after header if within cap
  if (retryAfterMs !== undefined && retryAfterMs <= MAX_RETRY_AFTER_MS) {
    return retryAfterMs;
  }

  // Exponential backoff: 500ms → 1s → 2s → 4s → 8s → 16s → 32s (cap)
  const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
  // Random jitter: 0-25% of base delay
  const jitter = Math.random() * 0.25 * baseDelay;
  return baseDelay + jitter;
}

/**
 * Extract the `retry-after` value (in **milliseconds**) from an error object.
 *
 * Looks for a `headers` property (plain object or Headers-like with `.get()`).
 * Returns `undefined` when no valid retry-after is found or it exceeds the cap.
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
  // No header found — return undefined so caller uses computeRetryDelay backoff
  return undefined;
}
