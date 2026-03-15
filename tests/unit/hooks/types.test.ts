import {describe, expect, test} from 'bun:test';
import {
  hookDefinitionSchema,
  hooksConfigSchema,
  hookSourcePriority,
  emptyInterceptResult,
  emptyNotifyResult,
} from '@engine/hook/types';

describe('hookDefinitionSchema', () => {
  test('validates command hook', () => {
    const result = hookDefinitionSchema.safeParse({
      type: 'command',
      command: 'echo hello',
    });
    expect(result.success).toBe(true);
  });

  test('validates prompt hook', () => {
    const result = hookDefinitionSchema.safeParse({
      type: 'prompt',
      prompt: 'Evaluate completeness',
    });
    expect(result.success).toBe(true);
  });

  test('rejects command hook without command field', () => {
    const result = hookDefinitionSchema.safeParse({type: 'command'});
    expect(result.success).toBe(false);
  });

  test('rejects prompt hook without prompt field', () => {
    const result = hookDefinitionSchema.safeParse({type: 'prompt'});
    expect(result.success).toBe(false);
  });

  test('applies default timeout', () => {
    const result = hookDefinitionSchema.parse({type: 'command', command: 'echo'});
    expect(result.timeout).toBe(10000);
  });

  test('accepts custom timeout', () => {
    const result = hookDefinitionSchema.parse({type: 'command', command: 'echo', timeout: 5000});
    expect(result.timeout).toBe(5000);
  });

  test('accepts matcher', () => {
    const result = hookDefinitionSchema.parse({
      type: 'command',
      command: 'echo',
      matcher: {toolName: 'Bash', commandPattern: 'rm.*'},
    });
    expect(result.matcher?.toolName).toBe('Bash');
  });
});

describe('hooksConfigSchema', () => {
  test('validates full config', () => {
    const result = hooksConfigSchema.safeParse({
      description: 'Test hooks',
      hooks: {
        PreToolUse: [{hooks: [{type: 'command', command: 'echo'}]}],
      },
    });
    expect(result.success).toBe(true);
  });

  test('validates empty config', () => {
    const result = hooksConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('rejects invalid event type', () => {
    const result = hooksConfigSchema.safeParse({
      hooks: {InvalidEvent: [{hooks: []}]},
    });
    expect(result.success).toBe(false);
  });
});

describe('hookSourcePriority', () => {
  test('user > project > plugin > skill', () => {
    expect(hookSourcePriority({kind: 'user', path: ''})).toBe(300);
    expect(hookSourcePriority({kind: 'project', path: ''})).toBe(200);
    expect(hookSourcePriority({kind: 'plugin', pluginName: 'x', path: ''})).toBe(100);
    expect(hookSourcePriority({kind: 'skill', skillName: 'x', path: ''})).toBe(50);
  });
});

describe('result factories', () => {
  test('emptyInterceptResult', () => {
    const r = emptyInterceptResult();
    expect(r.vetoed).toBe(false);
    expect(r.systemMessages).toEqual([]);
  });

  test('emptyNotifyResult', () => {
    const r = emptyNotifyResult();
    expect(r.systemMessages).toEqual([]);
  });
});
