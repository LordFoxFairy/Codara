import {describe, test, expect} from 'bun:test';
import {
  MAX_DELEGATION_DEPTH,
  assertDelegationDepth,
} from '@core/agent/run/delegation';

describe('Task delegation depth limit', () => {
  test('MAX_DELEGATION_DEPTH is 1', () => {
    expect(MAX_DELEGATION_DEPTH).toBe(1);
  });

  test('assertDelegationDepth does not throw at depth 0', () => {
    expect(() => assertDelegationDepth(0)).not.toThrow();
  });

  test('assertDelegationDepth throws at MAX_DELEGATION_DEPTH', () => {
    expect(() => assertDelegationDepth(MAX_DELEGATION_DEPTH)).toThrow(
      /delegation depth limit/i,
    );
  });

  test('assertDelegationDepth throws above MAX_DELEGATION_DEPTH', () => {
    expect(() => assertDelegationDepth(MAX_DELEGATION_DEPTH + 1)).toThrow(
      /delegation depth limit/i,
    );
  });

  test('assertDelegationDepth treats undefined as 0', () => {
    expect(() => assertDelegationDepth(undefined)).not.toThrow();
  });
});
