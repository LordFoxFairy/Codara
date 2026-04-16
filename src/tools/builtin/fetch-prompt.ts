/**
 * Fetch tool prompt — system-level instructions for HTTP requests.
 *
 * Aligned with Claude Code WebFetchTool prompt pattern:
 * - Protocol restrictions
 * - Timeout and size limits
 * - Usage guidance
 */

export const FETCH_TOOL_NAME = 'fetch_url';

export function getFetchToolPrompt(): string {
  return [
    'Fetches content from HTTP/HTTPS URLs.',
    '',
    'Usage:',
    '- Only HTTP and HTTPS protocols are supported',
    '- Default timeout: 15 seconds (max 120 seconds)',
    '- Default max response size: 1MB (max 10MB)',
    '- Response body is streamed and truncated at the size limit to prevent OOM',
    '- Returns JSON with status, headers, and body content',
    '- For large binary downloads, use bash with curl/wget instead',
  ].join('\n');
}
