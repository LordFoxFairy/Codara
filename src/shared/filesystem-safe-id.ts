/**
 * Canonical implementation of filesystem-safe ID encoding.
 *
 * Encodes any string into a filename-safe representation by replacing
 * characters outside [A-Za-z0-9_-] with their hex codepoint (~hex~).
 * Also handles empty strings and Windows reserved names.
 */

const SAFE_STORAGE_CHAR = /^[A-Za-z0-9_-]$/;
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

export function toFilesystemSafeId(id: string): string {
  if (!id) {
    return '_';
  }

  const encoded = [...id]
    .map((char) => (SAFE_STORAGE_CHAR.test(char) ? char : `~${char.codePointAt(0)!.toString(16)}~`))
    .join('');

  if (!encoded) {
    return '_';
  }

  if (WINDOWS_RESERVED_NAMES.has(encoded.toUpperCase())) {
    return `_${encoded}`;
  }

  return encoded;
}
