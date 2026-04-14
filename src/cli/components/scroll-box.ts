export interface ScrollState {
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
  isSticky: boolean; // auto-scroll to bottom
}

export function createScrollState(viewportHeight: number): ScrollState {
  return {scrollTop: 0, viewportHeight, contentHeight: 0, isSticky: true};
}

export function scrollDown(state: ScrollState, lines: number): ScrollState {
  const maxScroll = Math.max(0, state.contentHeight - state.viewportHeight);
  const newTop = Math.min(state.scrollTop + lines, maxScroll);
  return {...state, scrollTop: newTop, isSticky: newTop >= maxScroll};
}

export function scrollUp(state: ScrollState, lines: number): ScrollState {
  const newTop = Math.max(0, state.scrollTop - lines);
  return {...state, scrollTop: newTop, isSticky: false};
}

export function setContentHeight(
  state: ScrollState,
  height: number,
): ScrollState {
  const newState = {...state, contentHeight: height};
  if (state.isSticky) {
    newState.scrollTop = Math.max(0, height - state.viewportHeight);
  }
  return newState;
}

export function getVisibleRange(state: ScrollState): {
  start: number;
  end: number;
} {
  return {
    start: state.scrollTop,
    end: Math.min(
      state.scrollTop + state.viewportHeight,
      state.contentHeight,
    ),
  };
}
