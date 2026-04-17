/**
 * Session lifecycle hook helpers.
 *
 * Wraps the best-effort (swallow-error) invocation pattern used for
 * advisory hooks (`onSessionStart`, `onUserPromptSubmit`, `onSessionEnd`)
 * along with the tiny prompt-text extractor used to feed the veto hook.
 *
 * These helpers are intentionally stateless -- state (e.g. `sessionStarted`)
 * lives in the session factory closure and is passed in via dependencies.
 *
 * @module
 */

import type {BaseMessage} from '@langchain/core/messages';
import type {AgentInput, AgentResult, AgentState} from '@shared/agent-types';
import type {SessionLifecycleHooks} from '@hooks/types';

/** Call a lifecycle hook, swallowing errors. Hooks are advisory, not critical. */
export async function safeLifecycleCall<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    // Lifecycle hooks are best-effort and should not break the session.
    return undefined;
  }
}

export interface SessionStartHookDeps {
  sessionId: string;
  lifecycle?: SessionLifecycleHooks;
}

/** Fire the `SessionStart` hook once per session. Idempotent; the caller passes in current flag state. */
export async function fireSessionStartHook(
  deps: SessionStartHookDeps,
  alreadyStarted: boolean,
): Promise<boolean> {
  if (alreadyStarted || !deps.lifecycle) {
    return alreadyStarted;
  }
  await safeLifecycleCall(() =>
    deps.lifecycle!.onSessionStart({
      sessionId: deps.sessionId,
      hookEvent: 'SessionStart',
      timestamp: new Date().toISOString(),
      cwd: process.cwd(),
    }),
  );
  return true;
}

export interface PromptVetoDeps {
  sessionId: string;
  lifecycle?: SessionLifecycleHooks;
  getAgentState: () => Promise<AgentState>;
}

/**
 * Invoke the `UserPromptSubmit` hook. If the hook veto's the prompt,
 * return an `AgentResult` representing a 0-turn veto outcome that
 * callers should short-circuit with.
 */
export async function checkPromptVeto(
  deps: PromptVetoDeps,
  input: AgentInput | undefined,
): Promise<AgentResult | undefined> {
  if (!deps.lifecycle || input == null) {
    return undefined;
  }
  const prompt = extractPromptText(input);
  if (!prompt) {
    return undefined;
  }
  const result = await safeLifecycleCall(() =>
    deps.lifecycle!.onUserPromptSubmit({
      sessionId: deps.sessionId,
      hookEvent: 'UserPromptSubmit',
      timestamp: new Date().toISOString(),
      userPrompt: prompt,
    }),
  );
  if (result?.vetoed) {
    const agentState = await deps.getAgentState();
    return {
      reason: 'complete',
      state: agentState,
      turns: 0,
      error: result.vetoReason ? new Error(result.vetoReason) : undefined,
    };
  }
  return undefined;
}

export interface SessionEndHookDeps {
  sessionId: string;
  lifecycle?: SessionLifecycleHooks;
}

/** Fire the `SessionEnd` hook (best-effort). */
export async function fireSessionEndHook(deps: SessionEndHookDeps): Promise<void> {
  if (!deps.lifecycle) {
    return;
  }
  await safeLifecycleCall(() =>
    deps.lifecycle!.onSessionEnd({
      sessionId: deps.sessionId,
      hookEvent: 'SessionEnd',
      timestamp: new Date().toISOString(),
      reason: 'user_exit',
    }),
  );
}

/**
 * Extract the user prompt text from various {@link AgentInput} shapes.
 *
 * Supports: raw string, `{messages: [...]}`, `BaseMessage[]`, single `BaseMessage`.
 */
export function extractPromptText(input: AgentInput): string | undefined {
  if (typeof input === 'string') {
    return input.trim() || undefined;
  }
  if (input && typeof input === 'object' && 'messages' in input && Array.isArray(input.messages)) {
    const last = input.messages[input.messages.length - 1];
    if (last && typeof last.content === 'string') {
      return last.content.trim() || undefined;
    }
  }
  if (Array.isArray(input)) {
    const last = input[input.length - 1];
    if (last && typeof last.content === 'string') {
      return last.content.trim() || undefined;
    }
  }
  if (input && typeof input === 'object' && 'content' in input) {
    const content = (input as BaseMessage).content;
    if (typeof content === 'string') {
      return content.trim() || undefined;
    }
  }
  return undefined;
}
