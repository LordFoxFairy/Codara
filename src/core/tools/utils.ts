import path from 'node:path';

/** 构造统一错误消息。 */
export function formatError(type: string, details: string, context?: string): string {
    return context
        ? `Error: ${type}: ${details} (${context})`
        : `Error: ${type}: ${details}`;
}

/** 构造统一的“无结果”消息。 */
export function formatNoResults(message: string): string {
    return `No results: ${message}`;
}

/** 计算文本行数（空串返回 0）。 */
export function countLines(text: string): number {
    return text.length === 0 ? 0 : text.split('\n').length;
}

/** 计算 `target` 在 `source` 中的出现次数。 */
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
    if (normalized !== filePath) {
        return formatError('Path traversal detected', 'path contains traversal sequences', filePath);
    }

    if (filePath.includes('\0')) {
        return formatError('Invalid path', 'path contains null bytes', filePath);
    }

    return null;
}
