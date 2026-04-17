/**
 * Review machine action factories.
 *
 * Builds the heavy async callbacks used by `useReviewMachine`:
 *   - `createSubmitReviewAction` — drives the full submit/stream/resume flow.
 *   - `createRunQueuedReviewResponse` — drains a queued review response.
 *   - `createSuppressSettlingDismissedReview` — hides reviews mid-dismissal.
 *
 * The factories accept a `deps` bundle (codara facade, scheduler, store,
 * state setters, lifecycle hooks) and return plain functions. This keeps the
 * hook itself small and makes the imperative logic testable in isolation.
 */
import type {Codara, ReviewRequest} from '@/index';
import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import {
  activateCliReviewFocusedSelection,
  advanceCliReviewToNextStep,
  isPermissionReviewState,
  prepareCliReviewSubmission,
  resolveCliReviewFocusedFooterAction,
  type CliReviewAutoAction,
} from './state-core';
import {appendInteractionText} from '../../app/interaction-turn';
import type {
  CliInteractionScheduler,
  QueuedReviewResponseInteraction,
} from '../../app/interaction-scheduler';
import {readCliReviewProjection, syncProjectedReview} from '../../app/runtime-projection';
import {
  deriveRunStateFromAgentState,
  waitForForegroundReviewResumeReady,
  REVIEW_QUEUE_HANDOFF_TIMEOUT_MS,
  REVIEW_QUEUE_HANDOFF_POLL_MS,
} from '../../app/controller-logic';
import type {CliStore} from '../../app/store';
import type {
  CliActiveTurn,
  CliInteractionKind,
  CliNotice,
  CliReviewState,
  CliRunState,
} from '../../app/view-state';

export interface ReviewActionDeps {
  codara: Codara;
  interactionScheduler: CliInteractionScheduler;
  store: CliStore;
  review: CliReviewState | undefined;
  setReviewState: (input: CliReviewState | undefined | ((current: CliReviewState | undefined) => CliReviewState | undefined)) => void;
  setActiveTurn: (input: CliActiveTurn | undefined | ((current: CliActiveTurn | undefined) => CliActiveTurn | undefined)) => void;
  setRunState: (input: CliRunState | ((current: CliRunState) => CliRunState)) => void;
  beginInteraction: (kind: CliInteractionKind) => void;
  endInteraction: () => void;
  enqueueReviewResponse: (interaction: Omit<QueuedReviewResponseInteraction, 'kind'>) => void;
  syncInteractionState: () => void;
  refreshCoreState: () => Promise<{status: string; pendingReview?: ReviewRequest; messages: readonly BaseMessage[]}>;
  appendNotice: (level: CliNotice['level'], content: string) => void;
  reportError: (error: unknown) => string;
  drainScheduledInteractions: () => void;
  settlingDismissedReviewIdRef: {current: string | undefined};
}

export function createSuppressSettlingDismissedReview(deps: Pick<ReviewActionDeps, 'codara' | 'settlingDismissedReviewIdRef'>) {
  return (
    candidate: CliReviewState | undefined,
    pendingReview?: ReviewRequest,
  ): CliReviewState | undefined => {
    const settlingReviewId = deps.settlingDismissedReviewIdRef.current;
    if (!settlingReviewId) {
      return candidate;
    }

    const stillPresent = (
      deps.codara.listReviewItems().some((item) => item.reviewId === settlingReviewId)
      || pendingReview?.id === settlingReviewId
    );

    if (!stillPresent) {
      deps.settlingDismissedReviewIdRef.current = undefined;
      return candidate;
    }

    if (candidate?.request.id === settlingReviewId) {
      return undefined;
    }

    return candidate;
  };
}

