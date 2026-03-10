/**
 * 通用深度克隆函数
 * 优先使用 structuredClone，失败时回退到浅拷贝
 */
export function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    // 回退到浅拷贝（适用于简单对象）
    if (Array.isArray(value)) {
      return [...value] as T;
    }
    if (value && typeof value === 'object') {
      return {...value} as T;
    }
    return value;
  }
}
