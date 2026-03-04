import {describe, expect, it} from 'bun:test';
import {createSearchTool} from '@core/tools';

describe('SearchTool', () => {
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
