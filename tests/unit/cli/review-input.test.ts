import {describe, expect, it} from 'bun:test';
import {resolveReviewInputAction} from '../../../src/cli/features/review/input-action';

describe('cli review input shortcuts', () => {
  it('should map bracket keys to review queue navigation', () => {
    expect(resolveReviewInputAction('[', {})).toBe('select-previous-review');
    expect(resolveReviewInputAction(']', {})).toBe('select-next-review');
  });

  it('should use Tab and Shift+Tab to navigate AskUser selections', () => {
    expect(resolveReviewInputAction('\t', {tab: true})).toBe('select-next');
    expect(resolveReviewInputAction('\t', {tab: true, shift: true})).toBe('select-previous');
  });

  it('should keep permission-stage shortcuts explicit', () => {
    expect(resolveReviewInputAction('', {escape: true}, 'always-confirm')).toBe('permission-back');
    expect(resolveReviewInputAction('\r', {return: true}, 'always-confirm')).toBe('permission-confirm');
    expect(resolveReviewInputAction('', {escape: true}, 'reject-feedback')).toBe('permission-reject-silent');
    expect(resolveReviewInputAction('\r', {return: true}, 'reject-feedback')).toBe('permission-reject-send');
  });

  it('should treat space as selection activation during AskUser reviews', () => {
    expect(resolveReviewInputAction(' ', {})).toBe('activate-selection');
  });

  it('should allow spaces to be typed when the review is editing free text', () => {
    expect(resolveReviewInputAction(' ', {}, undefined, true)).toBe('insert-text');
  });
});
