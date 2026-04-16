/**
 * Glob 工具 — 按文件名模式查找文件，按修改时间排序。
 *
 * 对齐 Claude Code GlobTool：
 * - 排除 node_modules、dist 和所有 VCS 目录
 * - 结果限制 200 条，扫描限制 5000 条
 * - 隐藏文件（.开头目录）默认排除
 */

import {stat} from 'node:fs/promises';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, formatNoResults} from '@tools/utils';

const RESULT_LIMIT = 200;
const SCAN_LIMIT = 5000;

/** 排除的目录段。包含 VCS 目录 + 构建产物。 */
const EXCLUDED_DIRS = new Set([
    'node_modules', '.git', '.svn', '.hg', '.bzr', '.jj', '.sl', 'dist',
]);

const globInputSchema = z.object({
    pattern: z.string().min(1).describe('Glob pattern to match files. Examples: "**/*.ts" (all TypeScript files), "src/**/*.js" (JS files in src), "*.json" (JSON files in current dir)'),
    path: z.string().optional().describe('Directory to search in. If not specified, uses current working directory. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null".'),
});

type GlobInput = z.infer<typeof globInputSchema>;

function isExcluded(filePath: string): boolean {
    const segments = filePath.split(path.sep);
    return segments.some(seg => EXCLUDED_DIRS.has(seg));
}

function hasDotPath(filePath: string): boolean {
    return filePath
        .split(path.sep)
        .some((segment) => segment.startsWith('.') && segment.length > 1);
}

/** 文件 glob 查询工具。 */
export class GlobTool extends StructuredTool<typeof globInputSchema> {
    name = 'glob';
    description = `Finds files matching glob patterns, sorted by modification time (newest first).
Use when: locating files by name/extension, finding all files of a type, exploring project structure.
Don't use when: searching file contents (use grep), need exact path, searching by file size/permissions.
Returns: list of matching absolute paths (max 200 results), automatically excludes node_modules/VCS dirs/dist/hidden directories.`;
    schema = globInputSchema;

    private readonly defaultCwd: string;

    constructor(defaultCwd = process.cwd()) {
        super();
        this.defaultCwd = path.resolve(defaultCwd);
    }

    async _call(input: GlobInput): Promise<string> {
        const searchRoot = path.resolve(input.path ?? this.defaultCwd);

        try {
            const info = await stat(searchRoot);
            if (!info.isDirectory()) {
                return formatError('Not a directory', searchRoot);
            }
        } catch {
            return formatError('Directory not found', searchRoot);
        }

        const collected: string[] = [];

        for await (const relativePath of new Bun.Glob(input.pattern).scan({cwd: searchRoot})) {
            const absolutePath = path.resolve(searchRoot, relativePath);

            if (hasDotPath(absolutePath) || isExcluded(absolutePath)) {
                continue;
            }

            collected.push(absolutePath);
            if (collected.length >= SCAN_LIMIT) {
                break;
            }
        }

        const withStat = await Promise.all(
            collected.map(async (filePath) => {
                try {
                    const info = await stat(filePath);
                    if (!info.isFile()) {
                        return null;
                    }
                    return {filePath, mtime: info.mtimeMs};
                } catch {
                    return null;
                }
            })
        );

        const sorted = withStat
            .filter((entry): entry is { filePath: string; mtime: number } => entry !== null)
            .sort((a, b) => b.mtime - a.mtime)
            .map((entry) => entry.filePath);

        if (sorted.length === 0) {
            return formatNoResults('No files matching the pattern');
        }

        const visible = sorted.slice(0, RESULT_LIMIT);
        if (sorted.length > RESULT_LIMIT) {
            return `${visible.join('\n')}\n... and ${sorted.length - RESULT_LIMIT} more files (consider using a more specific pattern)`;
        }

        return visible.join('\n');
    }
}

/** 创建 GlobTool。 */
export function createGlobTool(defaultCwd = process.cwd()): GlobTool {
    return new GlobTool(defaultCwd);
}
