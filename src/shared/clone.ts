export function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // structuredClone fails on functions, Proxies, etc.
    // JSON roundtrip handles nested objects but drops functions/undefined
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      // Last resort: shallow copy
      if (Array.isArray(value)) return [...value] as T;
      if (value && typeof value === 'object') return {...value} as T;
      return value;
    }
  }
}
