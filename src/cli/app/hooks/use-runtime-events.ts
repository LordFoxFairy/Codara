/**
 * Hook: useRuntimeEvents
 *
 * Subscribes to Codara runtime events, processes them through the event router,
 * and applies all side effects (agent count, notices, refresh strategy, etc.).
 */
import {useCallback, useEffect, useState} from 'react';
import type {Codara, CodaraRuntimeEvent, ReviewRequest} from '@/index';
import type {BaseMessage} from '@langchain/core/messages';
import {computeRuntimeEventEffects} from '../cli-event-router';
import {appendRuntimeEventPreservingOpenStarts, appendUniqueNotices} from '../cli-controller-logic';
import type {CliInteractionScheduler} from '../interaction-scheduler';
import type {CliEvent} from '../../store/actions';
import type {
  CliActiveTurn,
  CliNotice,
  CliRunState,
} from '../view-state';

export interface RuntimeEventsDeps {
  codara: Codara;
  interactionScheduler: CliInteractionScheduler;
  setActiveTurn: (input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined)) => void;
  setNotices: React.Dispatch<React.SetStateAction<CliNotice[]>>;
  setRunningAgentCount: React.Dispatch<React.SetStateAction<number>>;
  setRunState: React.Dispatch<React.SetStateAction<CliRunState>>;
  pendingBackgroundNoticesRef: React.MutableRefObject<CliNotice[]>;
  dispatchEvent: (event: CliEvent) => void;
  endInteraction: () => void;
  refreshAuxiliaryState: () => void;
  refreshCoreState: () => Promise<{status: string; pendingReview?: ReviewRequest; messages: readonly BaseMessage[]}>;
  refreshCoreStateUntilPromptSettles: () => Promise<boolean>;
  settleRunningPromptTurnIfReady: (messages?: readonly BaseMessage[]) => boolean;
  drainScheduledInteractions: () => void;
}

export interface RuntimeEventsResult {
  runtimeEvents: readonly CodaraRuntimeEvent[];
  latestRuntimeEvent: CodaraRuntimeEvent | undefined;
}

export function useRuntimeEvents(deps: RuntimeEventsDeps): RuntimeEventsResult {
  const {
    codara,
    interactionScheduler,
    setActiveTurn,
    setNotices,
    setRunningAgentCount,
    setRunState,
    pendingBackgroundNoticesRef,
    dispatchEvent,
    endInteraction,
    refreshAuxiliaryState,
    refreshCoreState,
    refreshCoreStateUntilPromptSettles,
    settleRunningPromptTurnIfReady,
    drainScheduledInteractions,
  } = deps;

  const [runtimeEvents, setRuntimeEvents] = useState<readonly CodaraRuntimeEvent[]>([]);

  useEffect(() => {
    setRuntimeEvents([]);
    return codara.subscribeRuntimeEvents((event: CodaraRuntimeEvent) => {
      const effects = computeRuntimeEventEffects({
        event,
        currentRuntimeEvents: [],
        interactionRunning: interactionScheduler.isRunning(),
      });

      // Apply agent count delta
      if (effects.agentCountDelta !== 0) {
        const delta = effects.agentCountDelta;
        setRunningAgentCount((count) => Math.max(0, count + delta));
        if (delta > 0) dispatchEvent({type: 'SUBAGENT_LAUNCHED'});
        else dispatchEvent({type: 'SUBAGENT_COMPLETED'});
      }

      // Update runtime events via setter to get latest state
      setRuntimeEvents((current) => appendRuntimeEventPreservingOpenStarts(current, event));

      // Seal active turn if needed
      if (effects.sealedActiveTurn) {
        setActiveTurn(effects.sealedActiveTurn);
      }

      // Apply notices
      if (effects.immediateNotices.length > 0) {
        setNotices((current) => appendUniqueNotices(current, effects.immediateNotices));
      }
      if (effects.queuedNotices.length > 0) {
        pendingBackgroundNoticesRef.current = appendUniqueNotices(
          pendingBackgroundNoticesRef.current,
          effects.queuedNotices,
        );
      }

      // Handle foreground subagent review interrupt
      if (effects.foregroundSubagentReview) {
        endInteraction();
        setRunState({status: 'paused'});
        refreshAuxiliaryState();
        return;
      }

      // Apply refresh strategy
      if (effects.refreshStrategy.kind === 'core_then_settle') {
        const agentPhase = effects.refreshStrategy.agentPhase;
        void refreshCoreState()
          .then((nextAgentState) => {
            const settled = settleRunningPromptTurnIfReady(nextAgentState.messages);
            if (!settled && agentPhase === 'end') {
              void refreshCoreStateUntilPromptSettles();
            }
            return nextAgentState;
          })
          .catch(() => {
            refreshAuxiliaryState();
          });
      } else if (effects.refreshStrategy.kind === 'auxiliary_only') {
        refreshAuxiliaryState();
      }

      // Drain interactions on agent events
      if (effects.shouldDrainInteractions) {
        queueMicrotask(() => {
          drainScheduledInteractions();
        });
      }
    });
  }, [codara, drainScheduledInteractions, endInteraction, interactionScheduler, refreshAuxiliaryState, refreshCoreState, refreshCoreStateUntilPromptSettles, setActiveTurn, settleRunningPromptTurnIfReady, setNotices, setRunningAgentCount, setRunState, pendingBackgroundNoticesRef, dispatchEvent]);

  return {
    runtimeEvents,
    latestRuntimeEvent: runtimeEvents[runtimeEvents.length - 1],
  };
}
