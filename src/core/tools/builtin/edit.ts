import {readFile, writeFile} from 'node:fs/promises';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {validatePath, formatError, countLines, countOccurrences, getErrorCode, getErrorMessage} from '@core/tools/utils';

const editInputSchema = z.object({
    file_path: z.string().min(1).describe('Absolute path to the file. Must exist and be writable.'),
    old_string: z.string().min(1).describe('Exact text to find and replace. Must match exactly including whitespace and newlines.'),
    new_string: z.string().describe('Replacement text. Can be empty string to delete the old_string.'),
    replace_all: z.boolean().default(false).describe('If true, replace all occurrences. If false (default), only replace first occurrence and error if multiple matches found.'),
});

type EditInput = z.infer<typeof editInputSchema>;

/** 文件精确替换工具。 */
export class EditTool extends StructuredTool<typeof editInputSchema> {
    name = 'edit_file';
    description = `Edits file by replacing exact text snippets with new content.
Use when: modifying specific code sections, fixing bugs, updating configuration values, refactoring code.
Don't use when: creating new files (use write_file), need fuzzy matching, replacing across multiple files.
Returns: edit summary with line count changes (-X +Y lines), or error if file not found/string not found/ambiguous match.`;
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

        let source: string;
        try {
            source = await readFile(filePath, 'utf8');
        } catch (error: unknown) {
            const code = getErrorCode(error);
            if (code === 'ENOENT') {
                return formatError('File not found', filePath);
            }
            if (code === 'EISDIR') {
                return formatError('Path is a directory', filePath);
            }
            return formatError('Read failed', getErrorMessage(error));
        }

        const occurrences = countOccurrences(source, input.old_string);
        if (occurrences === 0) {
            return formatError('String not found', 'old_string not found in file', filePath);
        }

        if (!input.replace_all && occurrences > 1) {
            return formatError('Ambiguous match', `old_string appears ${occurrences} times`, 'set replace_all=true or provide more context');
        }

        let next: string;
        let replacements: number;

        if (input.replace_all) {
            next = source.split(input.old_string).join(input.new_string);
            replacements = occurrences;
        } else {
            next = source.replace(input.old_string, input.new_string);
            replacements = 1;
        }

        try {
            await writeFile(filePath, next, 'utf8');
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

        const oldLines = countLines(input.old_string);
        const newLines = countLines(input.new_string);
        const netChange = (newLines - oldLines) * replacements;
        const sign = netChange >= 0 ? '+' : '';
        return `Edited ${filePath}: ${sign}${netChange} lines (${replacements} replacement${replacements > 1 ? 's' : ''})`;
    }
}

/** 创建 EditTool。 */
export function createEditTool(): EditTool {
    return new EditTool();
}
