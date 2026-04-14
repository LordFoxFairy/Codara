import {describe, expect, it} from 'bun:test';
import {createStore} from '../../../src/cli/store/create-store';
import {createInitialAppState} from '../../../src/cli/store/app-state';

describe('createStore', () => {
  it('should return initial state', () => {
    const store = createStore({count: 0});
    expect(store.getState()).toEqual({count: 0});
  });

  it('should update state', () => {
    const store = createStore({count: 0});
    store.setState(prev => ({...prev, count: 1}));
    expect(store.getState().count).toBe(1);
  });

  it('should not notify when state is identical (Object.is)', () => {
    const state = {count: 0};
    const store = createStore(state);
    let notifications = 0;
    store.subscribe(() => notifications++);
    store.setState(() => state); // Same reference
    expect(notifications).toBe(0);
  });

  it('should notify subscribers on change', () => {
    const store = createStore({count: 0});
    let notifications = 0;
    store.subscribe(() => notifications++);
    store.setState(prev => ({...prev, count: 1}));
    expect(notifications).toBe(1);
  });

  it('should unsubscribe', () => {
    const store = createStore({count: 0});
    let notifications = 0;
    const unsub = store.subscribe(() => notifications++);
    unsub();
    store.setState(prev => ({...prev, count: 1}));
    expect(notifications).toBe(0);
  });

  it('should call onChange callback', () => {
    let changed: unknown;
    const store = createStore({count: 0}, (s) => { changed = s; });
    store.setState(prev => ({...prev, count: 5}));
    expect(changed).toEqual({count: 5});
  });
});

describe('createInitialAppState', () => {
  it('should create initial state with session ID', () => {
    const state = createInitialAppState('test-session');
    expect(state.sessionId).toBe('test-session');
    expect(state.agentStatus).toBe('idle');
    expect(state.messages).toEqual([]);
    expect(state.currentTurn).toBe(0);
  });
});
