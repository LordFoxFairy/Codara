import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_STDOUT = 200_000;
const MAX_STDERR = 100_000;
const MAX_OUTPUT = 100_000;

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const bashInputSchema = z.object({
    command: z.string().min(1).describe('Shell command to execute. Supports bash/zsh syntax, pipes, and redirects.'),
    description: z.string().optional().describe('Optional human-readable description of what this command does'),
    timeout: z.number().int().positive().max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT).describe('Timeout in milliseconds. Default: 120000 (2 min), Max: 600000 (10 min)'),
    cwd: z.string().optional().describe('Override working directory for this command only. If not specified, uses persistent cwd from previous commands.'),
    run_in_background: z.boolean().default(false).describe('Run command in background (not yet implemented)'),
});

type BashInput = z.infer<typeof bashInputSchema>;

/**
 * 执行 shell 命令的工具。
 *
 * **注意**: 此工具维护持久化的工作目录状态。
 * 执行 `cd` 命令会影响后续命令的工作目录。
 *
 * @example
 * ```typescript
 * const bash = createBashTool('/home/user');
 *
 * // 执行命令
 * const result = await bash.invoke({
 *     command: 'ls -la'
 * });
 *
 * // cd 会持久化
 * await bash.invoke({command: 'cd subdir'});
 * await bash.invoke({command: 'pwd'}); // 输出: /home/user/subdir
 *
 * // 设置超时
 * await bash.invoke({
 *     command: 'long-running-task',
 *     timeout: 300000 // 5 分钟
 * });
 * ```
 */
export class BashTool extends StructuredTool<typeof bashInputSchema> {
    name = 'bash';
    description = `Executes shell commands in bash/zsh with persistent working directory and timeout control.
Use when: running build scripts, installing packages, checking system state, running tests, git operations.
Don't use when: long-running processes (servers/watchers), interactive commands, need background execution (not yet implemented).
Returns: command stdout/stderr with exit code, or timeout/truncation notice if limits exceeded (stdout 200KB, stderr 100KB, output 100KB).`;
    schema = bashInputSchema;

    /** 当前工作目录（持久化状态） */
    private currentCwd: string;

    constructor(defaultCwd = process.cwd()) {
        super();
        this.currentCwd = path.resolve(defaultCwd);
    }

    async _call(input: BashInput): Promise<string> {
        // TODO: Implement background execution
        // Requirements:
        // 1. Create TaskManager to track background processes
        // 2. Return task ID instead of output
        // 3. Provide API to query task status (getTask, listTasks, stopTask)
        // 4. Handle process cleanup on completion
        // 5. Store output/error for later retrieval
        // See: https://github.com/anthropics/claude-code for reference implementation
        if (input.run_in_background) {
            return 'Error: Background execution is not yet implemented. This feature requires a task manager to track background processes.';
        }

        const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
        const runCwd = path.resolve(input.cwd ?? this.currentCwd);
        const marker = `__CODARA_CWD_${randomUUID()}__`;
        const wrappedCommand = [
            input.command,
            '__EXIT_CODE__=$?',
            `echo "${marker}=$(pwd)"`,
            'exit $__EXIT_CODE__',
        ].join('\n');

        return await new Promise<string>((resolve) => {
            const shell = process.env.SHELL || '/bin/sh';
            const child = spawn(shell, ['-c', wrappedCommand], {
                cwd: runCwd,
                env: {...process.env, TERM: 'dumb'},
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let stdout = '';
            let stderr = '';
            let timedOut = false;

            child.stdout.on('data', (chunk: Buffer) => {
                if (stdout.length < MAX_STDOUT) {
                    stdout += chunk.toString();
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
            }, timeout);

            child.on('close', (code) => {
                clearTimeout(timeoutTimer);
                if (killTimer) {
                    clearTimeout(killTimer);
                }

                const escapedMarker = escapeRegex(marker);
                const cwdMatch = stdout.match(new RegExp(`${escapedMarker}=(.+)$`, 'm'));
                if (cwdMatch?.[1]) {
                    this.currentCwd = cwdMatch[1].trim();
                    stdout = stdout.replace(new RegExp(`${escapedMarker}=.+\n?$`, 'gm'), '');
                }

                let output = [stdout.trim(), stderr.trim() ? `STDERR:\n${stderr.trim()}` : '']
                    .filter(Boolean)
                    .join('\n');

                if (output.length > MAX_OUTPUT) {
                    const head = Math.floor(MAX_OUTPUT / 2);
                    const removed = output.length - MAX_OUTPUT;
                    output =
                        output.slice(0, head) +
                        `\n\n... [truncated ${removed} characters] ...\n\n` +
                        output.slice(-head);
                }

                if (timedOut) {
                    output += '\n[Command timed out]';
                }

                if (code !== 0 && code !== null) {
                    output += `\n[Exit code: ${code}]`;
                }

                resolve(output || '(no output)');
            });

            child.on('error', (error) => {
                clearTimeout(timeoutTimer);
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                resolve(`Error: ${error.message}`);
            });
        });
    }
}

/**
 * 创建 BashTool 实例。
 *
 * @param defaultCwd - 默认工作目录，默认为 process.cwd()
 * @returns 新的 BashTool 实例
 */
export function createBashTool(defaultCwd = process.cwd()): BashTool {
    return new BashTool(defaultCwd);
}
