import {describe, expect, it} from 'bun:test';
import {resolveCliForegroundSurface} from '../../../src/cli/app/shell-app';

describe('CLI foreground surface', () => {
  it('should prioritize HIL over the transcript when a review is active', () => {
    expect(resolveCliForegroundSurface({hasHilReview: true, hasConversation: true})).toBe('hil');
  });

  it('should show the transcript when conversation exists and no review is active', () => {
    expect(resolveCliForegroundSurface({hasHilReview: false, hasConversation: true})).toBe('transcript');
  });

  it('should fall back to the welcome state when there is no conversation or review', () => {
    expect(resolveCliForegroundSurface({hasHilReview: false, hasConversation: false})).toBe('welcome');
  });
});
