import type {BaseMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext, AgentRuntimeValues} from './types';
import {z} from 'zod';
import {deepClone} from '@shared/clone';

const RESERVED_AGENT_CONTEXT_KEYS = new Set(['todos', 'summary']);
const recordSchema = z.record(z.string(), z.unknown());

export interface AgentStateUpdate {
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
  runtimeContext?: AgentRuntimeContext;
  runtimeShared?: Record<string, unknown>;
  values?: AgentRuntimeValues;
}

export class Command {
  readonly update: AgentStateUpdate;

  constructor(input: {update?: AgentStateUpdate} = {}) {
    this.update = input.update ?? {};
  }
}

export function isCommand(value: unknown): value is Command {
  return value instanceof Command;
}

export function applyAgentStateUpdate(
  state: {
    messages: BaseMessage[];
    context?: AgentRuntimeContext;
    values?: AgentRuntimeValues;
  },
  update: AgentStateUpdate | undefined,
  runtime?: {
    context: AgentRuntimeContext;
    runtimeContext?: AgentRuntimeContext;
    shared?: Record<string, unknown>;
  }
): void {
  if (!update) {
    return;
  }

  if (Array.isArray(update.messages) && update.messages.length > 0) {
    state.messages.push(...update.messages);
  }

  if (update.context) {
    assertNoReservedAgentStateInContext(update.context);
    state.context = mergeRecords(state.context, update.context);
  }

  if (update.runtimeContext && runtime) {
    runtime.runtimeContext = mergeRuntimeRecord(runtime.runtimeContext, update.runtimeContext) ?? {};
  }

  if (update.runtimeShared && runtime) {
    runtime.shared = mergeRuntimeRecord(runtime.shared, update.runtimeShared) ?? {};
  }

  if (update.values) {
    state.values = mergeRecords(state.values, update.values);
  }

  if (runtime && (update.context || update.runtimeContext)) {
    runtime.context = mergeContext(state.context ?? {}, runtime.runtimeContext);
  }
}

export function mergeContext(base: AgentRuntimeContext, overrides: AgentRuntimeContext | undefined): AgentRuntimeContext {
  if (!overrides || Object.keys(overrides).length === 0) {
    return base;
  }

  const merged: AgentRuntimeContext = {...base};
  for (const [key, value] of Object.entries(overrides)) {
    const left = recordSchema.safeParse(merged[key]);
    const right = recordSchema.safeParse(value);
    merged[key] = left.success && right.success ? {...left.data, ...right.data} : value;
  }
  return merged;
}

function assertNoReservedAgentStateInContext(context: AgentRuntimeContext): void {
  for (const key of Object.keys(context)) {
    if (RESERVED_AGENT_CONTEXT_KEYS.has(key)) {
      throw new Error(`"${key}" is reserved for agent state and cannot be written through context updates`);
    }
  }
}

function mergeRecords<T extends Record<string, unknown> | undefined>(
  base: T,
  update: Record<string, unknown>
): T {
  return {
    ...(base ?? {}),
    ...deepClone(update),
  } as T;
}

function mergeRuntimeRecord<T extends Record<string, unknown> | undefined>(
  target: T,
  update: Record<string, unknown>
): T {
  const patch = deepClone(update);

  if (!target) {
    return patch as T;
  }

  Object.assign(target, patch);
  return target;
}
