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

/** 校验 URL 格式与协议。 */
function validateUrl(rawUrl: string): {url?: URL; error?: string} {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {error: formatError('Invalid URL', rawUrl)};
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {error: formatError('Unsupported protocol', parsed.protocol, 'only HTTP/HTTPS supported')};
  }

  return {url: parsed};
}

/** HTTP 请求工具。 */
export class FetchTool extends StructuredTool<typeof fetchInputSchema> {
  name = 'fetch_url';
  description = `Fetches URL content over HTTP/HTTPS.
Use when: need to retrieve web content, API responses, or remote resources.
Don't use when: need to download large binary files (use specialized download tools).
Returns: JSON with response metadata (status, headers) and body content.`;
  schema = fetchInputSchema;

  async _call(input: FetchInput): Promise<string> {
    const validation = validateUrl(input.url);
    if (!validation.url) {
      return validation.error || formatError('Invalid URL', input.url);
    }

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

      const text = await response.text();
      if (text.length > input.max_response_size) {
        return formatError(
          'Response too large',
          `${text.length} bytes`,
          `exceeds limit of ${input.max_response_size} bytes`
        );
      }

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

/** 创建 FetchTool。 */
export function createFetchTool(): FetchTool {
  return new FetchTool();
}
