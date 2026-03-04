import path from 'node:path';

/**
 * 格式化错误消息为统一格式。
 *
 * 所有工具应使用此函数返回错误，以保持一致性。
 *
 * @param type - 错误类型（如 "File not found", "Permission denied"）
 * @param details - 错误详情（如文件路径、错误原因）
 * @param context - 可选的上下文信息（如建议的解决方案）
 * @returns 格式化的错误消息
 *
 * @example
 * ```typescript
 * formatError('File not found', '/path/to/file.txt')
 * // => "Error: File not found: /path/to/file.txt"
 *
 * formatError('Permission denied', '/etc/shadow', 'requires root access')
 * // => "Error: Permission denied: /etc/shadow (requires root access)"
 * ```
 */
export function formatError(type: string, details: string, context?: string): string {
    return context
        ? `Error: ${type}: ${details} (${context})`
        : `Error: ${type}: ${details}`;
}

/**
 * 格式化 "无结果" 类型的消息（非错误）。
 *
 * @param message - 消息内容
 * @returns 格式化的消息
 *
 * @example
 * ```typescript
 * formatNoResults('No files matching the pattern')
 * // => "No results: No files matching the pattern"
 * ```
 */
export function formatNoResults(message: string): string {
    return `No results: ${message}`;
}

/**
 * 计算文本的行数。
 *
 * @param text - 待计算的文本
 * @returns 行数（空字符串返回 0）
 *
 * @example
 * ```typescript
 * countLines('') // => 0
 * countLines('hello') // => 1
 * countLines('hello\nworld') // => 2
 * ```
 */
export function countLines(text: string): number {
    return text.length === 0 ? 0 : text.split('\n').length;
}

/**
 * 计算目标字符串在源字符串中出现的次数。
 *
 * @param source - 源字符串
 * @param target - 目标字符串
 * @returns 出现次数
 *
 * @example
 * ```typescript
 * countOccurrences('hello world hello', 'hello') // => 2
 * countOccurrences('abc', '') // => 0
 * ```
 */
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

/**
 * 检查是否为 Node.js 文件系统错误。
 *
 * @param error - 待检查的错误对象
 * @returns 是否为 NodeJS.ErrnoException
 */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
    return (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof ((error as {code?: unknown}).code) === 'string'
    );
}

/**
 * 安全地获取错误代码。
 *
 * @param error - 错误对象
 * @returns 错误代码，如果不是 Node 错误则返回 undefined
 */
export function getErrorCode(error: unknown): string | undefined {
    return isNodeError(error) ? error.code : undefined;
}

/**
 * 安全地获取错误消息。
 *
 * @param error - 错误对象
 * @returns 错误消息字符串
 */
export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

/**
 * 校验文件路径的基本安全性。
 *
 * 仅执行基本的路径验证，不做访问权限控制。
 * 访问权限应该由外层的 Agent 或权限系统管理。
 *
 * @param filePath - 待校验的文件路径
 * @returns 如果路径有效返回 null，否则返回错误消息
 *
 * @example
 * ```typescript
 * validatePath('/absolute/path') // => null
 * validatePath('relative/path') // => "Error: Invalid path: ..."
 * validatePath('/path/../etc/passwd') // => "Error: Path traversal detected: ..."
 * ```
 */
export function validatePath(filePath: string): string | null {
    const MAX_PATH_LENGTH = 4096;

    // 检查路径长度
    if (filePath.length > MAX_PATH_LENGTH) {
        return formatError('Path too long', `exceeds ${MAX_PATH_LENGTH} characters`);
    }

    // 必须是绝对路径
    if (!path.isAbsolute(filePath)) {
        return formatError('Invalid path', 'file_path must be absolute', filePath);
    }

    // 防止路径遍历攻击
    const normalized = path.normalize(filePath);
    if (normalized !== filePath) {
        return formatError('Path traversal detected', 'path contains traversal sequences', filePath);
    }

    // 检查空字节注入（安全漏洞）
    if (filePath.includes('\0')) {
        return formatError('Invalid path', 'path contains null bytes', filePath);
    }

    return null;
}
