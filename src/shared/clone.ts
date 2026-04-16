/**
 * Deep-clone a value with progressive fallbacks.
 *
 * Why not just `structuredClone`?
 * Agent state objects often carry functions, Proxies, or class instances
 * that structuredClone cannot handle (throws DataCloneError).
 * The three-tier fallback keeps callers safe without requiring them to
 * know whether the value is structuredClone-safe.
 */
export function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // structuredClone fails on functions, Proxies, class instances, etc.
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      if (Array.isArray(value)) return [...value] as T;
      if (value && typeof value === 'object') return {...value} as T;
      return value;
    }
  }
}
