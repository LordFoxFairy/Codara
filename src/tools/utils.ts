/**
 * Tool utilities — shared helpers for error formatting, string operations,
 * path validation, and text normalization.
 *
 * Aligned with Claude Code's tool utility patterns:
 * - Consistent error/result formatting across all tools
 * - Quote normalization for robust string matching (edit tool)
 * - Path security validation (traversal, null bytes, length)
 */

import path from 'node:path';

// ── Error & result formatting ───────────────────────────────────────────

/** 构造统一错误消息。 */
export function formatError(type: string, details: string, context?: string): string {
    return context
        ? `Error: ${type}: ${details} (${context})`
        : `Error: ${type}: ${details}`;
}

/** 构造统一的"无结果"消息。 */
export function formatNoResults(message: string): string {
    return `No results: ${message}`;
}

// ── String counting ─────────────────────────────────────────────────────

/** 计算文本行数（空串返回 0）。 */
export function countLines(text: string): number {
    return text.length === 0 ? 0 : text.split('\n').length;
}

/** 计算 `target` 在 `source` 中的出现次数（非重叠）。 */
export function countOccurrences(source: string, target: string): number {
    if (target.length === 0) return 0;

    let count = 0;
    let index = source.indexOf(target);
    while (index !== -1) {
        count += 1;
        index = source.indexOf(target, index + target.length);
    }
    return count;
}

// ── Error introspection ─────────────────────────────────────────────────

/** 判断是否为 NodeJS.ErrnoException。 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof ((error as {code?: unknown}).code) === 'string'
    );
}

/** 读取错误码；非 Node 错误返回 undefined。 */
export function getErrorCode(error: unknown): string | undefined {
    return isNodeError(error) ? error.code : undefined;
}

/** 将任意错误转换为字符串消息。 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

// ── Quote normalization (aligned with Claude Code FileEditTool/utils.ts) ──

const LEFT_SINGLE_CURLY = '\u2018';  // '
const RIGHT_SINGLE_CURLY = '\u2019'; // '
const LEFT_DOUBLE_CURLY = '\u201C';  // "
const RIGHT_DOUBLE_CURLY = '\u201D'; // "

/** 将弯引号标准化为直引号。 */
export function normalizeQuotes(str: string): string {
    return str
        .replaceAll(LEFT_SINGLE_CURLY, "'")
        .replaceAll(RIGHT_SINGLE_CURLY, "'")
        .replaceAll(LEFT_DOUBLE_CURLY, '"')
        .replaceAll(RIGHT_DOUBLE_CURLY, '"');
}

/**
 * 在文件内容中查找 searchString 的实际匹配。
 * 先尝试精确匹配，再尝试引号标准化后匹配。
 *
 * 对齐 Claude Code FileEditTool — 处理 LLM 无法输出弯引号的情况。
 */
export function findActualString(fileContent: string, searchString: string): string | null {
    // 精确匹配
    if (fileContent.includes(searchString)) {
        return searchString;
    }

    // 引号标准化后匹配
    const normalizedSearch = normalizeQuotes(searchString);
    const normalizedFile = normalizeQuotes(fileContent);

    const searchIndex = normalizedFile.indexOf(normalizedSearch);
    if (searchIndex !== -1) {
        return fileContent.substring(searchIndex, searchIndex + searchString.length);
    }

    return null;
}

// ── Path validation ─────────────────────────────────────────────────────

/**
 * 校验路径格式。
 * 仅做格式校验，不负责权限控制。
 */
export function validatePath(filePath: string): string | null {
    const MAX_PATH_LENGTH = 4096;

    if (filePath.length > MAX_PATH_LENGTH) {
        return formatError('Path too long', `exceeds ${MAX_PATH_LENGTH} characters`);
    }

    if (!path.isAbsolute(filePath)) {
        return formatError('Invalid path', 'file_path must be absolute', filePath);
    }

    const normalized = path.normalize(filePath);
    // Detect traversal: if normalize changed the path beyond just stripping trailing slashes,
    // or if the raw input contains '..' path segments
    if (filePath.includes('..') || (normalized !== filePath && normalized !== filePath.replace(/\/+$/, ''))) {
        return formatError('Path traversal detected', 'path contains traversal sequences', filePath);
    }

    if (filePath.includes('\0')) {
        return formatError('Invalid path', 'path contains null bytes', filePath);
    }

    return null;
}
