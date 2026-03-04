import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, getErrorMessage} from '@core/tools/utils';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_CHARS = 120_000;
const MAX_MAX_CHARS = 500_000;

const fetchInputSchema = z.object({
  url: z.string().min(1).describe('HTTP/HTTPS URL to fetch. Must be a valid absolute URL.'),
  prompt: z.string().optional().describe('Optional focus instruction for the fetched content'),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS)
    .describe('Request timeout in milliseconds. Default: 15000 (15s), Max: 120000 (2min)'),
  max_chars: z.number().int().positive().max(MAX_MAX_CHARS).default(DEFAULT_MAX_CHARS)
    .describe('Max response content characters to return. Default: 120000, Max: 500000'),
});

type FetchInput = z.infer<typeof fetchInputSchema>;

/**
 * HTML 实体解码。
 *
 * @param raw - 原始 HTML 文本
 * @returns 解码后的文本
 */
function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
}

/**
 * 规范化文本格式。
 *
 * @param raw - 原始文本
 * @returns 规范化后的文本
 */
function normalizeText(raw: string): string {
  return raw
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从 HTML 中提取标题。
 *
 * @param html - HTML 文本
 * @returns 标题文本，如果未找到则返回 undefined
 */
function extractHtmlTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match?.[1]) {
    return undefined;
  }

  const title = normalizeText(decodeHtmlEntities(match[1]));
  return title || undefined;
}

/**
 * 将 HTML 转换为纯文本。
 *
 * @param html - HTML 文本
 * @returns 纯文本
 */
function htmlToText(html: string): string {
  const withoutScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');

  const withLines = withoutScript
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|main|aside|li|ul|ol|h[1-6]|tr|td|th)>/gi, '\n')
    .replace(/<(p|div|section|article|header|footer|main|aside|li|ul|ol|h[1-6]|tr|td|th)[^>]*>/gi, '\n');

  const withoutTags = withLines.replace(/<[^>]+>/g, ' ');
  return normalizeText(decodeHtmlEntities(withoutTags));
}

/**
 * 检查是否为私有 IPv4 地址。
 *
 * @param host - 主机名或 IP 地址
 * @returns 是否为私有地址
 */
function isPrivateIpv4(host: string): boolean {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return false;
  }

  const parts = host.split('.').map(Number);
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) {
    return true;
  }
  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }
  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  return false;
}

/**
 * 检查是否为私有/本地主机。
 *
 * @param host - 主机名或 IP 地址
 * @returns 是否为私有主机
 */
function isPrivateHost(host: string): boolean {
  const normalized = host.toLowerCase();

  if (
    normalized === 'localhost'
    || normalized === '::1'
    || normalized === '[::1]'
    || normalized.endsWith('.local')
  ) {
    return true;
  }

  if (/^(fc|fd|fe80)/i.test(normalized)) {
    return true;
  }

  return isPrivateIpv4(normalized);
}

/**
 * 验证 URL 的安全性。
 *
 * @param rawUrl - 原始 URL 字符串
 * @returns 验证结果，包含解析后的 URL 或错误消息
 */
function validateUrl(rawUrl: string): {url?: URL; error?: string} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {error: formatError('Invalid URL', rawUrl)};
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {error: formatError('Invalid URL protocol', 'Only HTTP/HTTPS are allowed', rawUrl)};
  }

  if (isPrivateHost(parsed.hostname)) {
    return {error: formatError('Host not allowed', parsed.hostname, 'private/local address blocked')};
  }

  return {url: parsed};
}

/**
 * 格式化 fetch 结果。
 *
 * @param args - 结果参数
 * @returns 格式化的结果字符串
 */
function formatFetchResult(args: {
  url: URL;
  status: number;
  statusText: string;
  contentType: string;
  title?: string;
  prompt?: string;
  content: string;
  truncated: boolean;
  removedChars: number;
}): string {
  const lines: string[] = [
    `URL: ${args.url.toString()}`,
    `Status: ${args.status} ${args.statusText}`,
    `Content-Type: ${args.contentType || 'unknown'}`,
  ];

  if (args.title) {
    lines.push(`Title: ${args.title}`);
  }

  if (args.prompt) {
    lines.push(`Prompt: ${args.prompt}`);
  }

  lines.push('');
  lines.push(args.content || '(empty response body)');

  if (args.truncated) {
    lines.push('');
    lines.push(`[truncated ${args.removedChars} characters]`);
  }

  return lines.join('\n');
}

/**
 * 通过 HTTP/HTTPS 获取 URL 内容。
 *
 * 自动处理 HTML 转文本、JSON 格式化、内容截断等。
 * 阻止访问私有/本地网络地址以确保安全。
 *
 * @example
 * ```typescript
 * const tool = createFetchTool();
 *
 * // 获取网页内容
 * const result = await tool.invoke({
 *     url: 'https://example.com'
 * });
 *
 * // 带超时和字符限制
 * const limited = await tool.invoke({
 *     url: 'https://example.com',
 *     timeout_ms: 10000,
 *     max_chars: 50000
 * });
 * ```
 */
export class FetchTool extends StructuredTool<typeof fetchInputSchema> {
  name = 'fetch_url';
  description = `Fetches URL content over HTTP/HTTPS with safety checks and text extraction.
Use when: reading documentation pages, blog posts, API references, public web content.
Don't use when: accessing local/private network addresses, fetching binary files for download.
Returns: normalized text with URL metadata, optional title, and truncation marker.`;
  schema = fetchInputSchema;

  async _call(input: FetchInput): Promise<string> {
    const validation = validateUrl(input.url);
    if (!validation.url) {
      return validation.error || formatError('Invalid URL', input.url);
    }

    const timeoutMs = input.timeout_ms;
    const maxChars = input.max_chars;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(validation.url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Codara-FetchTool/1.0',
          Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        return formatError('Fetch failed', `HTTP ${response.status} ${response.statusText}`, validation.url.toString());
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() || '';
      const raw = await response.text();
      let title: string | undefined;
      let content = raw;

      if (contentType.includes('text/html')) {
        title = extractHtmlTitle(raw);
        content = htmlToText(raw);
      } else if (contentType.includes('application/json')) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          content = JSON.stringify(parsed, null, 2);
        } catch {
          content = raw;
        }
      } else {
        content = normalizeText(raw);
      }

      let truncated = false;
      let removedChars = 0;
      if (content.length > maxChars) {
        truncated = true;
        removedChars = content.length - maxChars;
        content = content.slice(0, maxChars);
      }

      return formatFetchResult({
        url: validation.url,
        status: response.status,
        statusText: response.statusText,
        contentType,
        title,
        prompt: input.prompt,
        content,
        truncated,
        removedChars,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return formatError('Fetch timeout', `${timeoutMs}ms`, validation.url.toString());
      }
      return formatError('Fetch failed', getErrorMessage(error), validation.url.toString());
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * 创建 FetchTool 实例。
 *
 * @returns 新的 FetchTool 实例
 */
export function createFetchTool(): FetchTool {
  return new FetchTool();
}
