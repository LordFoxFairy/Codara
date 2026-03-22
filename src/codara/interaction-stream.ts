import {ToolMessage, type BaseMessage} from '@langchain/core/messages';
import type {SubagentCompletionContinuation, SubagentRunManager, SubagentRunStore} from '@capability/subagent';
import {createSubagentCompletionToolMessages} from '@capability/subagent/completion';
import type {Session} from '@durability/session';
import {readSubagentRunLaunchResult} from '@shared/subagent-run-launch';
import type {AgentResult, AgentRuntimeContext, AgentStreamConfig, AgentStreamOutput} from '@core/agent';
import type {CodaraStreamRequest} from './types';
import type {CodaraReviewControl} from './review-control';

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

  while (true) {
    const previousMessageCount = readSessionMessageCount(session);
    let result: AgentResult;

    try {
      result = yield* execute();
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
    execute = () => session.stream({messages: completionMessages}, buildContinuationConfig({
      codaraSubagentCompletion: {
        runs: claimedCompletion?.runs ?? [],
      },
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

  while (true) {
    const previousMessageCount = readSessionMessageCount(session);
    let result: AgentResult | undefined;

    try {
      result = yield* execute();
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
    execute = () => session.stream({messages: completionMessages}, buildContinuationConfig({
      codaraSubagentCompletion: {
        runs: claimedCompletion?.runs ?? [],
      },
    }));
  }
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
