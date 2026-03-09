import type {BaseMessage} from '@langchain/core/messages';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import type {
  AgentInput,
  AgentMessagesInput,
  AgentRuntimeContext,
} from '@core/agents/contract/agent';
import {parseHILToolMessagePayload, type HILPauseRequest, type HILResumePayload} from '@core/middleware/hil';
import {cloneContext, clonePause} from '@core/agents/engine/state';

export function normalizeAgentInput(input: AgentInput): BaseMessage[] {
  if (input === undefined) {
    return [];
  }

  if (isAgentMessagesState(input)) {
    return [...input.messages];
  }

  if (typeof input === 'string') {
    const content = input.trim();
    return content ? [new HumanMessage(content)] : [];
  }

  return Array.isArray(input) ? [...input] : [input];
}

export function isAgentMessagesState(input: AgentInput): input is AgentMessagesInput {
  return typeof input === 'object' && input !== null && 'messages' in input && Array.isArray((input as {messages?: unknown}).messages);
}

export function readLatestPause(messages: BaseMessage[]): HILPauseRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }

    const payload = parseHILToolMessagePayload(message.content);
    if (payload?.type === 'hil_pause') {
      return clonePause(payload.request);
    }
  }

  return undefined;
}

export function injectResumePayload(
  context: AgentRuntimeContext | undefined,
  pause: HILPauseRequest,
  payload: HILResumePayload
): AgentRuntimeContext {
  const nextContext = mergeContext({}, context);
  const root = ensureRecord(nextContext);
  const rawHil = ensureRecord(root.hil);
  const rawResumes = ensureRecord(rawHil.resumes);

  root.hil = {
    ...rawHil,
    resumes: {
      ...rawResumes,
      [pause.id]: payload,
      [pause.action.toolCallId]: payload,
    },
  };

  return root;
}

export function mergeContext(base: AgentRuntimeContext, overrides: AgentRuntimeContext | undefined): AgentRuntimeContext {
  if (!overrides) {
    return cloneContext(base);
  }

  const merged: AgentRuntimeContext = cloneContext(base);
  for (const [key, value] of Object.entries(cloneContext(overrides))) {
    const previous = merged[key];
    if (isPlainRecord(previous) && isPlainRecord(value)) {
      merged[key] = {...previous, ...value};
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function ensureRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
