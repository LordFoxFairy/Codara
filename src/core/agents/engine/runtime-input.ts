import type {BaseMessage} from '@langchain/core/messages';
import {HumanMessage, ToolMessage} from '@langchain/core/messages';
import {z} from 'zod';
import type {
  AgentInput,
  AgentMessagesInput,
  AgentRuntimeContext,
} from '@core/agents/contract/agent';
import {parseHILToolMessagePayload} from '@core/middleware/hil';
import type {PauseRequest, ResumePayload} from '@core/agents/contract/pause';
import {deepClone} from '@core/support/clone';

const recordSchema = z.record(z.string(), z.unknown());

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

export function readLatestPause(messages: BaseMessage[]): PauseRequest | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!ToolMessage.isInstance(message)) {
      continue;
    }

    const payload = parseHILToolMessagePayload(message.content);
    if (payload?.type === 'hil_pause') {
      return deepClone(payload.request);
    }
  }

  return undefined;
}

export function injectResumePayload(
  context: AgentRuntimeContext | undefined,
  pause: PauseRequest,
  payload: ResumePayload
): AgentRuntimeContext {
  const nextContext = mergeContext({}, context);
  const root = recordSchema.catch({}).parse(nextContext);
  const rawHil = recordSchema.catch({}).parse(root.hil);
  const rawResumes = recordSchema.catch({}).parse(rawHil.resumes);

  root.hil = {
    ...rawHil,
    currentPause: deepClone(pause),
    resume: payload,
    resumes: {
      ...rawResumes,
      [pause.id]: payload,
      [pause.action.toolCallId]: payload,
    },
  };

  return root;
}

export function mergeContext(base: AgentRuntimeContext, overrides: AgentRuntimeContext | undefined): AgentRuntimeContext {
  if (!overrides || Object.keys(overrides).length === 0) {
    return base;
  }

  const merged: AgentRuntimeContext = {...base};
  for (const [key, value] of Object.entries(overrides)) {
    const previous = merged[key];
    const previousRecord = recordSchema.safeParse(previous);
    const nextRecord = recordSchema.safeParse(value);
    if (previousRecord.success && nextRecord.success) {
      merged[key] = {...previousRecord.data, ...nextRecord.data};
    } else {
      merged[key] = value;
    }
  }
  return merged;
}
