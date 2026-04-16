/** Convert an unknown thrown value to a proper Error instance. */
export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** Format an error message with an optional prefix. */
export function formatErrorMessage(error: unknown, prefix?: string): string {
  const message = toError(error).message;
  return prefix ? `${prefix}: ${message}` : message;
}
