/**
 * Interaction stream -- orchestrates prompt/continuation/review streaming
 * with automatic subagent completion follow-through.
 *
 * When a main-session turn launches subagent runs, the stream waits for
 * those runs to complete, injects their results as tool messages, and
 * continues the conversation so the model can summarise or react.
 * Invalid completion responses are retried up to MAX_ATTEMPTS.
 */

import {AIMessage, ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {SubagentCompletionContinuation, SubagentRunManager, SubagentRunStore} from '@capability/subagent';
import {
  createSubagentCompletionToolMessages,
  shouldRetrySubagentCompletionResponse,
} from '@capability/subagent/completion';
import type {Session} from '@durability/session';
import {readMessageText} from '@shared/messages';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import type {AgentResult, AgentRuntimeContext, AgentStreamConfig, AgentStreamOutput} from '@core/agent';
import {TOOL_NAMES} from '@shared/tool-display';
import type {CodaraStreamRequest} from './types';
import type {CodaraReviewControl} from './review-control';

/** Maximum retry attempts for an invalid subagent completion response. */
const SUBAGENT_COMPLETION_MAX_ATTEMPTS = 3;

/** Runtime context injected into continuation turns for subagent completion. */
interface SubagentCompletionRuntimeContext {
  runs: Array<{
    runId: string;
    label: string;
    agentName: string;
    status: 'completed' | 'failed';
    summary?: string;
    errorMessage?: string;
    toolUseCount?: number;
    totalTokens?: number;
  }>;
  attempt?: number;
  previousInvalidResponse?: string;
}

/** Create the `streamInteraction` function bound to a Session + ReviewControl pair. */
export function createCodaraInteractionStream(options: {
  session: Session;
  reviewControl: CodaraReviewControl;
  subagentRunStore?: SubagentRunStore;
  subagentRunManager?: SubagentRunManager;
}): (request: CodaraStreamRequest) => AsyncGenerator<AgentStreamOutput, void, void> {
  const {session, reviewControl, subagentRunStore, subagentRunManager} = options;

  return async function* streamInteraction(request: CodaraStreamRequest) {
    switch (request.kind) {
      case 'prompt':
        yield* streamMainSessionWithSubagentFollowThrough({
          session,
          subagentRunStore,
          subagentRunManager,
          start: () => session.stream(request.input, request.config),
          buildContinuationConfig: (context) => ({
            ...request.config,
            context,
          }),
        });
        return;
      case 'continuation':
        yield* streamMainSessionWithSubagentFollowThrough({
          session,
          subagentRunStore,
          subagentRunManager,
          start: () => session.stream(undefined, {
            ...request.config,
            context: request.context,
          }),
          buildContinuationConfig: (context) => ({
            ...request.config,
            context: mergeContinuationContext(request.context, context),
          }),
        });
        return;
      case 'review':
        yield* streamReviewWithSubagentFollowThrough({
          session,
          subagentRunStore,
          subagentRunManager,
          start: () => reviewControl.streamReview(request.payload, request.config),
          buildContinuationConfig: (context) => ({
            ...request.config,
            context,
          }),
        });
        return;
    }
  };
}

async function* streamMainSessionWithSubagentFollowThrough(input: {
  session: Session;
  subagentRunStore?: SubagentRunStore;
  subagentRunManager?: SubagentRunManager;
  start: () => AsyncGenerator<AgentStreamOutput, AgentResult, void>;
  buildContinuationConfig: (context: AgentRuntimeContext) => Omit<AgentStreamConfig, 'context'> & {context: AgentRuntimeContext};
}): AsyncGenerator<AgentStreamOutput, void, void> {
  yield* streamWithSubagentFollowThrough(input);
}

async function* streamReviewWithSubagentFollowThrough(input: {
  session: Session;
  subagentRunStore?: SubagentRunStore;
  subagentRunManager?: SubagentRunManager;
  start: () => AsyncGenerator<AgentStreamOutput, AgentResult | undefined, void>;
  buildContinuationConfig: (context: AgentRuntimeContext) => Omit<AgentStreamConfig, 'context'> & {context: AgentRuntimeContext};
}): AsyncGenerator<AgentStreamOutput, void, void> {
  yield* streamWithSubagentFollowThrough(input);
}

/**
 * Core loop: stream a session turn, then check for launched subagent batches.
 * If subagents completed, inject their results and continue the session.
 * Retries invalid model responses up to SUBAGENT_COMPLETION_MAX_ATTEMPTS.
 */
async function* streamWithSubagentFollowThrough<T extends AgentResult | undefined>(input: {
  session: Session;
  subagentRunStore?: SubagentRunStore;
  subagentRunManager?: SubagentRunManager;
  start: () => AsyncGenerator<AgentStreamOutput, T, void>;
  buildContinuationConfig: (context: AgentRuntimeContext) => Omit<AgentStreamConfig, 'context'> & {context: AgentRuntimeContext};
}): AsyncGenerator<AgentStreamOutput, void, void> {
  const {session, subagentRunStore, subagentRunManager, start, buildContinuationConfig} = input;
  let execute = start;
  let claimedCompletion: SubagentCompletionContinuation | undefined;
  let completionContext: SubagentCompletionRuntimeContext | undefined;

  while (true) {
    const previousMessageCount = readSessionMessageCount(session);
    let result: T;

    try {
      if (completionContext) {
        const buffered = await collectBufferedAgentStream(execute);
        result = buffered.result;

        if (!result) {
          return;
        }

        const completionRetry = resolveSubagentCompletionRetry({
          result,
          previousMessageCount,
          completionContext,
        });
        if (completionRetry) {
          await pruneInvalidSubagentContinuationMessages(session, result.state.messages, previousMessageCount);
          completionContext = completionRetry.context;
          execute = (() => session.stream(undefined, buildContinuationConfig({
            codaraSubagentCompletion: completionContext,
          }))) as () => AsyncGenerator<AgentStreamOutput, T, void>;
          continue;
        }

        for (const chunk of buffered.chunks) {
          yield chunk;
        }
      } else {
        result = yield* execute();
      }
    } catch (error) {
      if (claimedCompletion) {
        subagentRunStore?.restorePendingCompletion(session.getState().sessionId, claimedCompletion.batchId);
      }
      throw error;
    }

    claimedCompletion = undefined;
    if (!result || !subagentRunStore || result.state.pendingReview) {
      return;
    }

    completionContext = undefined;

    const launchedBatchIds = collectLaunchedSubagentBatchIds({
      messages: result.state.messages.slice(previousMessageCount),
      resultBatchIds: result.launchedSubagentBatchIds,
      subagentRunStore,
    });
    if (launchedBatchIds.length === 0) {
      return;
    }

    claimedCompletion = await waitForSubagentCompletion({
      subagentRunManager,
      subagentRunStore,
      parentSessionId: session.getState().sessionId,
      batchIds: launchedBatchIds,
    });
    if (!claimedCompletion) {
      return;
    }

    const completionMessages = createSubagentCompletionToolMessages(claimedCompletion.runs);
    completionContext = {
      runs: claimedCompletion.runs,
      attempt: 1,
    };
    execute = (() => session.stream({messages: completionMessages}, buildContinuationConfig({
      codaraSubagentCompletion: completionContext,
    }))) as () => AsyncGenerator<AgentStreamOutput, T, void>;
  }
}

/** Determine whether the model's completion response warrants a retry. */
function resolveSubagentCompletionRetry(input: {
  result: AgentResult;
  previousMessageCount: number;
  completionContext: SubagentCompletionRuntimeContext | undefined;
}): {context: SubagentCompletionRuntimeContext} | undefined {
  const {result, previousMessageCount, completionContext} = input;
  if (!completionContext?.runs?.length) {
    return undefined;
  }

  const messages = result.state.messages.slice(previousMessageCount);
  const latestAssistantText = readLatestAssistantMessageText(messages);
  const launchedSubagentToolCall = messages.some((message) => (
    AIMessage.isInstance(message)
    && Array.isArray(message.tool_calls)
    && message.tool_calls.some((toolCall) => toolCall?.name === TOOL_NAMES.AGENT)
  ));

  if (!shouldRetrySubagentCompletionResponse({
    text: latestAssistantText,
    launchedSubagentToolCall,
    attempt: completionContext.attempt ?? 1,
    maxAttempts: SUBAGENT_COMPLETION_MAX_ATTEMPTS,
    runs: completionContext.runs,
  })) {
    return undefined;
  }

  return {
    context: {
      ...completionContext,
      attempt: (completionContext.attempt ?? 1) + 1,
      previousInvalidResponse: latestAssistantText,
    },
  };
}

function readLatestAssistantMessageText(messages: readonly BaseMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && AIMessage.isInstance(message)) {
      const text = readMessageText(message)?.trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

/** Gather batch IDs from both explicit result metadata and tool-message artifacts. */
function collectLaunchedSubagentBatchIds(input: {
  messages: readonly BaseMessage[];
  resultBatchIds?: readonly string[];
  subagentRunStore: SubagentRunStore;
}): string[] {
  const {messages, resultBatchIds, subagentRunStore} = input;
  const batchIds = new Set<string>();

  for (const batchId of resultBatchIds ?? []) {
    if (batchId.trim()) {
      batchIds.add(batchId.trim());
    }
  }

  for (const message of messages) {
    if (!ToolMessage.isInstance(message)) {
      continue;
    }

    const launched = readSubagentRunLaunchResult(message.artifact);
    if (!launched) {
      continue;
    }

    if (launched.batchId) {
      batchIds.add(launched.batchId);
      continue;
    }

    const record = subagentRunStore.get(launched.runId);
    if (record?.batchId) {
      batchIds.add(record.batchId);
    }
  }
  return [...batchIds];
}

/** Block until all subagent batches finish (or claim already-pending results). */
async function waitForSubagentCompletion(input: {
  subagentRunManager?: SubagentRunManager;
  subagentRunStore: SubagentRunStore;
  parentSessionId: string;
  batchIds: readonly string[];
}): Promise<SubagentCompletionContinuation | undefined> {
  const {subagentRunManager, subagentRunStore, parentSessionId, batchIds} = input;
  if (subagentRunManager) {
    return await subagentRunManager.waitForCompletion(parentSessionId, batchIds);
  }

  return subagentRunStore.takePendingCompletion(parentSessionId, batchIds);
}

/** Shallow-merge two runtime contexts, deep-merging the subagent completion key. */
function mergeContinuationContext(
  base: AgentRuntimeContext,
  next: AgentRuntimeContext,
): AgentRuntimeContext {
  return {
    ...base,
    ...next,
    ...(base.codaraSubagentCompletion || next.codaraSubagentCompletion
      ? {
          codaraSubagentCompletion: {
            ...(base.codaraSubagentCompletion ?? {}),
            ...(next.codaraSubagentCompletion ?? {}),
          },
        }
      : {}),
  };
}

function readSessionMessageCount(session: Session): number {
  try {
    return session.getAgentState().messages.length;
  } catch {
    return 0;
  }
}

/** Best-effort removal of trailing AI messages from a failed completion attempt. */
async function pruneInvalidSubagentContinuationMessages(
  session: Session,
  resultMessages: BaseMessage[],
  startIndex: number,
) : Promise<void> {
  const sanitized = pruneTrailingAssistantMessages(resultMessages, startIndex);
  if (!sanitized.changed) {
    return;
  }

  try {
    await session.replaceMessages(sanitized.messages);
  } catch {
    // Best-effort cleanup; if agent state is unavailable, retry still proceeds.
  }
}

function pruneTrailingAssistantMessages(
  messages: BaseMessage[],
  startIndex: number,
): {messages: BaseMessage[]; changed: boolean} {
  const next = [...messages];
  let removeFrom = -1;
  for (let index = next.length - 1; index >= startIndex; index -= 1) {
    const message = next[index];
    if (message && AIMessage.isInstance(message)) {
      removeFrom = index;
      continue;
    }
    break;
  }
  if (removeFrom >= startIndex) {
    next.splice(removeFrom);
    return {messages: next, changed: true};
  }
  return {messages: next, changed: false};
}

/** Consume an entire agent stream, buffering chunks for deferred emission. */
async function collectBufferedAgentStream<T extends AgentResult | undefined>(
  start: () => AsyncGenerator<AgentStreamOutput, T, void>,
): Promise<{chunks: AgentStreamOutput[]; result: T}> {
  const iterator = start();
  const chunks: AgentStreamOutput[] = [];

  while (true) {
    const next = await iterator.next();
    if (next.done) {
      return {chunks, result: next.value};
    }
    chunks.push(next.value);
  }
}
