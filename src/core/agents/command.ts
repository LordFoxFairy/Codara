import type {BaseMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext, AgentRuntimeValues} from '@core/agents/contract/agent';

export interface AgentStateUpdate {
  messages?: BaseMessage[];
  context?: AgentRuntimeContext;
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
  update: AgentStateUpdate | undefined
): void {
  if (!update) {
    return;
  }

  if (Array.isArray(update.messages) && update.messages.length > 0) {
    state.messages.push(...update.messages);
  }

  if (update.context) {
    state.context = mergeRecords(state.context, update.context);
  }

  if (update.values) {
    state.values = mergeRecords(state.values, update.values);
  }
}

function mergeRecords<T extends Record<string, unknown> | undefined>(
  base: T,
  update: Record<string, unknown>
): T {
  return {
    ...(base ?? {}),
    ...cloneRecord(update),
  } as T;
}

function cloneRecord<T extends Record<string, unknown>>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return {...value};
  }
}
