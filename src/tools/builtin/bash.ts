/**
 * Bash 工具 — 在持久化工作目录中执行 shell 命令。
 *
 * 对齐 Claude Code BashTool 的核心能力：
 * - 持久化 cwd（通过 marker 探测子进程 pwd 变化）
 * - 后台进程注册表（spawn + 输出文件 + status/output 子命令）
 * - 超时控制（SIGTERM → 5s 后 SIGKILL）
 * - 输出截断（stdout 200KB, stderr 100KB, 合并后 100KB）
 * - head+tail 截断策略（保留首尾各 50%）
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream, type WriteStream} from 'node:fs';
import {type FileHandle, mkdir, open, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {getGlobalTaskRegistry} from '@capability/task/task-registry';
import {generateTaskId} from '@capability/task/task-types';
import type {ShellTaskState} from '@capability/task/task-types';

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_STDOUT = 200_000;
const MAX_STDERR = 100_000;
const MAX_OUTPUT = 100_000;

/* ------------------------------------------------------------------ */
/*  Background Process Registry                                       */
/* ------------------------------------------------------------------ */

export interface BackgroundProcessInfo {
    /** Unique identifier for this background process. */
    id: string;
    /** OS process ID. */
    pid: number;
    /** The command that was executed. */
    command: string;
    /** Human-readable description (if provided). */
    description?: string;
    /** Working directory the command was started in. */
    cwd: string;
    /** Timestamp when the process was spawned. */
    startedAt: number;
    /** Timestamp when the process exited (undefined while running). */
    exitedAt?: number;
    /** Exit code (undefined while running). */
    exitCode?: number | null;
    /** Path to the file where stdout is written. */
    stdoutPath: string;
    /** Path to the file where stderr is written. */
    stderrPath: string;
    /** Current status. */
    status: 'running' | 'completed' | 'failed';
}

/** Singleton registry that tracks all background processes. */
class BackgroundProcessRegistry {
    private processes = new Map<string, BackgroundProcessInfo>();
    private childRefs = new Map<string, ChildProcess>();
    private streams = new Map<string, {stdout: WriteStream; stderr: WriteStream}>();

    /** Directory where background process output files are stored. */
    private outputDir: string | undefined;

    private async ensureOutputDir(): Promise<string> {
        if (!this.outputDir) {
            this.outputDir = path.join(tmpdir(), 'codara-bg');
            await mkdir(this.outputDir, {recursive: true});
        }
        return this.outputDir;
    }

    /** Get the child process reference for a background process (used by TaskStop). */
    getChildProcess(id: string): ChildProcess | undefined {
        return this.childRefs.get(id);
    }

