/**
 * Subagent completion middleware.
 *
 * When the parent agent resumes after one or more subagent runs have
 * completed, this middleware:
 * - Injects a handoff system message describing the completed runs
 *   (see `buildSubagentCompletionHandoff`).
 * - Validates the parent's response to catch "still waiting" / "future
 *   work" / raw-replay patterns and reject them so the parent retries.
 * - Blocks two common mistakes at tool-call time:
 *     * writing to internal Codara memory during completion,
 *     * relaunching a subagent that repeats a completed topic.
 *
 * Stateless helpers (pattern catalogue, formatters, replay detection)
 * live in sibling modules so this file focuses on middleware wiring
 * and the public validation API.
 *
 * @module
 */

import path from 'node:path';
import {ToolMessage} from '@langchain/core/messages';
import {resolveToolCallId} from '@core/agent/run/tool-executor';
import {createMiddleware, type BaseMiddleware, type BeforeModelContext, type ToolCallContext} from '@core/pipeline-types';
import {
  ALL_INVALID_PATTERNS,
  COMPLETION_HANDOFF_INSTRUCTIONS,
  REPEATED_CORRECTION_LINES,
  RETRY_CORRECTION_LINES,
} from './completion-patterns';
import {
  containsRawSubagentReplay,
  extractSubagentTopic,
  formatSubagentCompletionLine,
  normalizeForTaskComparison,
  summarizeDetail,
  type SubagentCompletionRunEntry,
  type SubagentRunComparableEntry,
} from './completion-formatting';

