import {describe, expect, it} from 'bun:test';
import {isRateLimitError, isTransientError, extractRetryAfter} from '../../../src/core/agent/run/error-recovery';

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

    it('should return default 5000ms for errors without headers', () => {
      expect(extractRetryAfter(new Error('rate limit'))).toBe(5_000);
    });

    it('should return default 5000ms for null/undefined', () => {
      expect(extractRetryAfter(null)).toBe(5_000);
      expect(extractRetryAfter(undefined)).toBe(5_000);
    });
  });
});
