/**
 * 将未知错误转换为 Error 实例。
 */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 格式化错误消息。
 */
export function formatErrorMessage(error: unknown, prefix?: string): string {
  const err = toError(error);
  return prefix ? `${prefix}: ${err.message}` : err.message;
}
