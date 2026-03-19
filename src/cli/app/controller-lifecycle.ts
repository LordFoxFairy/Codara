import {useEffect} from 'react';
import type {Codara, CodaraRuntimeEvent} from '@/index';
import type {MutableRefObject} from 'react';
import type {CliHilReviewState} from './view-state';

export const MAX_CLI_RUNTIME_EVENTS = 40;

export interface UseCliControllerLifecycleInput {
  codara: Pick<Codara, 'dispose' | 'subscribeRuntimeEvents'>;
  hilReview: CliHilReviewState | undefined;
  hilReviewRef: MutableRefObject<CliHilReviewState | undefined>;
  setRuntimeEvents: (
    updater: (current: readonly CodaraRuntimeEvent[]) => readonly CodaraRuntimeEvent[],
  ) => void;
  isRunningRef: MutableRefObject<boolean>;
  refreshCoreState: () => Promise<unknown>;
  reportError: (error: unknown) => string;
  initialPrompt: string;
  initialPromptSentRef: MutableRefObject<boolean>;
  submitPrompt: (prompt: string) => Promise<void>;
}

export function appendCliRuntimeEvent(
  current: readonly CodaraRuntimeEvent[],
  event: CodaraRuntimeEvent,
): readonly CodaraRuntimeEvent[] {
  return [...current, event].slice(-MAX_CLI_RUNTIME_EVENTS);
}

export function shouldAutoSubmitInitialPrompt(initialPrompt: string, alreadySent: boolean): boolean {
  return initialPrompt.trim().length > 0 && !alreadySent;
}

export function useCliControllerLifecycle(input: UseCliControllerLifecycleInput): void {
  useEffect(() => {
    input.hilReviewRef.current = input.hilReview;
  }, [input.hilReview, input.hilReviewRef]);

  useEffect(() => {
    input.setRuntimeEvents(() => []);
    return input.codara.subscribeRuntimeEvents((event) => {
      input.setRuntimeEvents((current) => appendCliRuntimeEvent(current, event));
    });
  }, [input.codara, input.setRuntimeEvents]);

  useEffect(() => {
    return () => {
      input.isRunningRef.current = false;
      void input.codara.dispose().catch(() => undefined);
    };
  }, [input.codara, input.isRunningRef]);

  useEffect(() => {
    void input.refreshCoreState().catch((error) => {
      input.reportError(error);
    });
  }, [input.refreshCoreState, input.reportError]);

  useEffect(() => {
    if (!shouldAutoSubmitInitialPrompt(input.initialPrompt, input.initialPromptSentRef.current)) {
      return;
    }

    input.initialPromptSentRef.current = true;
    void input.submitPrompt(input.initialPrompt);
  }, [input.initialPrompt, input.initialPromptSentRef, input.submitPrompt]);
}
