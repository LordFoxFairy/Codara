/**
 * FileRead 工具 — 读取文件内容，支持文本、图片、PDF。
 *
 * 对齐 Claude Code FileReadTool：
 * - 扩展的设备文件黑名单（/dev/full, /dev/tty, /dev/console, /proc fd 别名）
 * - 二进制扩展名检测（跳过不可读格式）
 * - 行号格式 "lineNum\tcontent"
 * - 图片 base64 / SVG 原文 / PDF pdftotext
 */

import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {validatePath, formatError, getErrorCode, getErrorMessage} from '@tools/utils';

const execFileAsync = promisify(execFile);

const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;
const MAX_LINE_LENGTH = 2000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.tif']);

const BINARY_EXTENSIONS = new Set([
    '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.a', '.lib',
    '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z', '.rar',
    '.wasm', '.pyc', '.class', '.jar',
    '.db', '.sqlite', '.sqlite3',
    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.flac', '.wav',
]);

/**
 * 阻止读取的设备文件路径。
 * 对齐 Claude Code — 无限输出或阻塞输入的设备。
 * /dev/null 故意不在列表中（安全可读）。
 */
const BLOCKED_DEVICE_PATHS = new Set([
    // 无限输出 — 永不到达 EOF
    '/dev/zero', '/dev/random', '/dev/urandom', '/dev/full',
    // 阻塞等待输入
    '/dev/stdin', '/dev/tty', '/dev/console',
    // 读取无意义
    '/dev/stdout', '/dev/stderr',
    // stdio 的 fd 别名
    '/dev/fd/0', '/dev/fd/1', '/dev/fd/2',
]);

/** 检查是否为阻塞型设备路径（含 /proc fd 别名）。 */
function isBlockedDevicePath(filePath: string): boolean {
    if (BLOCKED_DEVICE_PATHS.has(filePath)) return true;
    // /proc/self/fd/0-2 and /proc/<pid>/fd/0-2 are Linux aliases for stdio
    if (filePath.startsWith('/proc/') &&
        (filePath.endsWith('/fd/0') || filePath.endsWith('/fd/1') || filePath.endsWith('/fd/2'))) {
        return true;
    }
    return false;
}

function isImageFile(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext) || ext === '.svg';
}

function isPdfFile(filePath: string): boolean {
    return path.extname(filePath).toLowerCase() === '.pdf';
}

function getImageMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.ico': 'image/x-icon', '.tiff': 'image/tiff', '.tif': 'image/tiff',
        '.svg': 'image/svg+xml',
    };
    return mimeMap[ext] ?? 'application/octet-stream';
}

const readInputSchema = z.object({
    file_path: z.string().min(1)
        .describe('Absolute path to the file. Must exist and be readable.'),
    offset: z.number().int().min(0).default(0)
        .describe('Starting line number (0-based). Default: 0'),
    limit: z.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT)
        .describe('Maximum lines to read. Default: 2000, Max: 5000'),
    pages: z.string().optional()
        .describe('Page range for PDF files (e.g., "1-5", "3"). Only for .pdf files. Max 20 pages per request.'),
});

type ReadInput = z.infer<typeof readInputSchema>;

function isBinary(buffer: Buffer): boolean {
    const probe = buffer.subarray(0, 512);
    return probe.includes(0);
}

/** 文件读取工具。 */
export class ReadTool extends StructuredTool<typeof readInputSchema> {
    name = 'read_file';
    description = `Reads file content with line numbers in format "lineNum\\tcontent".
Supports images (PNG, JPG, GIF, WEBP, SVG, BMP, ICO, TIFF) as base64, and PDF files with optional page range.
Use when: examining source code, checking file contents, viewing images, reading PDFs.
Don't use when: path is directory, need to write/modify file, reading .ipynb notebooks (use notebook_read).
Returns: formatted text with line numbers, base64 data URL for images, or extracted text for PDFs.`;
    schema = readInputSchema;

