/**
 * FileEdit 工具 — 通过精确字符串替换修改文件。
 *
 * 对齐 Claude Code FileEditTool：
 * - 引号标准化（弯引号 → 直引号）处理 LLM 输出限制
 * - 删除操作时智能去除尾部换行（避免留空行）
 * - old_string 为空 + 文件不存在 = 创建新文件
 * - 1GiB 文件大小上限（V8/Bun 字符串安全极限）
 */

import {mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {
    validatePath,
    formatError,
    countLines,
    countOccurrences,
    findActualString,
    getErrorCode,
    getErrorMessage,
} from '@tools/utils';

const MAX_FILE_SIZE = 1024 * 1024 * 1024; // 1GiB — aligned with Claude Code

const editInputSchema = z.object({
    file_path: z.string().min(1).describe('Absolute path to the file. Must exist and be writable.'),
    old_string: z.string().describe('Exact text to find and replace. Must match exactly including whitespace and newlines. Empty string with non-existent file creates a new file.'),
    new_string: z.string().describe('Replacement text. Can be empty string to delete the old_string.'),
    replace_all: z.boolean().default(false).describe('If true, replace all occurrences. If false (default), only replace first occurrence and error if multiple matches found.'),
});

type EditInput = z.infer<typeof editInputSchema>;

/**
 * Apply edit: replace old_string with new_string in content.
 *
 * When new_string is empty (deletion) and old_string does NOT end with '\n'
 * but appears followed by '\n' in the file, strip that trailing newline too
 * to avoid leaving blank lines. Aligned with Claude Code applyEditToFile().
 */
function applyEdit(content: string, oldString: string, newString: string, replaceAll: boolean): string {
    const replaceFn = replaceAll
        ? (c: string, s: string, r: string) => c.replaceAll(s, () => r)
        : (c: string, s: string, r: string) => c.replace(s, () => r);

    if (newString !== '') {
        return replaceFn(content, oldString, newString);
    }

    // Deletion: smart trailing-newline strip
    const stripTrailingNewline = !oldString.endsWith('\n') && content.includes(oldString + '\n');
    return stripTrailingNewline
        ? replaceFn(content, oldString + '\n', newString)
        : replaceFn(content, oldString, newString);
}

/** 文件精确替换工具。 */
export class EditTool extends StructuredTool<typeof editInputSchema> {
    name = 'edit_file';
    description = `Edits file by replacing exact text snippets with new content.
Use when: modifying specific code sections, fixing bugs, updating configuration values, refactoring code.
Don't use when: need fuzzy matching, replacing across multiple files.
Supports: quote normalization (curly quotes match straight quotes), file creation (empty old_string on non-existent file).
Returns: edit summary with line count changes (-X +Y lines), or error if string not found/ambiguous match.`;
    schema = editInputSchema;

    async _call(input: EditInput): Promise<string> {
        const filePath = input.file_path;
        const pathError = validatePath(filePath);
        if (pathError) {
            return pathError;
        }

        if (input.old_string === input.new_string) {
            return 'Warning: old_string and new_string are identical; no changes applied.';
        }

        // --- File existence & size check ---
        let source: string | null = null;
        try {
            const stats = await stat(filePath);
            if (stats.isDirectory()) {
                return formatError('Path is a directory', filePath);
            }
            if (stats.size > MAX_FILE_SIZE) {
                return formatError(
                    'File too large',
                    `${(stats.size / 1024 / 1024).toFixed(2)}MB exceeds limit`,
                );
            }
            source = await readFile(filePath, 'utf8');
        } catch (error: unknown) {
            const code = getErrorCode(error);
            if (code === 'ENOENT') {
                // File doesn't exist — allow creation when old_string is empty
                if (input.old_string === '') {
                    return this.createNewFile(filePath, input.new_string);
                }
                return formatError('File not found', filePath);
            }
            if (code === 'EISDIR') {
                return formatError('Path is a directory', filePath);
            }
            return formatError('Read failed', getErrorMessage(error));
        }

        // --- File creation: old_string empty on existing file ---
        if (input.old_string === '') {
            if (source.trim() !== '') {
                return formatError('File already exists', 'use old_string to specify text to replace', filePath);
            }
            // Empty file — replace content
            return this.writeAndReport(filePath, input.new_string, source, 1);
        }

        // --- Find actual match (with quote normalization) ---
        const actualOldString = findActualString(source, input.old_string) ?? input.old_string;
        const occurrences = countOccurrences(source, actualOldString);

        if (occurrences === 0) {
            return formatError('String not found', 'old_string not found in file', filePath);
        }

        if (!input.replace_all && occurrences > 1) {
            return formatError(
                'Ambiguous match',
                `old_string appears ${occurrences} times`,
                'set replace_all=true or provide more context',
            );
        }

        const next = applyEdit(source, actualOldString, input.new_string, input.replace_all);
        const replacements = input.replace_all ? occurrences : 1;

        return this.writeAndReport(filePath, next, source, replacements);
    }

    /** 创建新文件（含自动创建父目录）。 */
    private async createNewFile(filePath: string, content: string): Promise<string> {
        try {
            await mkdir(path.dirname(filePath), {recursive: true});
            await writeFile(filePath, content, 'utf8');
        } catch (error: unknown) {
            return this.handleWriteError(error, filePath);
        }
        const lineCount = countLines(content);
        return `Created ${filePath} (${lineCount} lines)`;
    }

    /** 写入文件并返回编辑报告。 */
    private async writeAndReport(filePath: string, next: string, source: string, replacements: number): Promise<string> {
        try {
            await writeFile(filePath, next, 'utf8');
        } catch (error: unknown) {
            return this.handleWriteError(error, filePath);
        }

        const oldLines = countLines(source);
        const newLines = countLines(next);
        const netChange = newLines - oldLines;
        const sign = netChange >= 0 ? '+' : '';
        return `Edited ${filePath}: ${sign}${netChange} lines (${replacements} replacement${replacements > 1 ? 's' : ''})`;
    }

    /** 统一写入错误处理。 */
    private handleWriteError(error: unknown, filePath: string): string {
        const code = getErrorCode(error);
        if (code === 'EACCES') return formatError('Permission denied', filePath);
        if (code === 'ENOSPC') return formatError('No space left on device', filePath);
        if (code === 'EROFS') return formatError('Read-only file system', filePath);
        return formatError('Write failed', getErrorMessage(error));
    }
}

/** 创建 EditTool。 */
export function createEditTool(): EditTool {
    return new EditTool();
}
