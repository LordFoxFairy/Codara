import {describe, expect, it} from 'bun:test';
import {
  isRateLimitError,
  isTransientError,
  isMaxOutputTokensError,
  isContextWindowError,
  extractRetryAfter,
  computeRetryDelay,
  createRecoveryState,
  resetPerTurnFlags,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
} from '../../../src/core/agent/run/error-recovery';

describe('error-recovery', () => {
  describe('isRateLimitError', () => {
    it('should detect "rate limit" in message', () => {
      expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    });

    it('should detect "429" in message', () => {
      expect(isRateLimitError(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('should detect "too many requests" in message', () => {
      expect(isRateLimitError(new Error('too many requests'))).toBe(true);
    });

    it('should detect HTTP 429 status on error object', () => {
      expect(isRateLimitError({status: 429, message: 'nope'})).toBe(true);
    });

    it('should detect rate_limit_error type', () => {
      expect(isRateLimitError({error: {type: 'rate_limit_error'}})).toBe(true);
    });

    it('should reject unrelated errors', () => {
      expect(isRateLimitError(new Error('some other error'))).toBe(false);
    });

    it('should reject non-Error values', () => {
      expect(isRateLimitError('rate limit')).toBe(false);
      expect(isRateLimitError(null)).toBe(false);
      expect(isRateLimitError(undefined)).toBe(false);
    });
  });

  describe('isTransientError', () => {
    it('should detect 502 Bad Gateway', () => {
      expect(isTransientError(new Error('502 Bad Gateway'))).toBe(true);
    });

    it('should detect 503 Service Unavailable', () => {
      expect(isTransientError(new Error('503 Service Unavailable'))).toBe(true);
    });

    it('should detect 500 Internal Server Error', () => {
      expect(isTransientError(new Error('500 Internal Server Error'))).toBe(true);
    });

    it('should detect structured 5xx status', () => {
      expect(isTransientError({status: 503})).toBe(true);
    });

    it('should detect server_error type', () => {
      expect(isTransientError({error: {type: 'server_error'}})).toBe(true);
    });

    it('should detect overloaded_error type', () => {
      expect(isTransientError({error: {type: 'overloaded_error'}})).toBe(true);
    });

    it('should detect ECONNRESET', () => {
      expect(isTransientError(new Error('ECONNRESET'))).toBe(true);
    });

    it('should detect timeout', () => {
      expect(isTransientError(new Error('timeout'))).toBe(true);
    });

    it('should detect network errors', () => {
      expect(isTransientError(new Error('network error'))).toBe(true);
    });

    it('should reject unrelated errors', () => {
      expect(isTransientError(new Error('auth failed'))).toBe(false);
    });

    it('should reject non-Error values', () => {
      expect(isTransientError('502')).toBe(false);
    });
  });

  describe('isMaxOutputTokensError', () => {
    it('should detect max_output_tokens in message', () => {
      expect(isMaxOutputTokensError(new Error('max_output_tokens exceeded'))).toBe(true);
    });

    it('should detect max_tokens in message', () => {
      expect(isMaxOutputTokensError(new Error('max_tokens reached'))).toBe(true);
    });

    it('should detect output token limit in message', () => {
      expect(isMaxOutputTokensError(new Error('output token limit hit'))).toBe(true);
    });

    it('should detect maximum output in message', () => {
      expect(isMaxOutputTokensError(new Error('maximum output length reached'))).toBe(true);
    });

    it('should reject unrelated errors', () => {
      expect(isMaxOutputTokensError(new Error('something else'))).toBe(false);
    });

    it('should reject non-Error values', () => {
      expect(isMaxOutputTokensError('max_tokens')).toBe(false);
      expect(isMaxOutputTokensError(null)).toBe(false);
    });
  });

  describe('isContextWindowError', () => {
    it('should detect HTTP 413', () => {
      expect(isContextWindowError({status: 413})).toBe(true);
    });

    it('should detect HTTP 400 with context length message', () => {
      const error = Object.assign(new Error('context length exceeded'), {status: 400});
      expect(isContextWindowError(error)).toBe(true);
    });

    it('should detect context_length_exceeded error type with matching message', () => {
      const error = Object.assign(new Error('too many tokens in context'), {
        error: {type: 'context_length_exceeded'},
      });
      expect(isContextWindowError(error)).toBe(true);
    });

    it('should reject unrelated 400 errors', () => {
      const error = Object.assign(new Error('invalid parameter'), {status: 400});
      expect(isContextWindowError(error)).toBe(false);
    });
  });

  describe('extractRetryAfter', () => {
    it('should extract retry-after from plain headers object', () => {
      const error = {headers: {'retry-after': '10'}};
      expect(extractRetryAfter(error)).toBe(10_000);
    });

    it('should extract retry-after from Headers-like object with get()', () => {
      const error = {
        headers: {
          get(name: string) {
            return name === 'retry-after' ? '15' : null;
          },
        },
      };
      expect(extractRetryAfter(error)).toBe(15_000);
    });

    it('should extract retry-after from nested response.headers', () => {
      const error = {response: {headers: {'retry-after': '20'}}};
      expect(extractRetryAfter(error)).toBe(20_000);
    });

    it('should return undefined when retry-after exceeds 60s cap', () => {
      const error = {headers: {'retry-after': '120'}};
      expect(extractRetryAfter(error)).toBeUndefined();
    });

    it('should return undefined for errors without headers', () => {
      expect(extractRetryAfter(new Error('rate limit'))).toBeUndefined();
    });

    it('should return undefined for null/undefined', () => {
      expect(extractRetryAfter(null)).toBeUndefined();
      expect(extractRetryAfter(undefined)).toBeUndefined();
    });
  });

  describe('computeRetryDelay', () => {
    it('should use retry-after when within cap', () => {
      expect(computeRetryDelay(1, 5000)).toBe(5000);
    });

    it('should ignore retry-after that exceeds 60s cap', () => {
      const delay = computeRetryDelay(1, 90_000);
      // Should fall back to exponential: ~500ms + jitter
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThan(700); // 500 + 25% jitter max = 625
    });

    it('should produce exponential backoff: attempt 1 ~ 500ms', () => {
      const delay = computeRetryDelay(1);
      expect(delay).toBeGreaterThanOrEqual(500);
      expect(delay).toBeLessThan(700);
    });

    it('should produce exponential backoff: attempt 2 ~ 1000ms', () => {
      const delay = computeRetryDelay(2);
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThan(1300);
    });

    it('should produce exponential backoff: attempt 3 ~ 2000ms', () => {
      const delay = computeRetryDelay(3);
      expect(delay).toBeGreaterThanOrEqual(2000);
      expect(delay).toBeLessThan(2600);
    });

    it('should cap at 32s for very high attempts', () => {
      const delay = computeRetryDelay(20);
      expect(delay).toBeGreaterThanOrEqual(32_000);
      expect(delay).toBeLessThanOrEqual(40_000); // 32000 + 25% jitter
    });
  });

  describe('RecoveryState', () => {
    it('should initialize with all flags cleared', () => {
      const state = createRecoveryState();
      expect(state.compactionAttempts).toBe(0);
      expect(state.cheapDrainAttempted).toBe(false);
      expect(state.maxOutputTokensRecoveryCount).toBe(0);
      expect(state.rateLimitAttempt).toBe(0);
      expect(state.transientRetried).toBe(false);
      expect(state.cumulativeTokensUsed).toBe(0);
    });

    it('should reset only per-turn flags', () => {
      const state = createRecoveryState();
      state.rateLimitAttempt = 3;
      state.transientRetried = true;
      state.compactionAttempts = 2;
      state.cheapDrainAttempted = true;
      state.maxOutputTokensRecoveryCount = 1;
      state.cumulativeTokensUsed = 50_000;

      resetPerTurnFlags(state);

      // Per-turn flags reset
      expect(state.rateLimitAttempt).toBe(0);
      expect(state.transientRetried).toBe(false);

      // Cross-turn flags preserved
      expect(state.compactionAttempts).toBe(2);
      expect(state.cheapDrainAttempted).toBe(true);
      expect(state.maxOutputTokensRecoveryCount).toBe(1);
      expect(state.cumulativeTokensUsed).toBe(50_000);
    });
  });

  describe('MAX_OUTPUT_TOKENS_RECOVERY_LIMIT', () => {
    it('should be 3 (aligned with Claude Code)', () => {
      expect(MAX_OUTPUT_TOKENS_RECOVERY_LIMIT).toBe(3);
    });
  });
});