    /** Spawn a command in the background and return its info immediately. */
    async spawn(opts: {
        command: string;
        cwd: string;
        description?: string;
    }): Promise<BackgroundProcessInfo> {
        const id = generateTaskId('shell').slice(0, 9);
        const dir = await this.ensureOutputDir();
        const stdoutPath = path.join(dir, `${id}.stdout`);
        const stderrPath = path.join(dir, `${id}.stderr`);

        const stdoutStream = createWriteStream(stdoutPath);
        const stderrStream = createWriteStream(stderrPath);

        const shell = process.env.SHELL || '/bin/sh';
        const child = spawn(shell, ['-c', opts.command], {
            cwd: opts.cwd,
            env: {...process.env, TERM: 'dumb'},
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: true,
        });

        // Pipe output to files.
        child.stdout?.pipe(stdoutStream);
        child.stderr?.pipe(stderrStream);

        // Allow the parent process to exit independently.
        child.unref();

        const info: BackgroundProcessInfo = {
            id,
            pid: child.pid!,
            command: opts.command,
            description: opts.description,
            cwd: opts.cwd,
            startedAt: Date.now(),
            stdoutPath,
            stderrPath,
            status: 'running',
        };

        this.processes.set(id, info);
        this.childRefs.set(id, child);
        this.streams.set(id, {stdout: stdoutStream, stderr: stderrStream});

        // Register with unified task registry.
        const taskState: ShellTaskState = {
            id,
            type: 'shell',
            status: 'running',
            description: opts.description ?? opts.command,
            startTime: info.startedAt,
            outputOffset: 0,
            command: opts.command,
            pid: child.pid!,
            cwd: opts.cwd,
            stdoutPath,
            stderrPath,
        };
        getGlobalTaskRegistry().register(taskState);

        child.on('close', (code) => {
            info.exitedAt = Date.now();
            info.exitCode = code;
            info.status = code === 0 ? 'completed' : 'failed';
            this.childRefs.delete(id);
            const s = this.streams.get(id);
            if (s) {
                s.stdout.end();
                s.stderr.end();
                this.streams.delete(id);
            }
            // Sync with unified task registry.
            getGlobalTaskRegistry().terminate(
                id,
                code === 0 ? 'completed' : 'failed',
                {exitCode: code} as Partial<ShellTaskState>,
            );
        });

        child.on('error', () => {
            info.exitedAt = Date.now();
            info.exitCode = null;
            info.status = 'failed';
            this.childRefs.delete(id);
            const s = this.streams.get(id);
            if (s) {
                s.stdout.end();
                s.stderr.end();
                this.streams.delete(id);
            }
            // Sync with unified task registry.
            getGlobalTaskRegistry().terminate(id, 'failed', {exitCode: null} as Partial<ShellTaskState>);
        });

        return info;
    }

    /** Get info for a specific process. */
    get(id: string): BackgroundProcessInfo | undefined {
        return this.processes.get(id);
    }

    /** List all tracked background processes. */
    list(): BackgroundProcessInfo[] {
        return [...this.processes.values()];
    }

    /** Read the output files for a background process (up to maxBytes). */
    async readOutput(id: string, maxBytes = MAX_OUTPUT): Promise<{stdout: string; stderr: string} | undefined> {
        const info = this.processes.get(id);
        if (!info) return undefined;

        const readSafe = async (filePath: string): Promise<string> => {
            let fh: FileHandle | undefined;
            try {
                const s = await stat(filePath);
                if (s.size === 0) return '';
                const readSize = Math.min(s.size, maxBytes);
                const buf = Buffer.alloc(readSize);
                fh = await open(filePath, 'r');
                await fh.read(buf, 0, readSize, 0);
                const text = buf.toString('utf8');
                if (s.size > maxBytes) {
                    return text + `\n... [truncated, ${s.size - maxBytes} bytes remaining]`;
                }
                return text;
            } catch {
                return '';
            } finally {
                await fh?.close();
            }
        };

        return {
            stdout: await readSafe(info.stdoutPath),
            stderr: await readSafe(info.stderrPath),
        };
    }

    /** Remove a completed/failed process from the registry. */
    remove(id: string): boolean {
        const info = this.processes.get(id);
        if (!info || info.status === 'running') return false;
        this.processes.delete(id);
        return true;
    }
}

/** Global background process registry. */
export const backgroundProcesses = new BackgroundProcessRegistry();

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const bashInputSchema = z.object({
    command: z.string().min(1).describe('Shell command to execute. Supports bash/zsh syntax, pipes, and redirects.'),
    description: z.string().optional().describe('Optional human-readable description of what this command does'),
    timeout: z.number().int().positive().max(MAX_TIMEOUT).default(DEFAULT_TIMEOUT).describe('Timeout in milliseconds. Default: 120000 (2 min), Max: 600000 (10 min)'),
    cwd: z.string().optional().describe('Override working directory for this command only. If not specified, uses persistent cwd from previous commands.'),
    run_in_background: z.boolean().default(false).describe('Run command in background and return immediately. Output is written to a temp file and can be read later. Returns the background process ID.'),
});

