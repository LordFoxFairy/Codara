/**
 * CLI Store — external state container for the CLI controller.
 *
 * Inspired by Claude Code's state/store.ts pattern: a lightweight store
 * with getState/setState/subscribe, consumed via useSyncExternalStore.
 *
 * This eliminates "ref bridges" — hooks that need cross-references to each
 * other's functions. Instead, they all read/write the same store, and any
 * code can synchronously read the latest state via store.getState().
 *
 * The store holds:
 * 1. "Current value" refs — state that callbacks need to read synchronously
 *    (reviewRef, activeTurnRef, coreMessagesRef, runStateRef, etc.)
 * 2. "Function bridges" — functions registered by one hook and called by another
 *    (refreshCoreState, drainScheduledInteractions, clearRuntimeEvents)
 * 3. Transient flags — settlingFinalReply, initialCoreStateLoaded, etc.
 */
import type {BaseMessage} from '@langchain/core/messages';
import type {CodaraRuntimeEvent, ReviewRequest} from '@/index';
import type {
  CliActiveTurn,
  CliNotice,
  CliReviewState,
  CliRunState,
} from './view-state';

// ─── Function bridge types ───────────────────────────────────────────
export type RefreshCoreStateFn = () => Promise<{
  status: string;
  pendingReview?: ReviewRequest;
  messages: readonly BaseMessage[];
}>;

export type DrainScheduledInteractionsFn = () => void;

export type ClearRuntimeEventsFn = (
  value: readonly CodaraRuntimeEvent[] | ((prev: readonly CodaraRuntimeEvent[]) => readonly CodaraRuntimeEvent[]),
) => void;

// ─── Store state shape ───────────────────────────────────────────────
export interface CliStoreState {
  // Synchronous "current value" snapshots (replaces useRef)
  review: CliReviewState | undefined;
  activeTurn: CliActiveTurn | undefined;
  coreMessages: readonly BaseMessage[];
  runState: CliRunState;
  promptStartMessageCount: number;
  pendingBackgroundNotices: CliNotice[];
  settlingFinalReply: boolean;
  initialCoreStateLoaded: boolean;

  // Function bridges (replaces ref bridges)
  refreshCoreState: RefreshCoreStateFn;
  drainScheduledInteractions: DrainScheduledInteractionsFn;
  clearRuntimeEvents: ClearRuntimeEventsFn;
}

// ─── Store type ──────────────────────────────────────────────────────
type Listener = () => void;

export interface CliStore {
  getState: () => CliStoreState;
  setState: (updater: (prev: CliStoreState) => CliStoreState) => void;
  /** Patch specific fields without replacing the entire state. */
  patch: (partial: Partial<CliStoreState>) => void;
  subscribe: (listener: Listener) => () => void;
}

// ─── Default state ───────────────────────────────────────────────────
export function getDefaultCliStoreState(): CliStoreState {
  return {
    review: undefined,
    activeTurn: undefined,
    coreMessages: [],
    runState: {status: 'idle'},
    promptStartMessageCount: 0,
    pendingBackgroundNotices: [],
    settlingFinalReply: false,
    initialCoreStateLoaded: false,

    // Stubs — wired by hooks after mount
    refreshCoreState: async () => ({status: 'idle', messages: []}),
    drainScheduledInteractions: () => undefined,
    clearRuntimeEvents: () => {},
  };
}

// ─── Factory ─────────────────────────────────────────────────────────
export function createCliStore(
  initialState?: Partial<CliStoreState>,
): CliStore {
  let state: CliStoreState = {
    ...getDefaultCliStoreState(),
    ...initialState,
  };
  const listeners = new Set<Listener>();

  const store: CliStore = {
    getState: () => state,

    setState: (updater) => {
      const prev = state;
      const next = updater(prev);
      if (Object.is(next, prev)) return;
      state = next;
      for (const listener of listeners) listener();
    },

    patch: (partial) => {
      state = {...state, ...partial};
      for (const listener of listeners) listener();
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return store;
}
