/**
 * Session fork + state-mutation helpers for {@link createSession}.
 *
 * Responsibilities:
 * - `forkSession` — duplicate the current agent state into a new child
 *   session via a fork checkpoint.
 * - `focusReview` / `updateContext` / `replaceMessages` — rewrite a
 *   manual checkpoint and rebuild the agent so the next access sees
 *   the new state.
 *
 * All three state-mutation helpers share the same pattern:
 *   1. snapshot current state,
 *   2. write a manual checkpoint with the mutation applied,
 *   3. clear the agent cache,
 *   4. rebuild the agent,
 *   5. sync metadata without touching `lastActivity`.
 *
 * They are grouped here so the main session factory doesn't repeat this
 * pattern three times.
 *
 * @module
 */

import type {BaseMessage} from '@langchain/core/messages';
import type {
  Agent,
  AgentRuntimeContext,
  AgentState,
  ReviewRequest,
} from '@shared/agent-types';
import {mergeContext as mergeAgentContext} from '@shared/context-merge';
import {
  putForkCheckpoint,
  putManualCheckpoint,
  type AgentCheckpoint,
  type AgentCheckpointer,
} from '@state/checkpoint/agent';
import type {SyncFn} from './session-invoke';

export interface ForkDeps {
  sessionId: string;
  checkpointer: AgentCheckpointer;
  getAgent: () => Promise<Agent>;
}

/**
 * Build a fork checkpoint for a new child session from the current
 * agent state. The caller is expected to follow up by constructing the
 * child session itself (which will restore from this checkpoint).
 */
export async function writeForkCheckpoint(
  deps: ForkDeps,
  childSessionId: string,
): Promise<void> {
  const base = (await deps.getAgent()).getState();
  await putForkCheckpoint(deps.checkpointer, childSessionId, {
    agentType: base.agentType,
    messages: base.messages,
    context: base.context,
    values: base.values,
    ...(base.pendingReview ? {pendingReview: base.pendingReview} : {}),
  });
}

export interface MutateStateDeps {
  sessionId: string;
  checkpointer: AgentCheckpointer;
  getAgent: () => Promise<Agent>;
  getLatestCheckpoint: () => Promise<AgentCheckpoint | undefined>;
  clearAgentCache: () => void;
  sync: SyncFn;
}

/**
 * Attach a pending review request to the current state via a manual
 * checkpoint. If the state already has the same pending review, this is a no-op.
 */
export async function focusReview(
  deps: MutateStateDeps,
  request: ReviewRequest,
): Promise<AgentState> {
  const current = (await deps.getAgent()).getState();

  if (current.pendingReview?.id === request.id) {
    return current;
  }

  await putManualCheckpoint(deps.checkpointer, deps.sessionId, {
    agentType: current.agentType,
    messages: current.messages,
    context: current.context,
    values: current.values,
    pendingReview: request,
  }, await deps.getLatestCheckpoint());

  deps.clearAgentCache();
  const next = (await deps.getAgent()).getState();
  await deps.sync(next, {touchActivity: false});
  return next;
}

/** Merge a context patch into the current state and persist a new checkpoint. */
export async function updateContext(
  deps: MutateStateDeps,
  contextPatch: AgentRuntimeContext,
): Promise<AgentState> {
  const current = (await deps.getAgent()).getState();
  const nextContext = applyContextPatch(current.context, contextPatch);

  await putManualCheckpoint(deps.checkpointer, deps.sessionId, {
    agentType: current.agentType,
    messages: current.messages,
    context: nextContext,
    values: current.values,
    ...(current.pendingReview ? {pendingReview: current.pendingReview} : {}),
  }, await deps.getLatestCheckpoint());

  deps.clearAgentCache();
  const next = (await deps.getAgent()).getState();
  await deps.sync(next, {touchActivity: false});
  return next;
}

/** Replace the entire message array and persist a new checkpoint. */
export async function replaceMessages(
  deps: MutateStateDeps,
  messages: BaseMessage[],
): Promise<AgentState> {
  const current = (await deps.getAgent()).getState();

  await putManualCheckpoint(deps.checkpointer, deps.sessionId, {
    agentType: current.agentType,
    messages,
    context: current.context,
    values: current.values,
    ...(current.pendingReview ? {pendingReview: current.pendingReview} : {}),
  }, await deps.getLatestCheckpoint());

  deps.clearAgentCache();
  const next = (await deps.getAgent()).getState();
  await deps.sync(next, {touchActivity: false});
  return next;
}

/**
 * Merge a context patch into the current context.
 *
 * - Keys with `undefined` value are deleted from the result.
 * - All other keys are deep-merged via `mergeAgentContext`.
 */
export function applyContextPatch(
  current: AgentRuntimeContext,
  patch: AgentRuntimeContext,
): AgentRuntimeContext {
  const normalizedPatch: AgentRuntimeContext = {};

  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      normalizedPatch[key] = value;
    }
  }

  const merged = mergeAgentContext(current ?? {}, normalizedPatch);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    }
  }
  return merged;
}
