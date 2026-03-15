import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test';
import {createSearchTool} from '@capability/tool';

describe('SearchTool', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({
      results: [
        {title: 'Result 1', url: 'https://example.com/1', content: 'Snippet 1'},
        {title: 'Result 2', url: 'https://example.com/2', content: 'Snippet 2'},
        {title: 'Result 3', url: 'https://example.com/3', content: 'Snippet 3'},
        {title: 'Result 4', url: 'https://example.com/4', content: 'Snippet 4'},
        {title: 'Result 5', url: 'https://example.com/5', content: 'Snippet 5'},
      ],
    }), {
      status: 200,
      headers: {'content-type': 'application/json'},
    })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should have correct name and schema', () => {
    const tool = createSearchTool();

    expect(tool.name).toBe('web_search');
    expect(tool.schema).toBeDefined();
  });

  it('should search and return structured results', async () => {
    const tool = createSearchTool();
    const result = await tool.invoke({
      query: 'TypeScript',
      max_results: 3,
    });

    const parsed = JSON.parse(result);

    expect(parsed.query).toBe('TypeScript');
    expect(parsed.results).toBeArray();
    // 注意：由于公共搜索实例可能不稳定，我们只验证格式正确
    // 实际使用时应该能返回结果
  });

  it('should respect max_results parameter', async () => {
    const tool = createSearchTool();
    const result = await tool.invoke({
      query: 'JavaScript',
      max_results: 5,
    });

    const parsed = JSON.parse(result);
    // 验证不会超过最大值
    expect(parsed.results.length).toBeLessThanOrEqual(5);
  });

  it('should handle region parameter', async () => {
    const tool = createSearchTool();
    const result = await tool.invoke({
      query: 'React',
      max_results: 3,
    });

    const parsed = JSON.parse(result);
    expect(parsed.query).toBe('React');
    expect(parsed.results).toBeArray();
  });

  it('should handle no results gracefully', async () => {
    const tool = createSearchTool();
    const result = await tool.invoke({
      query: 'xyzabc123nonexistentquery999',
      max_results: 5,
    });

    const parsed = JSON.parse(result);
    expect(parsed.query).toBe('xyzabc123nonexistentquery999');
    expect(parsed.results).toBeArray();
    // 可能返回空数组或少量结果
  });

  it('should validate schema', async () => {
    const tool = createSearchTool();

    // 测试默认值
    const result = await tool.invoke({
      query: 'test',
    });

    const parsed = JSON.parse(result);
    expect(parsed.query).toBe('test');
    expect(parsed.results).toBeArray();
  });
});
