/**
 * Read tool prompt — system-level instructions for file reading.
 *
 * Aligned with Claude Code FileReadTool prompt pattern:
 * - Usage guidance and limitations
 * - Supported file types
 * - Line number format documentation
 */

export const READ_TOOL_NAME = 'read_file';

export function getReadToolPrompt(): string {
  return [
    'Reads a file from the local filesystem. You can access any file directly by using this tool.',
    '',
    'Usage:',
    '- The file_path parameter must be an absolute path, not a relative path',
    '- By default, it reads up to 2000 lines starting from the beginning of the file',
    '- When you already know which part of the file you need, only read that part. This can be important for larger files.',
    '- Results are returned using cat -n format, with line numbers starting at 1',
    '- This tool allows reading images (eg PNG, JPG, etc). When reading an image file the contents are presented as base64.',
    '- This tool can read PDF files (.pdf). For large PDFs, provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Maximum 20 pages per request.',
    '- This tool can read Jupyter notebooks (.ipynb files) via the notebook_read tool.',
    '- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.',
    '- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.',
  ].join('\n');
}
