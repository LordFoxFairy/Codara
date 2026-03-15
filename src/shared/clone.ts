export function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    if (Array.isArray(value)) {
      return [...value] as T;
    }
    if (value && typeof value === 'object') {
      return {...value} as T;
    }
    return value;
  }
}