export function createRunQueuedReviewResponse(deps: ReviewActionDeps) {
  return async (interaction: QueuedReviewResponseInteraction): Promise<boolean> => {
    const {
      codara,
      interactionScheduler,
      setRunState,
      syncInteractionState,
      beginInteraction,
      endInteraction,
      refreshCoreState,
      setActiveTurn,
      reportError,
    } = deps;

    const nextAgentState = await refreshCoreState();
    const activeForegroundReview = nextAgentState.pendingReview;
    if (activeForegroundReview && activeForegroundReview.id !== interaction.reviewId) {
      interactionScheduler.requeueInteraction(interaction);
      setRunState({status: 'paused'});
      syncInteractionState();
      return false;
    }

    const queuedReviewStillExists = codara.listReviewItems().some((review) => review.reviewId === interaction.reviewId);
    if (!queuedReviewStillExists && activeForegroundReview?.id !== interaction.reviewId) {
      setRunState(deriveRunStateFromAgentState(nextAgentState));
      syncInteractionState();
      return true;
    }

    beginInteraction('review_response');
    setRunState({status: 'running', phase: 'review_resume'});

    try {
      await waitForForegroundReviewResumeReady(codara, interaction.reviewId, refreshCoreState);
      await codara.focusReview(interaction.reviewId);

      const resumeStream = codara.streamInteraction({
        kind: 'review',
        payload: interaction.payload,
        config: {streamMode: 'messages'},
      });
      for await (const chunk of resumeStream) {
        if (!AIMessageChunk.isInstance(chunk)) {
          continue;
        }
        const text = chunk.text;
        if (text) {
          setActiveTurn((current) => appendInteractionText(current, text, {
            id: `turn-resume-${Date.now()}`,
            prompt: '',
            responseRole: 'assistant',
          }));
        }
      }

      setActiveTurn(undefined);
      const postAgentState = await refreshCoreState();
      setRunState(postAgentState.pendingReview || postAgentState.status === 'paused'
        ? {status: 'paused'}
        : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      endInteraction();
    }
    return true;
  };
}

export function createSubmitReviewAction(deps: ReviewActionDeps) {
  return async (autoAction?: CliReviewAutoAction): Promise<void> => {
    const {
      appendNotice,
      beginInteraction,
      codara,
      drainScheduledInteractions,
      endInteraction,
      enqueueReviewResponse,
      interactionScheduler,
      refreshCoreState,
      reportError,
      review,
      store,
      setActiveTurn,
      setReviewState,
      setRunState,
      syncInteractionState,
      settlingDismissedReviewIdRef,
    } = deps;

    const currentReview = store.getState().review ?? review;
    if (!currentReview) {
      return;
    }

    if (!autoAction && currentReview.form && currentReview.focus !== 'actions') {
      const activated = activateCliReviewFocusedSelection(currentReview);
      if (activated) {
        setReviewState(activated);
        setRunState({status: 'paused'});
      }
      return;
    }

    if (!autoAction && currentReview.form && !currentReview.form.endStep && currentReview.focus === 'actions') {
      const footerAction = resolveCliReviewFocusedFooterAction(currentReview);
      if (footerAction?.id === 'next') {
        const advanced = advanceCliReviewToNextStep(currentReview);
        setReviewState(advanced);
        setRunState({status: 'paused'});
        return;
      }
    }

    const prepared = prepareCliReviewSubmission(currentReview, autoAction);
    if (!prepared.payload) {
      setReviewState(prepared.review);
      setRunState({status: 'paused'});
      return;
    }

    const focusedReview = codara.getFocusedReview();
    const reviewMatchesCurrentReview = focusedReview?.request.id === prepared.review.request.id;

    if (interactionScheduler.isRunning()) {
      const busyReview = {...prepared.review, busy: true};
      setReviewState(busyReview);
      enqueueReviewResponse({
        reviewId: prepared.review.request.id,
        payload: prepared.payload,
      });
      return;
    }

    beginInteraction('review_response');
    setRunState({status: 'running', phase: 'review_resume'});

    try {
      const selectedAction = autoAction
        ? prepared.review.actions.find((action) => action.id.toLowerCase() === autoAction.action.trim().toLowerCase())
        : prepared.review.actions[prepared.review.selectedActionIndex];
      if (!prepared.review.form && !isPermissionReviewState(prepared.review)) {
        appendNotice('system', `Review action: ${selectedAction?.label ?? autoAction?.action ?? 'resume'}`);
      }

      if (reviewMatchesCurrentReview) {
        const queuedReviewCount = codara.listReviewItems().length;
        if (queuedReviewCount <= 1) {
          settlingDismissedReviewIdRef.current = prepared.review.request.id;
          setReviewState(undefined);
          syncInteractionState();

          const resumeStream = codara.streamInteraction({
            kind: 'review',
            payload: prepared.payload,
            config: {streamMode: 'messages'},
          });
          for await (const chunk of resumeStream) {
            if (!AIMessageChunk.isInstance(chunk)) {
              continue;
            }
            const text = chunk.text;
            if (text) {
              setActiveTurn((current) => appendInteractionText(current, text, {
                id: `turn-review-${Date.now()}`,
                prompt: '',
                responseRole: 'assistant',
              }));
            }
          }

          setActiveTurn(undefined);
          const nextAgentState = await refreshCoreState();
          setRunState(nextAgentState.pendingReview || nextAgentState.status === 'paused'
            ? {status: 'paused'}
            : {status: 'done'});
          return;
        }

        const s = store.getState();
        const busyReview = s.review?.request.id === prepared.review.request.id
          ? {...s.review, busy: true}
          : {...prepared.review, busy: true};
        setReviewState(busyReview);
        void (async () => {
          try {
            const currentReviewId = prepared.review.request.id;
            void codara.resumeReview(prepared.payload, {streamMode: 'messages'}).catch((error) => {
              reportError(error);
            });

            const deadline = Date.now() + REVIEW_QUEUE_HANDOFF_TIMEOUT_MS;
            while (Date.now() <= deadline) {
              const nextAgentState = await refreshCoreState();
              const reviews = codara.listReviewItems();
              const activeReviewRequest = readCliReviewProjection(codara, {
                pendingReview: nextAgentState.pendingReview,
              }).activeReviewRequest;
              const stillShowingCurrent = reviews.some((review) => review.reviewId === currentReviewId);
              if (!stillShowingCurrent) {
                const s2 = store.getState();
                const nextReview = syncProjectedReview(codara, s2.review, {pendingReview: activeReviewRequest});
                setReviewState(nextReview);
                syncInteractionState();
                setRunState(deriveRunStateFromAgentState(nextAgentState));
                return;
              }
              await new Promise((resolve) => setTimeout(resolve, REVIEW_QUEUE_HANDOFF_POLL_MS));
            }

            const nextAgentState = await refreshCoreState();
            setRunState(deriveRunStateFromAgentState(nextAgentState));
          } catch (error) {
            reportError(error);
            await refreshCoreState().catch(() => undefined);
          } finally {
            endInteraction();
            drainScheduledInteractions();
          }
        })();
        return;
      }

      await waitForForegroundReviewResumeReady(codara, prepared.review.request.id, refreshCoreState);
      await codara.focusReview(prepared.review.request.id);
      const resumeStream = codara.streamInteraction({
        kind: 'review',
        payload: prepared.payload,
        config: {streamMode: 'messages'},
      });
      for await (const chunk of resumeStream) {
        if (!AIMessageChunk.isInstance(chunk)) continue;
        const text = chunk.text;
        if (text) {
          setActiveTurn((current) => appendInteractionText(current, text, {
            id: `turn-resume-${Date.now()}`,
            prompt: '',
            responseRole: 'assistant',
          }));
        }
      }

      setActiveTurn(undefined);
      const nextAgentState = await refreshCoreState();
      setRunState(nextAgentState.pendingReview || nextAgentState.status === 'paused'
        ? {status: 'paused'}
        : {status: 'done'});
    } catch (error) {
      reportError(error);
      await refreshCoreState().catch(() => undefined);
    } finally {
      endInteraction();
      drainScheduledInteractions();
    }
  };
}
