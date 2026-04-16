/**
 * Write tool prompt — system-level instructions for file writing.
 *
 * Aligned with Claude Code FileWriteTool prompt pattern:
 * - Overwrite behavior warning
 * - Preference for Edit over Write
 * - Secret file avoidance
 */

export const WRITE_TOOL_NAME = 'write_file';

export function getWriteToolPrompt(): string {
  return [
    'Writes a file to the local filesystem.',
    '',
    'Usage:',
    '- This tool will overwrite the existing file if there is one at the provided path.',
    '- If this is an existing file, you MUST use the Read tool first to read the file\'s contents. This tool will fail if you did not read the file first.',
    '- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.',
    '- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.',
    '- Do not commit files that likely contain secrets (.env, credentials.json, etc).',
  ].join('\n');
}
