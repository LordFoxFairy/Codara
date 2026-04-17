/**
 * Agent invocation/streaming/resume helpers for {@link createSession}.
 *
 * Responsibilities:
 * - `runOperation`   — run a one-shot agent call and sync metadata afterwards.
 * - `runStreamOperation` — run a streaming agent call, emit the first
 *   model-responding runtime event, and sync metadata on completion.
 * - `runHilResume`   — wrap a human-in-the-loop resume with the matching
 *   runtime event start/finish pair.
 *
 * Factored out of {@link createSession} so the main factory can focus on
 * wiring + lifecycle rather than mechanics of LangChain stream iteration.
 *
 * @module
 */

import {AIMessageChunk, type BaseMessage} from '@langchain/core/messages';
import type {
  Agent,
  AgentResult,
  AgentState,
  AgentStreamOutput,
} from '@shared/agent-types';
import type {RuntimeEventsController} from '@events';

export interface SyncOptions {
  touchActivity?: boolean;
  collectUsage?: boolean;
  previousMessages?: readonly BaseMessage[];
}

export type SyncFn = (state: AgentState, options?: SyncOptions) => Promise<void>;

/** Run a synchronous agent operation and sync metadata + usage afterwards. */
export async function runOperation(
  getAgent: () => Promise<Agent>,
  sync: SyncFn,
  operation: (instance: Agent) => Promise<AgentResult>,
): Promise<AgentResult> {
  const instance = await getAgent();
  const previousMessages = [...instance.getState().messages];
  const result = await operation(instance);
  await sync(result.state, {collectUsage: true, previousMessages});
  return result;
}

/**
 * Run a streaming agent operation.
 *
 * - Emits a `modelResponding` runtime event the first time we see a
 *   non-empty `AIMessageChunk` with valid `runId`/`turn` metadata.
 * - Syncs metadata + usage once the stream returns its final `AgentResult`.
 */
export async function* runStreamOperation(
  getAgent: () => Promise<Agent>,
  sync: SyncFn,
  runtimeEvents: RuntimeEventsController,
  operation: (instance: Agent) => AsyncGenerator<AgentStreamOutput, AgentResult, void>,
): AsyncGenerator<AgentStreamOutput, AgentResult, void> {
  const instance = await getAgent();
  const previousMessages = [...instance.getState().messages];
  let sawModelResponse = false;
  const stream = operation(instance);
  let result: AgentResult | undefined;
  while (true) {
    const next = await stream.next();
    if (next.done) {
      result = next.value;
      break;
    }

    if (!sawModelResponse && AIMessageChunk.isInstance(next.value)) {
      const runId = readResponseMetadataString(next.value.response_metadata, 'runId');
      const turn = readResponseMetadataNumber(next.value.response_metadata, 'turn');
      if (runId && typeof turn === 'number' && next.value.text?.trim()) {
        runtimeEvents.modelResponding(runId, turn);
        sawModelResponse = true;
      }
    }

    yield next.value;
  }

  if (!result) {
    throw new Error('Stream finished without an AgentResult.');
  }

  await sync(result.state, {collectUsage: true, previousMessages});
  return result;
}

/**
 * Wrap a human-in-the-loop resume operation with the matching
 * `reviewResumeStarted` / `reviewResumeFinished` runtime event pair.
 */
export async function runHilResume<T>(
  runtimeEvents: RuntimeEventsController,
  pendingDescription: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const eventId = runtimeEvents.reviewResumeStarted(
    pendingDescription?.trim() ? `Resuming review: ${pendingDescription.trim()}` : 'Applying review selection',
  );

  try {
    const result = await operation();
    runtimeEvents.reviewResumeFinished(eventId, 'done', 'Review selection applied');
    return result;
  } catch (error) {
    runtimeEvents.reviewResumeFinished(
      eventId,
      'error',
      'Review selection failed',
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

function readResponseMetadataString(
  metadata: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readResponseMetadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
