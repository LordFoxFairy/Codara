import type {AgentRuntimeContext} from '@shared/agent-types';

/**
 * Merge two agent runtime contexts with shallow-merge semantics for nested records.
 *
 * Top-level keys from `overrides` replace those in `base`,
 * except when both sides are plain objects — in that case their
 * entries are shallow-merged ({...left, ...right}).
 */
export function mergeContext(base: AgentRuntimeContext, overrides: AgentRuntimeContext | undefined): AgentRuntimeContext {
  if (!overrides || Object.keys(overrides).length === 0) {
    return base;
  }

  const merged: AgentRuntimeContext = {...base};
  for (const [key, value] of Object.entries(overrides)) {
    const left = merged[key];
    if (isPlainRecord(left) && isPlainRecord(value)) {
      merged[key] = {...left, ...value};
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
