/**
 * Web search tool prompt — system-level instructions for web search.
 *
 * Aligned with Claude Code WebSearchTool prompt pattern:
 * - Search engine documentation
 * - When to use vs fetch
 */

export const SEARCH_TOOL_NAME = 'web_search';

export function getSearchToolPrompt(): string {
  return [
    'Searches the web using a metasearch engine and returns structured results.',
    '',
    'Usage:',
    '- Use when you need to find information, documentation, or resources on the internet',
    '- Returns title, URL, and snippet for each result',
    '- Use fetch_url to retrieve specific page content after finding relevant URLs',
    '- Maximum 20 results per query',
  ].join('\n');
}
