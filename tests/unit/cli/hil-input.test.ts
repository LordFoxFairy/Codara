import {describe, expect, it} from 'bun:test';
import {resolveHilInputAction} from '../../../src/cli/hooks/use-hil-input';

describe('cli HIL input shortcuts', () => {
  it('should map bracket keys to approval queue navigation', () => {
    expect(resolveHilInputAction('[', {})).toBe('select-previous-approval');
    expect(resolveHilInputAction(']', {})).toBe('select-next-approval');
  });

  it('should keep permission-stage shortcuts explicit', () => {
    expect(resolveHilInputAction('', {escape: true}, 'always-confirm')).toBe('permission-back');
    expect(resolveHilInputAction('\r', {return: true}, 'always-confirm')).toBe('permission-confirm');
    expect(resolveHilInputAction('', {escape: true}, 'reject-feedback')).toBe('permission-reject-silent');
    expect(resolveHilInputAction('\r', {return: true}, 'reject-feedback')).toBe('permission-reject-send');
  });
});
