/**
 * Shell task registry — tracks detached background shell processes.
 *
 * Spawns shell commands, pipes stdout/stderr into temp files, and exposes
 * status/output APIs consumed by the Bash tool (bash_bg_status / bash_bg_output)
 * and the unified task registry (for TaskOutput / TaskStop tools).
 */

import {spawn, type ChildProcess} from 'node:child_process';
import {createWriteStream, type WriteStream} from 'node:fs';
import {type FileHandle, mkdir, open, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {TaskRegistry} from './task-registry';
import {generateTaskId} from './task-types';
import type {ShellTaskState} from './task-types';

const DEFAULT_MAX_OUTPUT = 100_000;

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

/** Registry that tracks all background processes. */
export class BackgroundProcessRegistry {
    private processes = new Map<string, BackgroundProcessInfo>();
    private childRefs = new Map<string, ChildProcess>();
    private streams = new Map<string, {stdout: WriteStream; stderr: WriteStream}>();

    /** Directory where background process output files are stored. */
    private outputDir: string | undefined;

    /** Optional unified task registry for cross-system task tracking. */
    taskRegistry: TaskRegistry | undefined;

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
        this.taskRegistry?.register(taskState);

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
            this.taskRegistry?.terminate(
                id,
                code === 0 ? 'completed' : 'failed',
                {exitCode: code},
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
            this.taskRegistry?.terminate(id, 'failed', {exitCode: null});
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
    async readOutput(id: string, maxBytes = DEFAULT_MAX_OUTPUT): Promise<{stdout: string; stderr: string} | undefined> {
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

/** Global background process registry singleton. */
export const backgroundProcesses = new BackgroundProcessRegistry();
