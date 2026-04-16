import type {AgentRuntimeContext} from '@shared/contracts/agent-types';
import {z} from 'zod';

const recordSchema = z.record(z.string(), z.unknown());

/**
 * Merge two agent runtime contexts with deep-merge semantics for nested records.
 */
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
