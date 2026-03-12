export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function formatErrorMessage(error: unknown, prefix?: string): string {
  const message = toError(error).message;
  return prefix ? `${prefix}: ${message}` : message;
}
