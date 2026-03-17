import {describe, test, expect} from 'bun:test';
import {
  MAX_DELEGATION_DEPTH,
  assertDelegationDepth,
} from '@capability/task/delegation/runtime';

describe('Task delegation depth limit', () => {
  test('MAX_DELEGATION_DEPTH is 5', () => {
    expect(MAX_DELEGATION_DEPTH).toBe(5);
  });

  test('assertDelegationDepth does not throw at depth 0', () => {
    expect(() => assertDelegationDepth(0)).not.toThrow();
  });

  test('assertDelegationDepth does not throw at MAX_DELEGATION_DEPTH - 1', () => {
    expect(() => assertDelegationDepth(MAX_DELEGATION_DEPTH - 1)).not.toThrow();
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
