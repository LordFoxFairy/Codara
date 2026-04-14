export interface Store<T> {
  getState: () => T;
  setState: (updater: (prev: T) => T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T>(initialState: T, onChange?: (state: T) => void): Store<T> {
  let state = initialState;
  const listeners = new Set<() => void>();

  return {
    getState: () => state,
    setState: (updater: (prev: T) => T) => {
      const next = updater(state);
      if (!Object.is(state, next)) {
        state = next;
        onChange?.(state);
        listeners.forEach(l => l());
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
