/**
 * Bash tool prompt — system-level instructions injected into the model context.
 *
 * Aligned with Claude Code BashTool/prompt.ts:
 * - Tool preference guidance (use dedicated tools over bash for file ops)
 * - Multiple command chaining rules (&&, ;, parallel calls)
 * - Git safety protocol
 * - Background process guidance
 * - Timeout documentation
 */

import {TOOL_NAMES} from '@shared/tool-names';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

export function getBashToolPrompt(): string {
  return [
    'Executes a given bash command and returns its output.',
    '',
    "The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).",
    '',
    `IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:`,
    '',
    ` - File search: Use ${TOOL_NAMES.GLOB} (NOT find or ls)`,
    ` - Content search: Use ${TOOL_NAMES.GREP} (NOT grep or rg)`,
    ` - Read files: Use ${TOOL_NAMES.READ_FILE} (NOT cat/head/tail)`,
    ` - Edit files: Use ${TOOL_NAMES.EDIT_FILE} (NOT sed/awk)`,
    ` - Write files: Use ${TOOL_NAMES.WRITE_FILE} (NOT echo >/cat <<EOF)`,
    ` - Communication: Output text directly (NOT echo/printf)`,
    `While the ${TOOL_NAMES.BASH} tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.`,
    '',
    '# Instructions',
    ' - If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists and is the correct location.',
    ' - Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")',
    ' - Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.',
    ` - You may specify an optional timeout in milliseconds (up to ${MAX_TIMEOUT_MS}ms / ${MAX_TIMEOUT_MS / 60000} minutes). By default, your command will timeout after ${DEFAULT_TIMEOUT_MS}ms (${DEFAULT_TIMEOUT_MS / 60000} minutes).`,
    " - You can use the `run_in_background` parameter to run the command in the background. Only use this if you don't need the result immediately and are OK being notified when the command completes later.",
    ' - When issuing multiple commands:',
    `   - If the commands are independent and can run in parallel, make multiple ${TOOL_NAMES.BASH} tool calls in a single message.`,
    "   - If the commands depend on each other and must run sequentially, use a single call with '&&' to chain them together.",
    "   - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.",
    '   - DO NOT use newlines to separate commands (newlines are ok in quoted strings).',
    ' - For git commands:',
    '   - Prefer to create a new commit rather than amending an existing commit.',
    '   - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative.',
    '   - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it.',
    ' - Avoid unnecessary `sleep` commands:',
    '   - Do not sleep between commands that can run immediately.',
    '   - If your command is long running and you would like to be notified when it finishes, use `run_in_background`. No sleep needed.',
    '   - Do not retry failing commands in a sleep loop — diagnose the root cause.',
  ].join('\n');
}
