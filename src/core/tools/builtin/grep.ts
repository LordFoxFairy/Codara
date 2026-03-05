import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, formatNoResults} from '@core/tools/utils';

const DEFAULT_TIMEOUT = 30_000;
const MAX_OUTPUT_CHARS = 500_000;
const MAX_OUTPUT_LINES = 500;
const MAX_STDERR = 50_000;

const execFileAsync = promisify(execFile);

const grepInputSchema = z.object({
    pattern: z.string().min(1).describe('Regex pattern to search for. Examples: "function.*test", "TODO:", "import.*from"'),
    path: z.string().optional().describe('File or directory to search in. If not specified, searches current directory recursively.'),
    glob: z.string().optional().describe('Filter files by glob pattern. Example: "*.ts" to search only TypeScript files'),
    output_mode: z.enum(['content', 'files_with_matches', 'count']).default('files_with_matches').describe('Output format: "content" shows matching lines with line numbers, "files_with_matches" shows only file paths (default), "count" shows match counts per file'),
    multiline: z.boolean().default(false).describe('Enable multiline matching where patterns can span multiple lines. Use for complex code patterns.'),
    context: z.number().int().min(0).max(100).optional().describe('Number of context lines to show before AND after each match'),
    '-A': z.number().int().min(0).max(100).optional().describe('Number of lines to show AFTER each match'),
    '-B': z.number().int().min(0).max(100).optional().describe('Number of lines to show BEFORE each match'),
    '-i': z.boolean().optional().describe('Case insensitive search (overrides case_sensitive when true)'),
    case_sensitive: z.boolean().default(false).describe('Case sensitive search (default: false)'),
    head_limit: z.number().int().min(0).default(MAX_OUTPUT_LINES).describe('Limit output to first N lines/entries. Default: 500'),
    offset: z.number().int().min(0).default(0).describe('Skip first N lines/entries before applying head_limit'),
});

type GrepInput = z.infer<typeof grepInputSchema>;

interface CommandResult {
    code: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    truncated: boolean;
}

async function runCommand(
    command: string,
    args: string[],
    timeoutMs: number,
    maxOutputChars: number
): Promise<CommandResult> {
    return await new Promise<CommandResult>((resolve) => {
        const child = spawn(command, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let truncated = false;

        child.stdout.on('data', (chunk: Buffer) => {
            if (stdout.length < maxOutputChars) {
                stdout += chunk.toString();
            } else {
                truncated = true;
            }
        });

        child.stderr.on('data', (chunk: Buffer) => {
            if (stderr.length < MAX_STDERR) {
                stderr += chunk.toString();
            }
        });

        let killTimer: ReturnType<typeof setTimeout> | undefined;
        const timeoutTimer = setTimeout(() => {
            timedOut = true;
            child.kill('SIGTERM');
            killTimer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                } catch {
                    // process already exited
                }
            }, 5000);
        }, timeoutMs);

        child.on('close', (code) => {
            clearTimeout(timeoutTimer);
            if (killTimer) {
                clearTimeout(killTimer);
            }
            resolve({code, stdout, stderr, timedOut, truncated});
        });

        child.on('error', (error) => {
            clearTimeout(timeoutTimer);
            if (killTimer) {
                clearTimeout(killTimer);
            }
            resolve({code: -1, stdout: '', stderr: error.message, timedOut: false, truncated: false});
        });
    });
}

/** 文件内容搜索工具（优先 `rg`，回退 `grep`）。 */
export class GrepTool extends StructuredTool<typeof grepInputSchema> {
    name = 'grep';
    description = `Searches file contents using regex patterns with ripgrep (rg) or grep fallback.
Use when: finding code patterns, locating TODO/FIXME comments, searching for function/class definitions, analyzing code usage.
Don't use when: searching by filename (use glob), need exact file path, searching binary files.
Returns: matching lines with line numbers (content mode) or file paths (files mode), supports multiline patterns and context lines.`;
    schema = grepInputSchema;

