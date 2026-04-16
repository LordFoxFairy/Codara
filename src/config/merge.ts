import type {CodaraSettings} from '@config/schema';

/**
 * Deep-merge two settings objects. Arrays are replaced (not concatenated) —
 * this matches Claude Code's settingsMergeCustomizer for array fields like
 * `alwaysAllow` where replacement is the expected semantic ("my project
 * overrides the user allow-list").
 */
export function mergeSettings(base: CodaraSettings, overlay: CodaraSettings): CodaraSettings {
  return deepMerge(base, overlay) as CodaraSettings;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = {...target};
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    const targetValue = result[key];
    if (sourceValue === undefined) continue;
    if (Array.isArray(sourceValue)) {
      result[key] = [...sourceValue];
    } else if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(targetValue as Record<string, unknown>, sourceValue as Record<string, unknown>);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
