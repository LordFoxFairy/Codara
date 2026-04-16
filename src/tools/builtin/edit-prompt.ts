/**
 * Edit tool prompt — system-level instructions for file editing.
 *
 * Aligned with Claude Code FileEditTool prompt pattern:
 * - Exact string matching requirements
 * - Indentation preservation
 * - Quote normalization behavior
 * - Replace-all vs single-match semantics
 */

export const EDIT_TOOL_NAME = 'edit_file';

export function getEditToolPrompt(): string {
  return [
    'Performs exact string replacements in files.',
    '',
    'Usage:',
    '- You must use your Read tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.',
    '- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix.',
    '- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.',
    '- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`.',
    '- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.',
    '- Quote normalization: curly quotes are automatically mapped to straight quotes for matching.',
    '- Deletion: when new_string is empty and old_string is followed by a newline, the trailing newline is also removed to avoid blank lines.',
    '- File creation: if old_string is empty and the file does not exist, a new file is created with new_string as content.',
  ].join('\n');
}
