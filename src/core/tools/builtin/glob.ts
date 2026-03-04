import {stat} from 'node:fs/promises';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatNoResults} from '@core/tools/utils';

const RESULT_LIMIT = 200;
const SCAN_LIMIT = 5000;

const globInputSchema = z.object({
    pattern: z.string().min(1).describe('Glob pattern to match files. Examples: "**/*.ts" (all TypeScript files), "src/**/*.js" (JS files in src), "*.json" (JSON files in current dir)'),
    path: z.string().optional().describe('Directory to search in. If not specified, uses current working directory.'),
});

type GlobInput = z.infer<typeof globInputSchema>;

function isExcluded(filePath: string): boolean {
    const normalized = filePath.split(path.sep).join('/');
    return (
        normalized.includes('/node_modules/')
        || normalized.includes('/.git/')
        || normalized.includes('/dist/')
    );
}

function hasDotPath(filePath: string): boolean {
    return filePath
        .split(path.sep)
        .some((segment) => segment.startsWith('.') && segment.length > 1);
}

/**
 * 通过 glob 模式查找文件，按修改时间排序。
 *
 * 自动排除 node_modules、.git、dist 等目录。
 *
 * @example
 * ```typescript
 * const tool = createGlobTool('/project/root');
 *
 * // 查找所有 TypeScript 文件
 * const tsFiles = await tool.invoke({
 *     pattern: '**\/*.ts'
 * });
 *
 * // 在特定目录查找
 * const srcFiles = await tool.invoke({
 *     pattern: '*.ts',
 *     path: '/project/root/src'
 * });
 * ```
 */
export class GlobTool extends StructuredTool<typeof globInputSchema> {
    name = 'glob';
    description = `Finds files matching glob patterns, sorted by modification time (newest first).
Use when: locating files by name/extension, finding all files of a type, exploring project structure.
Don't use when: searching file contents (use grep), need exact path, searching by file size/permissions.
Returns: list of matching absolute paths (max 200 results), automatically excludes node_modules/.git/dist/hidden directories.`;
    schema = globInputSchema;

    private readonly defaultCwd: string;

    constructor(defaultCwd = process.cwd()) {
        super();
        this.defaultCwd = path.resolve(defaultCwd);
    }

    async _call(input: GlobInput): Promise<string> {
        const searchRoot = path.resolve(input.path ?? this.defaultCwd);
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
            return `${visible.join('\n')}\n... and ${sorted.length - RESULT_LIMIT} more files`;
        }

        return visible.join('\n');
    }
}

/**
 * 创建 GlobTool 实例。
 *
 * @param defaultCwd - 默认工作目录，默认为 process.cwd()
 * @returns 新的 GlobTool 实例
 */
export function createGlobTool(defaultCwd = process.cwd()): GlobTool {
    return new GlobTool(defaultCwd);
}