    async _call(input: ReadInput): Promise<string> {
        const filePath = input.file_path;
        const pathError = validatePath(filePath);
        if (pathError) {
            return pathError;
        }

        if (isBlockedDevicePath(filePath)) {
            return formatError('Blocked path', `${filePath} is a device file that would block or produce infinite output`);
        }

        const ext = path.extname(filePath).toLowerCase();
        if (BINARY_EXTENSIONS.has(ext)) {
            return formatError('Binary file', `${filePath} has binary extension "${ext}"`, 'use a specialized tool for this file type');
        }

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

        // Images have a higher size limit (20MB); PDFs are handled by external tool
        const effectiveMaxSize = isImageFile(filePath) ? MAX_IMAGE_SIZE : MAX_FILE_SIZE;
        if (!isPdfFile(filePath) && fileSize > effectiveMaxSize) {
            return formatError(
                'File too large',
                `${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds ${effectiveMaxSize / 1024 / 1024}MB limit`,
                isImageFile(filePath) ? undefined : 'use offset/limit to read in chunks'
            );
        }

        // PDF files are handled by external pdftotext — no need to read into buffer
        if (isPdfFile(filePath)) {
            return this.readPdf(filePath, input.pages);
        }

        let buffer: Buffer;
        try {
            buffer = await readFile(filePath);
        } catch (error: unknown) {
            return formatError('Read failed', getErrorMessage(error));
        }

        // Image files — return base64 data URL or SVG content
        if (isImageFile(filePath)) {
            return this.readImage(filePath, buffer, fileSize);
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
                return `${String(lineNumber).padStart(6, ' ')}\t${visible}`;
            })
            .join('\n');
    }

    private readImage(filePath: string, buffer: Buffer, fileSize: number): string {
        const ext = path.extname(filePath).toLowerCase();

        // SVG is text-based — return content directly
        if (ext === '.svg') {
            return `[SVG Image: ${path.basename(filePath)} (${fileSize} bytes)]\n${buffer.toString('utf8')}`;
        }

        if (fileSize > MAX_IMAGE_SIZE) {
            return formatError('Image too large', `${(fileSize / 1024 / 1024).toFixed(2)}MB exceeds 20MB limit`);
        }

        const mime = getImageMimeType(ext);
        const base64 = buffer.toString('base64');
        const sizeKB = (fileSize / 1024).toFixed(1);
        return `[Image: ${path.basename(filePath)} (${sizeKB} KB)]\ndata:${mime};base64,${base64}`;
    }

    private async readPdf(filePath: string, pages?: string): Promise<string> {
        // Parse page range
        let firstPage: number | undefined;
        let lastPage: number | undefined;
        if (pages) {
            const match = pages.match(/^(\d+)(?:-(\d+))?$/);
            if (!match) {
                return formatError('Invalid page range', `"${pages}" — expected format: "3" or "1-5"`);
            }
            firstPage = parseInt(match[1], 10);
            lastPage = match[2] ? parseInt(match[2], 10) : firstPage;
            if (lastPage < firstPage) {
                return formatError('Invalid page range', `end page (${lastPage}) is before start page (${firstPage})`);
            }
            if (lastPage - firstPage + 1 > 20) {
                return formatError('Too many pages', `Requested ${lastPage - firstPage + 1} pages, max 20 per request`);
            }
        }

        const args = ['-layout'];
        if (firstPage !== undefined) args.push('-f', String(firstPage));
        if (lastPage !== undefined) args.push('-l', String(lastPage));
        args.push(filePath, '-');

        try {
            const {stdout} = await execFileAsync('pdftotext', args, {maxBuffer: 10 * 1024 * 1024});
            if (!stdout.trim()) {
                return `[PDF: ${path.basename(filePath)}] (no extractable text — may be scanned/image-based)`;
            }
            const lines = stdout.split('\n');
            return `[PDF: ${path.basename(filePath)}${pages ? ` pages ${pages}` : ''}] (${lines.length} lines)\n${stdout}`;
        } catch (error: unknown) {
            const msg = getErrorMessage(error);
            if (msg.includes('not found') || msg.includes('ENOENT')) {
                return formatError(
                    'PDF reader not available',
                    'pdftotext is required to read PDF files. Install with: brew install poppler (macOS) or apt install poppler-utils (Linux)',
                );
            }
            return formatError('PDF read failed', msg);
        }
    }
}

/** 创建 ReadTool。 */
export function createReadTool(): ReadTool {
    return new ReadTool();
}
