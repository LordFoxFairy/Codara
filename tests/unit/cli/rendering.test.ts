import {describe, expect, it} from 'bun:test';
import {
  createScrollState,
  scrollDown,
  scrollUp,
  setContentHeight,
  getVisibleRange,
} from '../../../src/cli/components/scroll-box';
import {
  matchKeyBinding,
  DEFAULT_KEY_BINDINGS,
} from '../../../src/cli/rendering/keyboard';
import {StreamBuffer} from '../../../src/cli/rendering/stream-buffer';

describe('ScrollBox', () => {
  it('should create initial state', () => {
    const state = createScrollState(24);
    expect(state.viewportHeight).toBe(24);
    expect(state.isSticky).toBe(true);
  });

  it('should scroll down', () => {
    let state = createScrollState(24);
    state = setContentHeight(state, 100);
    state = scrollDown(state, 10);
    expect(state.scrollTop).toBe(76); // was sticky, so at bottom after setContentHeight: 100-24=76, then +10 capped at 76
  });

  it('should scroll up and unstick', () => {
    let state = createScrollState(24);
    state = setContentHeight(state, 100);
    state = scrollUp(state, 5);
    expect(state.isSticky).toBe(false);
    expect(state.scrollTop).toBe(71); // 76 - 5
  });

  it('should auto-scroll when sticky', () => {
    let state = createScrollState(24);
    state = setContentHeight(state, 50);
    expect(state.scrollTop).toBe(26); // sticky: 50-24
    state = setContentHeight(state, 100);
    expect(state.scrollTop).toBe(76); // sticky: 100-24
  });

  it('should return visible range', () => {
    let state = createScrollState(24);
    state = setContentHeight(state, 100);
    const range = getVisibleRange(state);
    expect(range.start).toBe(76);
    expect(range.end).toBe(100);
  });
});

describe('Keyboard', () => {
  it('should match Ctrl+C to interrupt', () => {
    expect(
      matchKeyBinding(DEFAULT_KEY_BINDINGS, {key: 'c', ctrl: true}),
    ).toBe('interrupt');
  });

  it('should match y to approve', () => {
    expect(matchKeyBinding(DEFAULT_KEY_BINDINGS, {key: 'y'})).toBe('approve');
  });

  it('should return undefined for unbound key', () => {
    expect(
      matchKeyBinding(DEFAULT_KEY_BINDINGS, {key: 'z'}),
    ).toBeUndefined();
  });
});

describe('StreamBuffer', () => {
  it('should accumulate text', () => {
    const buf = new StreamBuffer();
    buf.append('Hello ');
    buf.append('World');
    expect(buf.getText()).toBe('Hello World');
  });

  it('should notify listeners on append', () => {
    const buf = new StreamBuffer();
    const chunks: string[] = [];
    buf.onChunk(c => chunks.push(c));
    buf.append('a');
    buf.append('b');
    expect(chunks).toEqual(['a', 'b']);
  });

  it('should count lines', () => {
    const buf = new StreamBuffer();
    buf.append('line1\nline2\nline3');
    expect(buf.getLineCount()).toBe(3);
  });

  it('should clear', () => {
    const buf = new StreamBuffer();
    buf.append('data');
    buf.clear();
    expect(buf.getText()).toBe('');
  });
});
