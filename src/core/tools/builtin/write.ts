import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {validatePath, formatError, countLines, getErrorCode, getErrorMessage} from '@core/tools/utils';

const writeInputSchema = z.object({
    file_path: z.string().min(1)
        .describe('Absolute path where file will be created/overwritten. Parent directories created automatically.'),
    content: z.string()
        .describe('UTF-8 text content to write. Can be empty string for empty file.'),
});

type WriteInput = z.infer<typeof writeInputSchema>;

/**
 * 创建或覆盖文件，写入 UTF-8 内容。
 *
 * 自动创建父目录，处理常见文件系统错误。
 *
 * @example
 * ```typescript
 * const tool = createWriteTool();
 *
 * const result = await tool.invoke({
 *     file_path: '/path/to/new/file.ts',
 *     content: 'export const foo = "bar";'
 * });
 * ```
 */
export class WriteTool extends StructuredTool<typeof writeInputSchema> {
    name = 'write_file';
    description = `Creates or overwrites a file with UTF-8 text content.
Use when: creating new files, replacing entire file contents, generating code/config files.
Don't use when: modifying part of existing file (use edit_file), appending to file, writing binary data.
Returns: success message with line count, or error if permission denied/no space/read-only filesystem.`;
    schema = writeInputSchema;

    async _call(input: WriteInput): Promise<string> {
        const filePath = input.file_path;
        const pathError = validatePath(filePath);
        if (pathError) {
            return pathError;
        }

        try {
            await mkdir(path.dirname(filePath), {recursive: true});
            await writeFile(filePath, input.content, 'utf8');
        } catch (error: unknown) {
            const code = getErrorCode(error);
            if (code === 'EACCES') {
                return formatError('Permission denied', filePath);
            }
            if (code === 'ENOSPC') {
                return formatError('No space left on device', filePath);
            }
            if (code === 'EROFS') {
                return formatError('Read-only file system', filePath);
            }
            return formatError('Write failed', getErrorMessage(error));
        }

        const lineCount = countLines(input.content);
        return `File written: ${filePath} (${lineCount} lines)`;
    }
}

/**
 * 创建 WriteTool 实例。
 *
 * @returns 新的 WriteTool 实例
 */
export function createWriteTool(): WriteTool {
    return new WriteTool();
}
