import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, getErrorMessage} from '@core/tools/utils';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RESPONSE_SIZE = 1_048_576; // 1MB
const MAX_MAX_RESPONSE_SIZE = 10_485_760; // 10MB

const fetchInputSchema = z.object({
  url: z.string().min(1).describe('HTTP/HTTPS URL to fetch. Must be a valid absolute URL.'),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']).default('GET')
    .describe('HTTP method to use. Default: GET'),
  headers: z.record(z.string(), z.string()).optional()
    .describe('Optional HTTP headers as key-value pairs'),
  body: z.string().optional()
    .describe('Optional request body (for POST/PUT/PATCH)'),
  timeout_ms: z.number().int().positive().max(MAX_TIMEOUT_MS).default(DEFAULT_TIMEOUT_MS)
    .describe('Request timeout in milliseconds. Default: 15000 (15s), Max: 120000 (2min)'),
  max_response_size: z.number().int().positive().max(MAX_MAX_RESPONSE_SIZE).default(DEFAULT_MAX_RESPONSE_SIZE)
    .describe('Maximum response size in bytes. Default: 1048576 (1MB), Max: 10485760 (10MB)'),
});

type FetchInput = z.infer<typeof fetchInputSchema>;

/**
 * 验证 URL 格式。
 *
 * 仅执行基本的 URL 格式验证，不做安全策略检查。
 * 安全策略应该由外层的 Agent 或权限系统管理。
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

  // 仅检查协议支持（技术限制，不是安全策略）
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {error: formatError('Unsupported protocol', parsed.protocol, 'only HTTP/HTTPS supported')};
  }

  return {url: parsed};
}

/**
 * 通用的 HTTP 请求工具。
 *
 * 不包含任何安全策略或内容处理逻辑。
 * 安全控制应该由 Agent 或权限系统管理。
 *
 * @example
 * ```TypeScript
 * const tool = createFetchTool();
 *
 * // 获取网页内容
 * const result = await tool.invoke({
 *     url: 'https://example.com'
 * });
 *
 * // 带自定义 headers 和超时
 * const custom = await tool.invoke({
 *     url: 'https://api.example.com/data',
 *     method: 'POST',
 *     headers: {'Content-Type': 'application/json'},
 *     body: JSON.stringify({key: 'value'}),
 *     timeout_ms: 10000,
 *     max_response_size: 5242880
 * });
 * ```
 */
export class FetchTool extends StructuredTool<typeof fetchInputSchema> {
  name = 'fetch_url';
  description = `Fetches URL content over HTTP/HTTPS.
Use when: need to retrieve web content, API responses, or remote resources.
Don't use when: need to download large binary files (use specialized download tools).
Returns: JSON with response metadata (status, headers) and body content.`;
  schema = fetchInputSchema;

  async _call(input: FetchInput): Promise<string> {
    // 1. 基本的 URL 格式验证（不包含安全策略）
    const validation = validateUrl(input.url);
    if (!validation.url) {
      return validation.error || formatError('Invalid URL', input.url);
    }

    // 2. 执行请求
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeout_ms);

    try {
      const response = await fetch(validation.url.toString(), {
        method: input.method,
        headers: input.headers as HeadersInit,
        body: input.body,
        redirect: 'follow',
        signal: controller.signal,
      });

      // 3. 检查响应大小（基于 Content-Length header）
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const size = Number.parseInt(contentLength, 10);
        if (!Number.isNaN(size) && size > input.max_response_size) {
          return formatError(
            'Response too large',
            `${size} bytes`,
            `exceeds limit of ${input.max_response_size} bytes`
          );
        }
      }

      // 4. 读取响应（带大小限制）
      const text = await response.text();
      if (text.length > input.max_response_size) {
        return formatError(
          'Response too large',
          `${text.length} bytes`,
          `exceeds limit of ${input.max_response_size} bytes`
        );
      }

      // 5. 返回结构化的 JSON 响应（不做内容处理）
      return JSON.stringify({
        url: validation.url.toString(),
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: text,
      }, null, 2);

    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return formatError('Request timeout', `${input.timeout_ms}ms`, validation.url.toString());
      }
      return formatError('Request failed', getErrorMessage(error), validation.url.toString());
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