    private readonly defaultCwd: string;
    private rgAvailable: boolean | undefined;

    constructor(defaultCwd = process.cwd()) {
        super();
        this.defaultCwd = path.resolve(defaultCwd);
    }

    async _call(input: GrepInput): Promise<string> {
        const target = path.resolve(input.path ?? this.defaultCwd);
        const caseSensitive = input['-i'] === true ? false : (input.case_sensitive ?? false);
        const outputMode = input.output_mode ?? 'files_with_matches';
        const timeout = DEFAULT_TIMEOUT;

        const useRg = await this.hasRipgrep();
        const args: string[] = [];
        let command = 'rg';

        if (useRg) {
            if (outputMode === 'files_with_matches') {
                args.push('--files-with-matches');
            } else if (outputMode === 'count') {
                args.push('--count');
            } else {
                args.push('--line-number', '--color', 'never');
            }

            if (!caseSensitive) {
                args.push('-i');
            }

            if (input.multiline) {
                args.push('-U', '--multiline-dotall');
            }

            if (input['-A'] !== undefined) {
                args.push('-A', String(input['-A']));
            }
            if (input['-B'] !== undefined) {
                args.push('-B', String(input['-B']));
            }
            if (typeof input.context === 'number') {
                args.push('-C', String(input.context));
            }

            if (input.glob) {
                args.push('-g', input.glob);
            }

            args.push(input.pattern, target);
        } else {
            command = 'grep';
            args.push('-R', '-E');

            if (outputMode === 'files_with_matches') {
                args.push('-l');
            } else if (outputMode === 'count') {
                args.push('-c');
            } else {
                args.push('-n');
            }

            if (!caseSensitive) {
                args.push('-i');
            }

            if (input['-A'] !== undefined) {
                args.push('-A', String(input['-A']));
            }
            if (input['-B'] !== undefined) {
                args.push('-B', String(input['-B']));
            }
            if (typeof input.context === 'number') {
                args.push('-C', String(input.context));
            }

            if (input.glob) {
                args.push(`--include=${input.glob}`);
            }

            args.push(input.pattern, target);
        }

        const result = await runCommand(command, args, timeout, MAX_OUTPUT_CHARS);

        if (result.timedOut) {
            return formatError('Command timed out', 'grep exceeded timeout limit');
        }

        if (result.code === 1) {
            return formatNoResults('No matches found');
        }

        if (result.code !== 0 && result.code !== null) {
            const errorMsg = result.stderr.trim() || result.stdout.trim() || 'grep failed';
            return formatError('Grep failed', errorMsg, `exit code: ${result.code}`);
        }

        const lines = result.stdout
            .trim()
            .split('\n')
            .filter(Boolean);

        if (!lines.length) {
            return formatNoResults('No matches found');
        }

        const offset = input.offset ?? 0;
        const headLimit = input.head_limit ?? MAX_OUTPUT_LINES;
        const selected = lines.slice(offset, offset + headLimit);

        if (!selected.length) {
            return formatNoResults('No matches found in specified range');
        }

        let output = selected.join('\n');

        if (offset + selected.length < lines.length) {
            output += `\n... (${lines.length - offset - selected.length} more lines)`;
        }

        if (result.truncated) {
            output += '\n... (output truncated)';
        }

        return output;
    }

    private async hasRipgrep(): Promise<boolean> {
        if (this.rgAvailable !== undefined) {
            return this.rgAvailable;
        }

        try {
            await execFileAsync('rg', ['--version'], {timeout: 5000});
            this.rgAvailable = true;
        } catch {
            this.rgAvailable = false;
        }

        return this.rgAvailable;
    }
}

/** 创建 GrepTool。 */
export function createGrepTool(defaultCwd = process.cwd()): GrepTool {
    return new GrepTool(defaultCwd);
}
