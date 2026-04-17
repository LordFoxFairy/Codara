/**
 * Agent turn loop — drives runAgentTurn repeatedly until completion.
 *
 * The surrounding orchestration (session state, hooks, streaming, resume)
 * lives in agent-session.ts. Error recovery lives in agent-error-recovery.ts.
 * This module keeps only the loop body + Stop-hook helper.
 *
 * Historically re-exports `createAgent` and other helpers so downstream code
 * that imported from `@core/agent/run/agent-loop` continues to work.
 */

import {AIMessage, BaseMessage, HumanMessage} from '@langchain/core/messages';
import {MIDDLEWARE_NAMES} from '@core/pipeline-types';
import {runAgentTurn} from './turn';
import type {AgentResult} from '../agent-types';
import type {AgentRunContext, AgentRuntime} from './agent-runtime';
import type {createStreamWriter} from './stream';
import {compactMessages} from './compact';
import {createRecoveryState, resetPerTurnFlags} from './error-recovery';
import {createTokenBudgetState, estimateMessagesTokenCount, shouldAutoCompact, shouldStopContinuation} from './token-budget';
import {handleTurnError} from './agent-error-recovery';

// ── Re-exports for backward compatibility ──────────────────────────────────
// Historically, consumers (tests, codara-factory, core/agent/index.ts) imported
// createAgent, normalizeAgentInput, createRunContext, throwIfAborted,
// toMessageChunk, chunkToMessage, createTurnContext, AgentRuntime, AgentRunContext
// from this module. Keep those paths working while the real code lives elsewhere.

export {createAgent} from './agent-session';
export {
  normalizeAgentInput,
  readLatestReview,
  injectReviewResumePayload,
  createRunContext,
} from './agent-input';
export {
  throwIfAborted,
  createTurnContext,
  toMessageChunk,
  chunkToMessage,
  type AgentRuntime,
  type AgentRunContext,
  type AgentModel,
} from './agent-runtime';
export {handleTurnError} from './agent-error-recovery';

// Re-export error-recovery internals used directly by external code (only the
// symbols that were re-exported historically — keep the public surface intact).
export {
  computeRetryDelay,
  extractRetryAfter,
  isMaxOutputTokensError,
  isRateLimitError,
  isTransientError,
  MAX_OUTPUT_TOKENS_RECOVERY_LIMIT,
} from './error-recovery';

// ── Agent loop ──────────────────────────────────────────────────────────────

export async function runLoop(
  run: AgentRunContext,
  runtime: AgentRuntime,
  stream?: ReturnType<typeof createStreamWriter>,
  startTurn = 1,
): Promise<AgentResult> {
  const keepRecentTurns = run.inputBudget?.keepRecentTurns ?? 3;
  const maxCompactionAttempts = run.inputBudget?.maxCompactionAttempts ?? 3;
  const contextWindow = run.inputBudget?.maxInputTokens ?? 128_000;
  const budget = createTokenBudgetState(contextWindow);
  const summaryHandlesCompaction = runtime.pipeline.has(MIDDLEWARE_NAMES.Summary);
  const recovery = createRecoveryState();

  for (let turn = startTurn; turn <= run.maxTurns; turn += 1) {
    if (run.signal?.aborted) {
      return {reason: 'aborted', state: run.state, turns: turn - startTurn};
    }

    resetPerTurnFlags(recovery);

    // Proactive auto-compact (skip when SummaryMiddleware handles it)
    budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
    if (!summaryHandlesCompaction && shouldAutoCompact(budget) && recovery.compactionAttempts < maxCompactionAttempts) {
      recovery.compactionAttempts += 1;
      run.state.messages = compactMessages(run.state.messages, {keepRecentTurns});
      budget.estimatedUsed = estimateMessagesTokenCount(run.state.messages);
    }

    // Budget exhaustion check (skip on first turn)
    if (budget.continuationCount > 0 && shouldStopContinuation(budget)) {
      return {reason: 'budget_exhausted', state: run.state, turns: turn - startTurn};
    }

    try {
      run.state.messages = [...run.state.messages];
      const preEstimate = budget.estimatedUsed;
      const turnResult = await runAgentTurn(run, runtime, turn, stream);

      // Post-turn budget tracking
      const newEstimate = estimateMessagesTokenCount(run.state.messages);
      budget.lastDeltaTokens = newEstimate - preEstimate;
      budget.estimatedUsed = newEstimate;
      budget.continuationCount += 1;
      recovery.cumulativeTokensUsed += (newEstimate - preEstimate);

      if (turnResult.reason !== 'complete') {
        continue;
      }

      // Invoke Stop hook — if vetoed, inject messages and continue loop
      const vetoed = await invokeStopHook(runtime, run, turn, false);
      if (vetoed) {
        continue;
      }

      return {
        reason: 'complete',
        state: run.state,
        turns: turn,
        ...(turnResult.launchedSubagentBatchIds?.length
          ? {launchedSubagentBatchIds: turnResult.launchedSubagentBatchIds}
          : {}),
      };
    } catch (error) {
      const recovered = await handleTurnError(error, run, recovery, budget, keepRecentTurns, maxCompactionAttempts);
      if (recovered === 'continue') {
        continue;
      }
      return recovered;
    }
  }

  // Max turns reached
  await invokeStopHook(runtime, run, run.maxTurns, true);
  return {reason: 'max_turns', state: run.state, turns: run.maxTurns};
}

// ── Stop hook helper ────────────────────────────────────────────────────────

/**
 * Invoke the Stop lifecycle hook. Returns true if the hook vetoed (and
 * messages were injected), false otherwise.
 */
async function invokeStopHook(
  runtime: AgentRuntime,
  run: AgentRunContext,
  turn: number,
  reachedMaxTurns: boolean,
): Promise<boolean> {
  if (!runtime.lifecycle) return false;
  try {
    const stopResult = await runtime.lifecycle.onStop({
      hookEvent: 'Stop',
      sessionId: run.state.sessionId,
      reason: 'complete',
      reachedMaxTurns,
      turns: turn,
      lastMessage: getLastAIMessagePreview(run.state.messages),
      timestamp: new Date().toISOString(),
    });
    if (!reachedMaxTurns && stopResult.vetoed) {
      for (const msg of stopResult.systemMessages) {
        run.state.messages.push(new HumanMessage({content: `[system] ${msg}`}));
      }
      return true;
    }
  } catch (err) {
    // Fail-open: if hook errors, allow stop. Log for observability.
    if (process.env.DEBUG) console.warn('[agent] Stop hook error (fail-open):', err);
  }
  return false;
}

function getLastAIMessagePreview(messages: BaseMessage[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (AIMessage.isInstance(messages[i])) {
      const content = messages[i]!.content;
      const text = typeof content === 'string' ? content : JSON.stringify(content);
      return text.slice(0, 200);
    }
  }
  return undefined;
}
