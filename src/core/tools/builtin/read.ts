import {readFile, stat} from 'node:fs/promises';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {validatePath, formatError, getErrorCode, getErrorMessage} from '@core/tools/utils';

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
const MAX_LINE_LENGTH = 2000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const readInputSchema = z.object({
    file_path: z.string().min(1)
        .describe('Absolute path to the file. Must exist and be readable.'),
    offset: z.number().int().min(0).default(0)
        .describe('Starting line number (0-based). Default: 0'),
    limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT)
        .describe('Maximum lines to read. Default: 2000, Max: 5000'),
});

type ReadInput = z.infer<typeof readInputSchema>;

function isBinary(buffer: Buffer): boolean {
    const probe = buffer.subarray(0, 512);
    return probe.includes(0);
}

/**
 * 读取文件内容并返回带行号的文本。
 *
 * 支持范围读取、二进制检测和行长度截断。
 *
 * @example
 * ```typescript
 * const tool = createReadTool();
 *
 * // 读取整个文件
 * const result = await tool.invoke({
 *     file_path: '/path/to/file.ts'
 * });
 *
 * // 读取指定范围
 * const partial = await tool.invoke({
 *     file_path: '/path/to/file.ts',
 *     offset: 10,
 *     limit: 50
 * });
 * ```
 */
export class ReadTool extends StructuredTool<typeof readInputSchema> {
    name = 'read_file';
    description = `Reads file content with line numbers in format "lineNum→content".
Use when: examining source code, checking file contents before editing, reading configuration files.
Don't use when: file is binary, path is directory, need to write/modify file.
Returns: formatted text with line numbers, or error message if file not found/not readable.`;
    schema = readInputSchema;

    async _call(input: ReadInput): Promise<string> {
        const filePath = input.file_path;
        const pathError = validatePath(filePath);
        if (pathError) {
            return pathError;
        }

        // 检查文件大小和类型
        let fileSize: number;
        try {
            const stats = await stat(filePath);
            if (stats.isDirectory()) {
                return formatError('Path is a directory', filePath);
            }
            fileSize = stats.size;
        } catch (error: unknown) {
            const code = getErrorCode(error);
            if (code === 'ENOENT') {
                return formatError('File not found', filePath);
            }
            return formatError('Stat failed', getErrorMessage(error));
        }

        if (fileSize === 0) {
            return `(empty file: ${filePath})`;
        }

        if (fileSize > MAX_FILE_SIZE) {
            return formatError(
                'File too large',
                `${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`,
                'use offset/limit to read in chunks'
            );
        }

        let buffer: Buffer;
        try {
            buffer = await readFile(filePath);
        } catch (error: unknown) {
            return formatError('Read failed', getErrorMessage(error));
        }

        if (isBinary(buffer)) {
            return formatError('Binary file detected', `${buffer.length} bytes`, filePath);
        }

        const content = buffer.toString('utf8');
        const lines = content.split('\n');
        const offset = input.offset;
        const limit = input.limit;
        const selected = lines.slice(offset, offset + limit);

        if (!selected.length) {
            return `No lines found in range for ${filePath}`;
        }

        return selected
            .map((line, index) => {
                const lineNumber = offset + index + 1;
                const visible = line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}...` : line;
                return `${String(lineNumber).padStart(6, ' ')}→${visible}`;
            })
            .join('\n');
    }
}

/**
 * 创建 ReadTool 实例。
 *
 * @returns 新的 ReadTool 实例
 */
export function createReadTool(): ReadTool {
    return new ReadTool();
}
