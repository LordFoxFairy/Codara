import path from 'node:path';
import {ToolMessage} from '@langchain/core/messages';
import type {ToolCallContext} from '@core/pipeline/types';
import {resolveToolCallId} from '@core/agent/run/tool-executor';

export function maybeHandleTaskCompletionToolCall(context: ToolCallContext): ToolMessage | undefined {
  if (shouldBlockInternalMemoryWriteDuringTaskCompletion(context)) {
    return new ToolMessage({
      content: 'Internal memory updates are deferred while completing delegated-task results. Finish the user request first by launching the next required Task or by giving the final user-facing answer.',
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  const repeatedTaskTopic = readRepeatedTaskCompletionTopic(context);
  if (repeatedTaskTopic) {
    return new ToolMessage({
      content: `This delegated task repeats already completed work (${repeatedTaskTopic}). Do not relaunch a completed phase or topic. Launch only the missing next-step Task, or give the final user-facing answer if nothing remains.`,
      tool_call_id: resolveToolCallId(context.toolCall, context.toolIndex),
      status: 'error',
    });
  }

  return undefined;
}

function shouldBlockInternalMemoryWriteDuringTaskCompletion(context: ToolCallContext): boolean {
  const taskCompletion = readTaskCompletionRuntimeContext(context);
  if (!taskCompletion?.tasks?.length) {
    return false;
  }

  const toolName = context.toolCall.name?.trim();
  if (toolName !== 'write_file' && toolName !== 'edit_file') {
    return false;
  }

  const targetPath = readToolTargetPath(context.toolCall.args);
  return Boolean(targetPath && isInternalCodaraMemoryPath(targetPath));
}

function readRepeatedTaskCompletionTopic(context: ToolCallContext): string | undefined {
  const taskCompletion = readTaskCompletionRuntimeContext(context);
  if (!taskCompletion?.tasks?.length) {
    return undefined;
  }

  if (context.toolCall.name?.trim() !== 'Task') {
    return undefined;
  }

  const prompt = readTaskPrompt(context.toolCall.args);
  const normalizedPrompt = normalizeTaskReplayText(prompt);
  if (!normalizedPrompt) {
    return undefined;
  }

  for (const task of taskCompletion.tasks) {
    if (task.status !== 'completed') {
      continue;
    }

    const topic = extractTaskTopic(task.label, task.agentName, task.runId);
    const normalizedTopic = normalizeTaskReplayText(topic);
    if (!normalizedTopic) {
      continue;
    }

    if (isRepeatedTaskReplay(normalizedPrompt, normalizedTopic)) {
      return topic;
    }
  }

  return undefined;
}

function readTaskCompletionRuntimeContext(
  context: Pick<ToolCallContext, 'runtime'>,
): {
  tasks?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>;
} | undefined {
  return (context.runtime.runtimeContext as {codaraTaskCompletion?: {tasks?: Array<{runId: string; label: string; agentName: string; status: 'completed' | 'failed'}>}} | undefined)?.codaraTaskCompletion;
}

function readTaskPrompt(args: unknown): string | undefined {
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

function extractTaskTopic(label: string | undefined, agentName: string | undefined, runId: string): string {
  const raw = label?.trim() || agentName?.trim() || runId;
  const stripped = raw
    .replace(/^Delegating\s+[^:]+:\s*/i, '')
    .replace(/^Delegating\s+/i, '')
    .trim();
  return stripped || raw;
}

function normalizeTaskReplayText(text: string | undefined): string | undefined {
  const normalized = text
    ?.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function isRepeatedTaskReplay(prompt: string, topic: string): boolean {
  if (prompt === topic) {
    return true;
  }

  if (prompt.length >= 48 && topic.length >= 48) {
    return prompt.includes(topic) || topic.includes(prompt);
  }

  return false;
}
