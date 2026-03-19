export interface CliInputHistoryState {
  entries: readonly string[];
  browsingIndex?: number;
  draftText: string;
}

const CLI_INPUT_HISTORY_LIMIT = 100;

export function createCliInputHistoryState(): CliInputHistoryState {
  return {
    entries: [],
    browsingIndex: undefined,
    draftText: '',
  };
}

export function recordCliInputHistoryEntry(
  state: CliInputHistoryState,
  text: string,
): CliInputHistoryState {
  if (!text.trim()) {
    return clearCliInputHistoryBrowse(state);
  }

  const lastEntry = state.entries[state.entries.length - 1];
  if (lastEntry === text) {
    return clearCliInputHistoryBrowse(state);
  }

  const nextEntries = [...state.entries, text].slice(-CLI_INPUT_HISTORY_LIMIT);
  return {
    entries: nextEntries,
    browsingIndex: undefined,
    draftText: '',
  };
}

export function clearCliInputHistoryBrowse(state: CliInputHistoryState): CliInputHistoryState {
  if (state.browsingIndex === undefined && !state.draftText) {
    return state;
  }

  return {
    ...state,
    browsingIndex: undefined,
    draftText: '',
  };
}

export interface CliInputHistoryRecallResult {
  state: CliInputHistoryState;
  text?: string;
}

// 往前翻历史时，第一次先把当前草稿记住，方便后面一路翻回来。
export function recallPreviousCliInputHistory(
  state: CliInputHistoryState,
  currentText: string,
): CliInputHistoryRecallResult {
  if (state.entries.length === 0) {
    return {state};
  }

  const nextIndex = state.browsingIndex === undefined
    ? state.entries.length - 1
    : Math.max(0, state.browsingIndex - 1);

  return {
    state: {
      entries: state.entries,
      browsingIndex: nextIndex,
      draftText: state.browsingIndex === undefined ? currentText : state.draftText,
    },
    text: state.entries[nextIndex],
  };
}

// 往后翻时，翻到最新一条之后就回到刚才没发出去的草稿。
export function recallNextCliInputHistory(
  state: CliInputHistoryState,
): CliInputHistoryRecallResult {
  if (state.browsingIndex === undefined) {
    return {state};
  }

  const nextIndex = state.browsingIndex + 1;
  if (nextIndex < state.entries.length) {
    return {
      state: {
        ...state,
        browsingIndex: nextIndex,
      },
      text: state.entries[nextIndex],
    };
  }

  return {
    state: {
      entries: state.entries,
      browsingIndex: undefined,
      draftText: '',
    },
    text: state.draftText,
  };
}
