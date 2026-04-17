/**
 * Helpers used by {@link useCliController} to keep the hook file focused on
 * composition rather than plumbing.
 *
 * `make*Setter` factories build React setters that also write through to
 * the external store (so synchronous callbacks always read fresh values).
 * `buildInteractionHelpers` produces the scheduler/notice/error helpers that
 * the composed hooks consume.
 *
 * @module
 */
import {randomUUID} from 'node:crypto';
import type React from 'react';
import type {CliInteractionScheduler, QueuedReviewResponseInteraction} from './interaction-scheduler';
import {resolveInteractionStateSnapshot} from './interaction-queue';
import type {CliStore} from './store';
import type {
  CliActiveTurn,
  CliInteractionKind,
  CliInteractionState,
  CliNotice,
  CliReviewState,
  CliRunState,
} from './view-state';
import {appendUniqueNotices} from './controller-logic';

export function makeReviewSetter(
  store: CliStore,
  setReact: React.Dispatch<React.SetStateAction<CliReviewState | undefined>>,
) {
  return (input: CliReviewState | undefined | ((current: CliReviewState | undefined) => CliReviewState | undefined)) => {
    const next = typeof input === 'function'
      ? (input as (current: CliReviewState | undefined) => CliReviewState | undefined)(store.getState().review)
      : input;
    store.patch({review: next});
    setReact(next);
  };
}

export function makeActiveTurnSetter(
  store: CliStore,
  setReact: React.Dispatch<React.SetStateAction<CliActiveTurn | undefined>>,
) {
  return (input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined)) => {
    const next = typeof input === 'function'
      ? (input as (current: CliActiveTurn | undefined) => CliActiveTurn | undefined)(store.getState().activeTurn)
      : input;
    store.patch({activeTurn: next});
    setReact(next);
  };
}

export function makeRunStateSetter(
  store: CliStore,
  setReact: React.Dispatch<React.SetStateAction<CliRunState>>,
) {
  return (input: CliRunState | ((current: CliRunState) => CliRunState)) => {
    const next = typeof input === 'function' ? input(store.getState().runState) : input;
    store.patch({runState: next});
    setReact(next);
  };
}

export interface InteractionHelpers {
  syncInteractionState: () => void;
  beginInteraction: (kind: CliInteractionKind) => void;
  endInteraction: () => void;
  enqueueSessionPrompt: (prompt: string) => void;
  enqueueReviewResponse: (interaction: Omit<QueuedReviewResponseInteraction, 'kind'>) => void;
  appendNotice: (level: CliNotice['level'], content: string) => void;
  flushPendingBackgroundNotices: () => void;
  reportError: (error: unknown) => string;
}

export function buildInteractionHelpers(input: {
  store: CliStore;
  interactionScheduler: CliInteractionScheduler;
  setInteractionState: React.Dispatch<React.SetStateAction<CliInteractionState>>;
  setNotices: React.Dispatch<React.SetStateAction<CliNotice[]>>;
  setActiveTurn: (value: CliActiveTurn | undefined) => void;
  setRunState: (value: CliRunState) => void;
}): InteractionHelpers {
  const {store, interactionScheduler, setInteractionState, setNotices, setActiveTurn, setRunState} = input;

  const syncInteractionState = () => {
    setInteractionState((current) =>
      resolveInteractionStateSnapshot(current, interactionScheduler, store.getState().review),
    );
  };

  const appendNotice = (level: CliNotice['level'], content: string) => {
    const message = content.trim();
    if (!message) return;
    setNotices((current) => [
      ...current,
      {id: `${level}-${randomUUID()}`, level, content: message},
    ]);
  };

  const flushPendingBackgroundNotices = () => {
    const s = store.getState();
    if (s.pendingBackgroundNotices.length === 0) return;
    const queued = s.pendingBackgroundNotices;
    store.patch({pendingBackgroundNotices: []});
    setNotices((current) => appendUniqueNotices(current, queued));
  };

  return {
    syncInteractionState,
    beginInteraction: (kind) => {
      interactionScheduler.begin(kind);
      syncInteractionState();
    },
    endInteraction: () => {
      interactionScheduler.end();
      syncInteractionState();
    },
    enqueueSessionPrompt: (prompt) => {
      interactionScheduler.enqueueSessionPrompt(prompt);
      syncInteractionState();
    },
    enqueueReviewResponse: (interaction) => {
      interactionScheduler.enqueueReviewResponse(interaction);
      syncInteractionState();
    },
    appendNotice,
    flushPendingBackgroundNotices,
    reportError: (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setRunState({status: 'error', error: message});
      setActiveTurn(undefined);
      appendNotice('error', message);
      return message;
    },
  };
}