export {createSubagentCompletionToolMessages} from './completion-formatting';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SubagentCompletionContinuationContext {
  codaraSubagentCompletion?: {
    attempt?: number;
    previousInvalidResponse?: string;
    runs?: ReadonlyArray<SubagentCompletionRunEntry>;
  };
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

export function createSubagentCompletionMiddleware(): BaseMiddleware {
  return createMiddleware({
    name: 'SubagentCompletion',
    beforeModel(context) {
      const handoff = buildSubagentCompletionHandoff(context);
      if (!handoff) {
        return undefined;
      }

      context.systemMessage.push(handoff);
      return undefined;
    },
    async wrapToolCall(context, handler) {
      const blocked = maybeHandleSubagentCompletionToolCall(context);
      if (blocked) {
        return blocked;
      }
      return await handler(context);
    },
  });
}

// ---------------------------------------------------------------------------
// Handoff builder
// ---------------------------------------------------------------------------

export function buildSubagentCompletionHandoff(context: BeforeModelContext): string | undefined {
  if (context.state.agentType !== 'main') {
    return undefined;
  }

  const runtimeContext = context.runtime.runtimeContext as SubagentCompletionContinuationContext | undefined;
  const runs = runtimeContext?.codaraSubagentCompletion?.runs;
  if (!runs?.length) {
    return undefined;
  }

  const attempt = runtimeContext?.codaraSubagentCompletion?.attempt ?? 1;
  const previousInvalidResponse = runtimeContext?.codaraSubagentCompletion?.previousInvalidResponse?.trim();

  const lines: string[] = [
    ...COMPLETION_HANDOFF_INSTRUCTIONS,
    ...runs.map((run) => formatSubagentCompletionLine(run)),
  ];

  if (attempt > 1) {
    lines.splice(3, 0, ...RETRY_CORRECTION_LINES);
    if (previousInvalidResponse) {
      lines.push(`Invalid previous draft (for correction only): ${summarizeDetail(previousInvalidResponse)}`);
    }
  }

  if (attempt > 2) {
    lines.splice(5, 0, ...REPEATED_CORRECTION_LINES);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tool-call interceptors
// ---------------------------------------------------------------------------

export function maybeHandleSubagentCompletionToolCall(context: ToolCallContext): ToolMessage | undefined {
  if (shouldBlockInternalMemoryWrite(context)) {
    return new ToolMessage({
      content: 'Internal memory updates are deferred while completing subagent results. Finish the user request first by launching the next required Agent or by giving the final user-facing answer.',
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  const repeatedTopic = findRepeatedSubagentTopic(context);
  if (repeatedTopic) {
    return new ToolMessage({
      content: `This subagent run repeats already completed work (${repeatedTopic}). Do not relaunch a completed phase or topic. Launch only the missing next-step Agent, or give the final user-facing answer if nothing remains.`,
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Response validation
// ---------------------------------------------------------------------------

export function isInvalidSubagentCompletionResponse(
  text: string | undefined,
  runs: readonly SubagentRunComparableEntry[] = [],
): boolean {
  const normalized = text?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return false;
  }

  if (matchesAnyPattern(normalized)) {
    return true;
  }

  return containsRawSubagentReplay(normalized, runs);
}

export function shouldRetrySubagentCompletionResponse(input: {
  text: string | undefined;
  launchedSubagentToolCall?: boolean;
  attempt: number;
  maxAttempts: number;
  runs?: readonly SubagentRunComparableEntry[];
}): boolean {
  if (input.launchedSubagentToolCall) {
    return false;
  }

  if (input.attempt >= input.maxAttempts) {
    return false;
  }

  return !input.text?.trim() || isInvalidSubagentCompletionResponse(input.text, input.runs ?? []);
}

export function isSubagentInternalAssistantText(input: {
  text: string | undefined;
  runs?: readonly SubagentRunComparableEntry[];
}): boolean {
  if (!input.text?.trim()) {
    return false;
  }

  return isInvalidSubagentCompletionResponse(input.text, input.runs ?? []);
}

// ---------------------------------------------------------------------------
// Internal: pattern matching
// ---------------------------------------------------------------------------

function matchesAnyPattern(text: string): boolean {
  return ALL_INVALID_PATTERNS.some((entry) => entry.pattern.test(text));
}

// ---------------------------------------------------------------------------
// Internal: tool-call guards
// ---------------------------------------------------------------------------

function shouldBlockInternalMemoryWrite(context: ToolCallContext): boolean {
  const completion = readCompletionContext(context);
  if (!completion?.runs?.length) {
    return false;
  }

  const toolName = context.toolCall.name?.trim();
  if (toolName !== 'write_file' && toolName !== 'edit_file') {
    return false;
  }

  const targetPath = readToolTargetPath(context.toolCall.args);
  return Boolean(targetPath && isInternalCodaraMemoryPath(targetPath));
}

function findRepeatedSubagentTopic(context: ToolCallContext): string | undefined {
  const completion = readCompletionContext(context);
  if (!completion?.runs?.length) {
    return undefined;
  }

  if (context.toolCall.name?.trim() !== 'Agent') {
    return undefined;
  }

  const prompt = readSubagentPrompt(context.toolCall.args);
  const normalizedPrompt = normalizeForTaskComparison(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  for (const run of completion.runs) {
    if (run.status !== 'completed') {
      continue;
    }

    const topic = extractSubagentTopic(run.label, run.agentName, run.runId);
    const normalizedTopic = normalizeForTaskComparison(topic);
    if (!normalizedTopic) {
      continue;
    }

    if (isTaskRepeat(normalizedPrompt, normalizedTopic)) {
      return topic;
    }
  }

  return undefined;
}

function readCompletionContext(
  context: Pick<ToolCallContext, 'runtime'>,
): {
  runs?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>;
} | undefined {
  return (context.runtime.runtimeContext as {codaraSubagentCompletion?: {runs?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>}} | undefined)?.codaraSubagentCompletion;
}

// ---------------------------------------------------------------------------
// Internal: argument readers
// ---------------------------------------------------------------------------

function readSubagentPrompt(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const prompt = (args as Record<string, unknown>).prompt;
  return typeof prompt === 'string' ? prompt.trim() || undefined : undefined;
}

function readToolTargetPath(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  const record = args as Record<string, unknown>;
  const candidate = typeof record.file_path === 'string'
    ? record.file_path
    : typeof record.path === 'string'
      ? record.path
      : undefined;
  return candidate?.trim() || undefined;
}

function isInternalCodaraMemoryPath(filePath: string): boolean {
  const normalized = path.resolve(filePath).replace(/\\/g, '/').toLowerCase();
  return /(?:^|\/)\.codara\/memory(?:\/|$)/.test(normalized)
    || /(?:^|\/)\.codara\/projects\/[^/]+\/memory(?:\/|$)/.test(normalized);
}

function isTaskRepeat(prompt: string, topic: string): boolean {
  if (prompt === topic) {
    return true;
  }

  if (prompt.length >= 48 && topic.length >= 48) {
    return prompt.includes(topic) || topic.includes(prompt);
  }

  return false;
}
