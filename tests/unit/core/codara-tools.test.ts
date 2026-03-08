import {describe, expect, it} from 'bun:test';
import type {StructuredToolInterface} from '@langchain/core/tools';
import {createCodaraTools} from '@core';

describe('Codara tools', () => {
  it('should include builtin tools by default', () => {
    const tools = createCodaraTools();

    expect(tools.map((tool) => tool.name)).toEqual([
      'bash',
      'read_file',
      'write_file',
      'edit_file',
      'glob',
      'grep',
      'fetch_url',
      'web_search',
    ]);
  });

  it('should let caller tools override builtin tools with the same name', () => {
    const overrideRead = {
      name: 'read',
      description: 'Custom read',
      schema: {} as never,
      invoke: async () => 'override',
    } as unknown as StructuredToolInterface;

    const tools = createCodaraTools({
      tools: [overrideRead],
    });

    expect(tools.some((tool) => tool === overrideRead)).toBe(true);
    expect(tools.filter((tool) => tool.name === 'read')).toHaveLength(1);
  });
});
