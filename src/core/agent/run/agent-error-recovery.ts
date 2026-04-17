/**
 * Turn-level error recovery pipeline for the agent loop.
 *
 * Drives the multi-stage recovery strategy (abort, max tokens, context window,
 * rate limit, transient) and returns either 'continue' to retry the turn or
 * a terminal AgentResult to end the loop.
 *
 * Stage hierarchy (aligned with Claude Code query.ts):
 *   0. Abort
 *   1. Max output tokens → continuation prompt
 *   2. Context window exhaustion → cheap drain → full compact
 *   3. Rate limit → exponential backoff
 *   4. Transient → single retry
 *   5. Unrecoverable → error result
 */

import {HumanMessage} from '@langchain/core/messages';
import type {AgentResult} from '../agent-types';
import type {AgentRunContext} from './agent-runtime';
import {cheapDrainMessages, compactMessages, isContextWindowExhausted} from './compact';
import {
  computeRetryDelay,
  createRecoveryState,
  extractRetryAfter,
  isMaxOutputTokensError,
  isRateLimitError,
  isTransientError,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
} from './error-recovery';
import {createTokenBudgetState, estimateMessagesTokenCount} from './token-budget';

export type TurnRecovery = 'continue' | AgentResult;

/**
 * Multi-stage error recovery. Returns 'continue' to retry the turn,
 * or an AgentResult to terminate the loop.
 */
export async function handleTurnError(
  error: unknown,
  run: AgentRunContext,
  recovery: ReturnType<typeof createRecoveryState>,
  budget: ReturnType<typeof createTokenBudgetState>,
  keepRecentTurns: number,
  maxCompactionAttempts: number,
): Promise<TurnRecovery> {
  // Stage 0: Abort
  if (error instanceof Error && error.name === 'AbortError') {
    return {reason: 'aborted', state: run.state, turns: 0};
  }

  // Stage 1: Max output tokens
  if (isMaxOutputTokensError(error) && recovery.maxOutputTokensRecoveryCount < MAX_OUTPUT_TOKENS_RECOVERY_LIMIT) {
    recovery.maxOutputTokensRecoveryCount += 1;
    run.state.messages.push(new HumanMessage({
      content:
        'Output token limit hit. Resume directly — no apology, no recap of what you were doing. ' +
        'Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.',
    }));
    return 'continue';
  }

  // Stage 2: Context window exhaustion
  if (isContextWindowExhausted(error)) {
    // 2a: Cheap drain
    if (!recovery.cheapDrainAttempted) {
      recovery.cheapDrainAttempted = true;
      const drainResult = cheapDrainMessages(run.state.messages, keepRecentTurns);
      if (drainResult.freedCount > 0) {
        run.state.messages = drainResult.messages;
        budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
        return 'continue';
      }
    }
    // 2b: Full compaction
    if (recovery.compactionAttempts < maxCompactionAttempts) {
      recovery.compactionAttempts += 1;
      run.state.messages = compactMessages(run.state.messages, {keepRecentTurns});
      budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
      return 'continue';
    }
  }

  // Stage 3: Rate limit → exponential backoff with jitter
  if (isRateLimitError(error) && recovery.rateLimitAttempt < 3) {
    recovery.rateLimitAttempt += 1;
    const retryAfterMs = extractRetryAfter(error);
    const delay = computeRetryDelay(recovery.rateLimitAttempt, retryAfterMs);
    await new Promise((resolve) => setTimeout(resolve, delay));
    return 'continue';
  }

  // Stage 4: Transient API error → single retry per turn
  if (isTransientError(error) && !recovery.transientRetried) {
    recovery.transientRetried = true;
    return 'continue';
  }

  // Stage 5: Unrecoverable
  return {
    reason: 'error',
    state: run.state,
    turns: 0,
    error: error instanceof Error ? error : new Error(String(error)),
  };
}
