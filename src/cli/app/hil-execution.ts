import {AIMessageChunk} from '@langchain/core/messages';
import {isPermissionReviewState, prepareCliHilSubmission, type CliHilAutoAction} from './hil-review';
import type {CliHilReviewState, CliNotice, CliRunState} from './view-state';

type CliHilResumePayload = NonNullable<ReturnType<typeof prepareCliHilSubmission>['payload']>;
type CliHilRefreshResult = {status: string; pendingPause?: unknown};

export interface RunCliHilExecutionInput {
  review: CliHilReviewState | undefined;
  autoAction?: CliHilAutoAction;
  isRunning: boolean;
  setHilReview: (review: CliHilReviewState | undefined) => void;
  setRunState: (state: CliRunState) => void;
  appendNotice: (level: CliNotice['level'], content: string) => void;
  streamResumePause: (payload: CliHilResumePayload) => AsyncIterable<unknown>;
  appendResumeText: (text: string) => void;
  clearActiveTurn: () => void;
  refreshCoreState: () => Promise<CliHilRefreshResult>;
  syncHilReviewFromPause: (pendingPause: unknown) => void;
  reportError: (error: unknown) => string;
}

export interface RunCliHilExecutionResult {
  started: boolean;
  pausedForMoreInput?: boolean;
}

function resolveSelectedHilActionLabel(
  review: CliHilReviewState,
  autoAction?: CliHilAutoAction,
): string | undefined {
  const selectedAction = autoAction
    ? review.actions.find((action) => action.id.toLowerCase() === autoAction.action.trim().toLowerCase())
    : review.actions[review.selectedActionIndex];
  return selectedAction?.label ?? autoAction?.action ?? 'resume';
}

// 这里专门收 HIL action 的整条执行链。
// controller 只保留运行锁和依赖注入，不再把准备、恢复流、刷新、报错全塞进一个 callback。
export async function runCliHilExecution(input: RunCliHilExecutionInput): Promise<RunCliHilExecutionResult> {
  const review = input.review;
  if (!review || input.isRunning) {
    return {started: false};
  }

  const prepared = prepareCliHilSubmission(review, input.autoAction);
  if (!prepared.payload) {
    input.setHilReview(prepared.review);
    input.setRunState({status: 'paused'});
    return {
      started: true,
      pausedForMoreInput: true,
    };
  }

  input.setRunState({status: 'running'});
  input.setHilReview(undefined);

  try {
    if (!prepared.review.form && !isPermissionReviewState(prepared.review)) {
      input.appendNotice('system', `HIL action: ${resolveSelectedHilActionLabel(prepared.review, input.autoAction)}`);
    }

    for await (const chunk of input.streamResumePause(prepared.payload)) {
      if (!AIMessageChunk.isInstance(chunk)) {
        continue;
      }

      const text = chunk.text;
      if (text) {
        input.appendResumeText(text);
      }
    }

    input.clearActiveTurn();
    const nextAgentState = await input.refreshCoreState();
    input.syncHilReviewFromPause(nextAgentState.pendingPause);
    input.setRunState(nextAgentState.status === 'paused' ? {status: 'paused'} : {status: 'done'});
  } catch (error) {
    input.reportError(error);
    await input.refreshCoreState().catch(() => undefined);
  }

  return {started: true};
}
