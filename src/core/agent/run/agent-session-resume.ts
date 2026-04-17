/**
 * Review-resume helpers for AgentSession.
 *
 * These were previously private methods on the class; extracted to module
 * scope so the class itself remains focused on orchestration.
 *
 * @module
 */

import {type ToolCall} from '@langchain/core/messages';
import type {AgentInput, AgentResult, ReviewRequest} from '../agent-types';
import {findPauseMessageIndex, normalizeAgentInput} from './agent-input';
import {createTurnContext, type AgentRunContext, type AgentRuntime} from './agent-runtime';
import {runLoop} from './agent-loop';
import {finishTurn, runTools} from './turn';
import type {createStreamWriter} from './stream';

export function prepareResumeRun(run: AgentRunContext, review: ReviewRequest): number {
  const pauseMessageIndex = findPauseMessageIndex(run.state.messages, review);
  if (pauseMessageIndex >= 0) {
    run.state.messages.splice(pauseMessageIndex, 1);
    return pauseMessageIndex;
  }
  return run.state.messages.length;
}

export async function appendRunInput(
  run: AgentRunContext,
  input: AgentInput,
  stream?: ReturnType<typeof createStreamWriter>,
): Promise<void> {
  const appended = normalizeAgentInput(input);
  if (appended.length === 0) return;
  run.state.messages.push(...appended);
  if (stream) {
    await stream.emitValues(run.state.messages);
  }
}

export async function continueFromPausedTool(
  run: AgentRunContext,
  runtime: AgentRuntime,
  review: ReviewRequest,
  input: AgentInput,
  stream?: ReturnType<typeof createStreamWriter>,
): Promise<AgentResult> {
  run.state.pendingReview = undefined;
  const toolContext = await createTurnContext(run, runtime, 1, `${run.runId}:resume-tool`);
  const pausedToolCall: ToolCall = {
    id: review.action.toolCallId,
    name: review.action.toolName,
    args: review.action.toolArgs ?? {},
  };
  await runTools(run, runtime, toolContext, [pausedToolCall], stream);
  await appendRunInput(run, input, stream);

  if (run.state.pendingReview) {
    await finishTurn(runtime, toolContext, {reason: 'complete', turns: 1});
    return {reason: 'complete', state: run.state, turns: 1};
  }

  await finishTurn(runtime, toolContext, {reason: 'continue', turns: 1});
  return runLoop(run, runtime, stream, 2);
}
