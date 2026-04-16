import {describe, expect, it} from 'bun:test';
import type {ToolCall} from '@langchain/core/messages';
import {partitionToolCalls} from '@core/agent/run/tool-concurrency';
import type {ToolMetadata} from '@shared/tool-metadata';

function makeToolCall(name: string): ToolCall {
  return {name, args: {}, id: name, type: 'tool_call'};
}

describe('partitionToolCalls', () => {
  it('partitions read-only tools to readOnly batch', () => {
    const registry = new Map<string, Pick<ToolMetadata, 'isReadOnly'>>([
      ['read_file', {isReadOnly: true}],
      ['search', {isReadOnly: true}],
    ]);
    const calls = [makeToolCall('read_file'), makeToolCall('search')];

    const result = partitionToolCalls(calls, registry);

    expect(result.readOnly).toHaveLength(2);
    expect(result.serial).toHaveLength(0);
  });

  it('partitions writable tools to serial batch', () => {
    const registry = new Map<string, Pick<ToolMetadata, 'isReadOnly'>>([
      ['write_file', {isReadOnly: false}],
      ['execute', {isReadOnly: false}],
    ]);
    const calls = [makeToolCall('write_file'), makeToolCall('execute')];

    const result = partitionToolCalls(calls, registry);

    expect(result.readOnly).toHaveLength(0);
    expect(result.serial).toHaveLength(2);
  });

  it('sends unknown tools (not in registry) to serial as safe default', () => {
    const registry = new Map<string, Pick<ToolMetadata, 'isReadOnly'>>();
    const calls = [makeToolCall('unknown_tool')];

    const result = partitionToolCalls(calls, registry);

    expect(result.readOnly).toHaveLength(0);
    expect(result.serial).toHaveLength(1);
    expect(result.serial[0].name).toBe('unknown_tool');
  });

  it('handles mixed: 3 read + 2 write correctly', () => {
    const registry = new Map<string, Pick<ToolMetadata, 'isReadOnly'>>([
      ['read_file', {isReadOnly: true}],
      ['search', {isReadOnly: true}],
      ['grep', {isReadOnly: true}],
      ['write_file', {isReadOnly: false}],
      ['execute', {isReadOnly: false}],
    ]);
    const calls = [
      makeToolCall('read_file'),
      makeToolCall('write_file'),
      makeToolCall('search'),
      makeToolCall('execute'),
      makeToolCall('grep'),
    ];

    const result = partitionToolCalls(calls, registry);

    expect(result.readOnly).toHaveLength(3);
    expect(result.serial).toHaveLength(2);
    expect(result.readOnly.map(c => c.name)).toEqual(['read_file', 'search', 'grep']);
    expect(result.serial.map(c => c.name)).toEqual(['write_file', 'execute']);
  });

  it('returns both empty for empty toolCalls', () => {
    const registry = new Map<string, Pick<ToolMetadata, 'isReadOnly'>>();

    const result = partitionToolCalls([], registry);

    expect(result.readOnly).toHaveLength(0);
    expect(result.serial).toHaveLength(0);
  });

  it('sends agent tool to serial', () => {
    const registry = new Map<string, Pick<ToolMetadata, 'isReadOnly'>>([
      ['agent', {isReadOnly: false}],
    ]);
    const calls = [makeToolCall('agent')];

    const result = partitionToolCalls(calls, registry);

    expect(result.readOnly).toHaveLength(0);
    expect(result.serial).toHaveLength(1);
    expect(result.serial[0].name).toBe('agent');
  });
});
