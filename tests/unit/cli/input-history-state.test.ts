import {describe, expect, test} from 'bun:test';
import {
  clearCliInputHistoryBrowse,
  createCliInputHistoryState,
  recallNextCliInputHistory,
  recallPreviousCliInputHistory,
  recordCliInputHistoryEntry,
} from '@/cli/hooks/input-history-state';

describe('cli input history state', () => {
  test('should record non-empty entries and skip consecutive duplicates', () => {
    let state = createCliInputHistoryState();
    state = recordCliInputHistoryEntry(state, '');
    state = recordCliInputHistoryEntry(state, 'first');
    state = recordCliInputHistoryEntry(state, 'first');
    state = recordCliInputHistoryEntry(state, 'second');

    expect(state.entries).toEqual(['first', 'second']);
  });

  test('should remember the unsent draft when entering history browse mode', () => {
    let state = createCliInputHistoryState();
    state = recordCliInputHistoryEntry(state, 'first');
    state = recordCliInputHistoryEntry(state, 'second');

    const recalled = recallPreviousCliInputHistory(state, 'draft now');
    expect(recalled.text).toBe('second');
    expect(recalled.state.browsingIndex).toBe(1);
    expect(recalled.state.draftText).toBe('draft now');
  });

  test('should walk backward through older entries', () => {
    let state = createCliInputHistoryState();
    state = recordCliInputHistoryEntry(state, 'first');
    state = recordCliInputHistoryEntry(state, 'second');
    state = recordCliInputHistoryEntry(state, 'third');

    const latest = recallPreviousCliInputHistory(state, 'draft');
    const previous = recallPreviousCliInputHistory(latest.state, 'ignored');

    expect(latest.text).toBe('third');
    expect(previous.text).toBe('second');
    expect(previous.state.browsingIndex).toBe(1);
  });

  test('should restore the saved draft after moving past the newest history entry', () => {
    let state = createCliInputHistoryState();
    state = recordCliInputHistoryEntry(state, 'first');
    state = recordCliInputHistoryEntry(state, 'second');

    const latest = recallPreviousCliInputHistory(state, 'draft now');
    const restored = recallNextCliInputHistory(latest.state);

    expect(restored.text).toBe('draft now');
    expect(restored.state.browsingIndex).toBeUndefined();
    expect(restored.state.draftText).toBe('');
  });

  test('should leave the history state untouched when there is nothing to browse', () => {
    const state = createCliInputHistoryState();
    const previous = recallPreviousCliInputHistory(state, 'draft');
    const next = recallNextCliInputHistory(state);

    expect(previous.state).toEqual(state);
    expect(previous.text).toBeUndefined();
    expect(next.state).toEqual(state);
    expect(next.text).toBeUndefined();
  });

  test('should clear browse mode after manual editing resumes', () => {
    let state = createCliInputHistoryState();
    state = recordCliInputHistoryEntry(state, 'first');
    state = recallPreviousCliInputHistory(state, 'draft').state;

    expect(clearCliInputHistoryBrowse(state)).toEqual({
      entries: ['first'],
      browsingIndex: undefined,
      draftText: '',
    });
  });
});
