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

const SUBAGENT_COMPLETION_MAX_ATTEMPTS = 3;

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
  const {session, subagentRunStore, subagentRunManager, start, buildContinuationConfig} = input;
  let execute = start;
  let claimedCompletion: SubagentCompletionContinuation | undefined;
  let completionContext: SubagentCompletionRuntimeContext | undefined;

  while (true) {
    const previousMessageCount = readSessionMessageCount(session);
    let result: AgentResult;

    try {
      if (completionContext) {
        const buffered = await collectBufferedAgentStream(execute);
        result = buffered.result;

        const completionRetry = resolveSubagentCompletionRetry({
          result,
          previousMessageCount,
          completionContext,
        });
        if (completionRetry) {
          await pruneInvalidSubagentContinuationMessages(session, result.state.messages, previousMessageCount);
          completionContext = completionRetry.context;
          execute = () => session.stream(undefined, buildContinuationConfig({
            codaraSubagentCompletion: completionContext,
          }));
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
    if (!subagentRunStore || result.state.pendingReview) {
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
    execute = () => session.stream({messages: completionMessages}, buildContinuationConfig({
      codaraSubagentCompletion: completionContext,
    }));
  }
}

async function* streamReviewWithSubagentFollowThrough(input: {
  session: Session;
  subagentRunStore?: SubagentRunStore;
  subagentRunManager?: SubagentRunManager;
  start: () => AsyncGenerator<AgentStreamOutput, AgentResult | undefined, void>;
  buildContinuationConfig: (context: AgentRuntimeContext) => Omit<AgentStreamConfig, 'context'> & {context: AgentRuntimeContext};
}): AsyncGenerator<AgentStreamOutput, void, void> {
  const {session, subagentRunStore, subagentRunManager, start, buildContinuationConfig} = input;
  let execute = start;
  let claimedCompletion: SubagentCompletionContinuation | undefined;
  let completionContext: SubagentCompletionRuntimeContext | undefined;

  while (true) {
    const previousMessageCount = readSessionMessageCount(session);
    let result: AgentResult | undefined;

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
          execute = () => session.stream(undefined, buildContinuationConfig({
            codaraSubagentCompletion: completionContext,
          }));
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
    execute = () => session.stream({messages: completionMessages}, buildContinuationConfig({
      codaraSubagentCompletion: completionContext,
    }));
  }
}

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
