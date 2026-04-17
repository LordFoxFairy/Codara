/**
 * Conversation compaction orchestration.
 *
 * Delegates the actual summarization to the middleware factory's
 * `compactConversation()` method, but owns the surrounding lifecycle:
 * pre/post compact hooks, checkpoint persistence, agent cache invalidation,
 * and runtime event emission.
 *
 * Compared to Claude Code's `compact.ts` (1700+ lines):
 * - Claude Code performs compaction inline with image stripping, PTL retry
 *   loops, post-compact file/skill/plan re-injection, and analytics.
 * - Codara keeps the session-level orchestration thin and pushes the heavy
 *   summarization + post-compact context restoration into the middleware layer,
 *   matching the overall "session orchestrates, middleware executes" split.
 *
 * @module
 */

import {randomUUID} from 'node:crypto';
import type {Agent, AgentInputBudget, AgentState} from '@shared/agent-types';
import type {AgentCheckpointer} from '@state/checkpoint/agent';
import {putManualCheckpoint} from '@state/checkpoint/agent';
import type {SessionLifecycleHooks} from '@hooks/types';
import type {RuntimeEventsController} from '@events';
import type {BaseSystemMessageBundle} from '@context/system-message';
import type {SessionMiddlewareFactory} from './types';
import type {ConversationCompactionResult} from './session';

export interface CompactDependencies {
  sessionId: string;
  summary: false | unknown;
  summaryOptions: unknown;
  inputBudget?: AgentInputBudget;
  middlewareFactory: SessionMiddlewareFactory;
  runtimeEvents: RuntimeEventsController;
  lifecycle?: SessionLifecycleHooks;
  checkpointer: AgentCheckpointer;
  getAgent: () => Promise<Agent>;
  getLatestCheckpoint: () => Promise<import('@state/checkpoint/agent').AgentCheckpoint | undefined>;
  loadBaseInstructionContext: () => Promise<BaseSystemMessageBundle>;
  clearAgentCache: () => void;
  sync: (state: AgentState) => Promise<void>;
  safeLifecycleCall: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

export async function compactConversation(
  deps: CompactDependencies,
  compactOptions: {instructions?: string} = {},
): Promise<ConversationCompactionResult> {
  if (!deps.summary) {
    throw new Error('Conversation compaction is not configured for this session.');
  }

  const instance = await deps.getAgent();
  const summary = deps.summaryOptions;

  if (!summary) {
    throw new Error('Conversation compaction is not configured for this session.');
  }

  const current = instance.getState();
  if (current.status === 'running') {
    throw new Error('Agent is currently running.');
  }
  if (current.status === 'paused') {
    throw new Error('Agent is paused; resume(...) or reset() before compacting the conversation.');
  }

  const summaryEventId = deps.runtimeEvents.summaryStarted('Compacting context');

  if (deps.lifecycle) {
    const preResult = await deps.safeLifecycleCall(() =>
      deps.lifecycle!.onPreCompact({
        sessionId: deps.sessionId,
        hookEvent: 'PreCompact',
        timestamp: new Date().toISOString(),
        messageCount: current.messages.length,
      }),
    );
    if (preResult?.vetoed) {
      deps.runtimeEvents.summaryFinished(summaryEventId, 'done', 'Context compact skipped by hook');
      return {
        state: current,
        outcome: 'skipped',
        reason: 'hook',
      } satisfies ConversationCompactionResult;
    }
  }

  const systemContext = await deps.loadBaseInstructionContext();
  const compacted = await deps.middlewareFactory.compactConversation({
    messages: current.messages,
    context: current.context,
    values: current.values,
    systemMessage: systemContext.systemMessage,
    runtimeShared: systemContext.runtimeShared,
    sessionId: deps.sessionId,
    requestId: `${deps.sessionId}:compact:${randomUUID()}`,
    inputBudget: deps.inputBudget,
    instructions: compactOptions.instructions,
  }, summary);

  if (!compacted) {
    await deps.sync(current);
    deps.runtimeEvents.summaryFinished(summaryEventId, 'done', 'Context compact skipped');
    return {
      state: current,
      outcome: 'skipped',
      reason: 'noop',
    } satisfies ConversationCompactionResult;
  }

  await putManualCheckpoint(deps.checkpointer, deps.sessionId, {
    agentType: current.agentType,
    messages: compacted.messages,
    context: compacted.context,
    values: compacted.values,
  }, await deps.getLatestCheckpoint());

  deps.clearAgentCache();
  const next = (await deps.getAgent()).getState();
  await deps.sync(next);

  if (deps.lifecycle) {
    await deps.safeLifecycleCall(() =>
      deps.lifecycle!.onPostCompact({
        sessionId: deps.sessionId,
        hookEvent: 'PostCompact',
        timestamp: new Date().toISOString(),
        messageCount: next.messages.length,
      }),
    );
  }

  deps.runtimeEvents.summaryFinished(summaryEventId, 'done', 'Context compacted');
  return {
    state: next,
    outcome: 'compacted',
  } satisfies ConversationCompactionResult;
}
