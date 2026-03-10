import {describe, expect, it} from 'bun:test';
import {createBuiltinTools, readToolExecutionPolicy} from '@core/tools';

describe('tool execution policy', () => {
  it('should mark read-only builtin tools as parallel-safe', () => {
    const tools = createBuiltinTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(readToolExecutionPolicy(byName.get('read_file'))).toBe('parallel_safe');
    expect(readToolExecutionPolicy(byName.get('glob'))).toBe('parallel_safe');
    expect(readToolExecutionPolicy(byName.get('grep'))).toBe('parallel_safe');
    expect(readToolExecutionPolicy(byName.get('fetch_url'))).toBe('parallel_safe');
    expect(readToolExecutionPolicy(byName.get('web_search'))).toBe('parallel_safe');
  });

  it('should keep stateful builtin tools as serial', () => {
    const tools = createBuiltinTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(readToolExecutionPolicy(byName.get('bash'))).toBe('serial');
    expect(readToolExecutionPolicy(byName.get('write_file'))).toBe('serial');
    expect(readToolExecutionPolicy(byName.get('edit_file'))).toBe('serial');
  });
});
