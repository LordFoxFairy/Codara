/**
 * Shared utility functions for review middleware modules.
 * These are internal helpers — not part of the public API.
 */

export function readReviewContext(runtimeContext: unknown): Record<string, unknown> {
  const root = readRecord(runtimeContext);
  const nested = readRecord(root.review);
  return Object.keys(nested).length > 0 ? nested : root;
}

export function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