type BashInput = z.infer<typeof bashInputSchema>;

/** Shell 命令执行工具（维护持久化 cwd）。 */
export class BashTool extends StructuredTool<typeof bashInputSchema> {
    name = 'bash';
    description = `Executes shell commands in bash/zsh with persistent working directory and timeout control.
Use when: running build scripts, installing packages, checking system state, running tests, git operations, background processes.
When run_in_background is true, the command is spawned detached and the tool returns immediately with a process ID. Use "bash_bg_status" as command to check status, or "bash_bg_output <id>" to read output.
Returns: command stdout/stderr with exit code, or timeout/truncation notice if limits exceeded (stdout 200KB, stderr 100KB, output 100KB).`;
    schema = bashInputSchema;

    /** 当前工作目录。 */
    private currentCwd: string;

    constructor(defaultCwd = process.cwd()) {
        super();
        this.currentCwd = path.resolve(defaultCwd);
    }

    async _call(input: BashInput): Promise<string> {
        // 内置后台进程管理命令。
        if (input.command.startsWith('bash_bg_')) {
            return this.handleBackgroundCommand(input.command);
        }

        // 后台执行：立即返回。
        if (input.run_in_background) {
            const runCwd = path.resolve(input.cwd ?? this.currentCwd);
            const info = await backgroundProcesses.spawn({
                command: input.command,
                cwd: runCwd,
                description: input.description,
            });
            return `Process started in background (PID: ${info.pid}, ID: ${info.id})\nUse command "bash_bg_status" to list all background processes.\nUse command "bash_bg_output ${info.id}" to read its output.`;
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

    /** 处理后台进程管理命令。 */
    private async handleBackgroundCommand(command: string): Promise<string> {
        const parts = command.split(/\s+/);
        const subCommand = parts[0];

        if (subCommand === 'bash_bg_status') {
            const processes = backgroundProcesses.list();
            if (processes.length === 0) {
                return 'No background processes.';
            }
            const lines = processes.map((p) => {
                const elapsed = p.exitedAt
                    ? `${((p.exitedAt - p.startedAt) / 1000).toFixed(1)}s`
                    : `${((Date.now() - p.startedAt) / 1000).toFixed(1)}s (running)`;
                const exitInfo = p.exitCode !== undefined ? ` exit=${p.exitCode}` : '';
                return `[${p.id}] PID=${p.pid} status=${p.status}${exitInfo} elapsed=${elapsed} cmd="${p.command}"`;
            });
            return `Background processes (${processes.length}):\n${lines.join('\n')}`;
        }

        if (subCommand === 'bash_bg_output') {
            const id = parts[1];
            if (!id) {
                return 'Usage: bash_bg_output <process_id>';
            }
            const info = backgroundProcesses.get(id);
            if (!info) {
                return `Error: No background process found with ID "${id}".`;
            }
            const output = await backgroundProcesses.readOutput(id);
            if (!output) {
                return `Error: Could not read output for process "${id}".`;
            }
            const statusLine = `[${info.id}] status=${info.status} PID=${info.pid}`;
            const parts_out: string[] = [statusLine];
            if (output.stdout) {
                parts_out.push(`STDOUT:\n${output.stdout}`);
            }
            if (output.stderr) {
                parts_out.push(`STDERR:\n${output.stderr}`);
            }
            if (!output.stdout && !output.stderr) {
                parts_out.push('(no output yet)');
            }
            if (info.exitCode !== undefined && info.exitCode !== null && info.exitCode !== 0) {
                parts_out.push(`[Exit code: ${info.exitCode}]`);
            }
            return parts_out.join('\n');
        }

        return `Unknown background command: "${command}". Available: bash_bg_status, bash_bg_output <id>`;
    }
}

/** 创建 BashTool。 */
export function createBashTool(defaultCwd = process.cwd()): BashTool {
    return new BashTool(defaultCwd);
}
