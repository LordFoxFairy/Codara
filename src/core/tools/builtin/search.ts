import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, getErrorMessage} from '@core/tools/utils';

const DEFAULT_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 20;
const DEFAULT_TIMEOUT_MS = 15_000;

// SearXNG 公共实例列表（按可靠性排序）
const SEARXNG_INSTANCES = [
  'https://searx.be',
  'https://search.sapti.me',
  'https://searx.work',
  'https://searx.tiekoetter.com',
];

const searchInputSchema = z.object({
  query: z.string().min(1).describe('Search query keywords'),
  max_results: z.number().int().positive().max(MAX_MAX_RESULTS).default(DEFAULT_MAX_RESULTS)
    .describe('Maximum number of search results to return. Default: 10, Max: 20'),
});

type SearchInput = z.infer<typeof searchInputSchema>;

/**
 * 搜索结果项。
 */
interface SearchResult {
  /** 结果标题 */
  title: string;
  /** 结果 URL */
  url: string;
  /** 结果摘要 */
  snippet: string;
}

/**
 * 使用 SearXNG 执行搜索。
 *
 * @param query - 搜索关键词
 * @param maxResults - 最大结果数
 * @returns 搜索结果
 */
async function searchWithSearXNG(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    // 尝试多个实例，直到成功
    for (const instance of SEARXNG_INSTANCES) {
      try {
        const params = new URLSearchParams({
          q: query,
          format: 'json',
          categories: 'general',
        });

        const url = `${instance}/search?${params.toString()}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'Codara/1.0',
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          continue; // 尝试下一个实例
        }

        const data = await response.json() as {results?: Array<{title?: string; url?: string; content?: string}>};

        if (!data.results || data.results.length === 0) {
          continue; // 尝试下一个实例
        }

        // 转换为我们的格式
        const results: SearchResult[] = data.results
          .slice(0, maxResults)
          .filter((r) => r.title && r.url)
          .map((r) => ({
            title: r.title || '',
            url: r.url || '',
            snippet: r.content || '',
          }));

        if (results.length > 0) {
          return results;
        }
      } catch {
        // 忽略单个实例的错误，继续尝试下一个
        continue;
      }
    }

    // 所有实例都失败了
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 网络搜索工具。
 *
 * 使用 SearXNG 元搜索引擎执行免费的网络搜索，无需 API key。
 * 返回结构化的搜索结果（标题、URL、摘要）。
 *
 * @example
 * ```typescript
 * const tool = createSearchTool();
 *
 * // 搜索信息
 * const result = await tool.invoke({
 *     query: 'React 19 新特性'
 * });
 *
 * // 限制结果数量
 * const limited = await tool.invoke({
 *     query: 'TypeScript 5.0',
 *     max_results: 5
 * });
 * ```
 */
export class SearchTool extends StructuredTool<typeof searchInputSchema> {
  name = 'web_search';
  description = `Searches the web using SearXNG metasearch engine and returns structured results.
Use when: need to find information, documentation, news, or resources on the internet.
Don't use when: need to fetch specific URL content (use fetch_url instead).
Returns: JSON with search results including title, URL, and snippet for each result.`;
  schema = searchInputSchema;

  async _call(input: SearchInput): Promise<string> {
    try {
      const results = await searchWithSearXNG(input.query, input.max_results);

      if (results.length === 0) {
        return JSON.stringify({
          query: input.query,
          results: [],
          message: 'No results found',
        }, null, 2);
      }

      return JSON.stringify({
        query: input.query,
        count: results.length,
        results,
      }, null, 2);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return formatError('Search timeout', `${DEFAULT_TIMEOUT_MS}ms`, input.query);
      }
      return formatError('Search failed', getErrorMessage(error), input.query);
    }
  }
}

/**
 * 创建 SearchTool 实例。
 *
 * @returns 新的 SearchTool 实例
 */
export function createSearchTool(): SearchTool {
  return new SearchTool();
}
