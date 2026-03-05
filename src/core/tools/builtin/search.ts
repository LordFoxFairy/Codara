import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {formatError, getErrorMessage} from '@core/tools/utils';

const DEFAULT_MAX_RESULTS = 10;
const MAX_MAX_RESULTS = 20;
const DEFAULT_TIMEOUT_MS = 15_000;

// SearXNG 公共实例，按优先顺序尝试。
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

/** 搜索结果项。 */
interface SearchResult {
  /** 结果标题 */
  title: string;
  /** 结果 URL */
  url: string;
  /** 结果摘要 */
  snippet: string;
}

/** 使用 SearXNG 执行搜索。 */
async function searchWithSearXNG(
  query: string,
  maxResults: number
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
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
          continue;
        }

        const data = await response.json() as {results?: Array<{title?: string; url?: string; content?: string}>};

        if (!data.results || data.results.length === 0) {
          continue;
        }

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
        continue;
      }
    }

    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** 网络搜索工具。 */
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

/** 创建 SearchTool。 */
export function createSearchTool(): SearchTool {
  return new SearchTool();
}
