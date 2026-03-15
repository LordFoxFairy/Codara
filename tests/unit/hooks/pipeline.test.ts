import {describe, expect, test} from 'bun:test';
import {HookPipeline} from '@engine/hook/pipeline';
import type {HookRegistry} from '@engine/hook/registry';
import type {HookEntry, HookOutput, HookDefinition, HookContextBase, ToolUseContext} from '@engine/hook/types';
import type {HookExecutionStrategy} from '@engine/hook/executor';

// Mock registry
function createMockRegistry(entries: Record<string, HookEntry[]>): HookRegistry {
  return {
    load: async (_sources: any[]) => {},
    reload: async () => {},
    getHooks: (eventType) => entries[eventType] ?? [],
    getMatchedHooks: (eventType, _filter) => entries[eventType] ?? [],
    get size() { return Object.values(entries).flat().length; },
  };
}

// Mock executor factory
function createMockExecutorFactory(outputs: HookOutput[]) {
  let callIndex = 0;
  return {
    createStrategy(_hook: HookDefinition): HookExecutionStrategy {
      const idx = callIndex++;
      return {
        execute: async () => outputs[idx] ?? {},
      };
    },
  };
}

function makeEntry(command: string, eventType = 'PreToolUse' as const): HookEntry {
  return {
    definition: {type: 'command', command, timeout: 5000},
    eventType,
    source: {kind: 'project', path: '/test'},
    priority: 200,
  };
}

const baseCtx: ToolUseContext = {
  sessionId: 'test', hookEvent: 'PreToolUse', timestamp: '', toolName: 'Bash', toolInput: {command: 'ls'},
};

describe('HookPipeline — Intercept Chain', () => {
  test('returns non-vetoed when no hooks registered', async () => {
    const pipeline = new HookPipeline(createMockRegistry({}), createMockExecutorFactory([]));
    const result = await pipeline.onPreToolUse(baseCtx);
    expect(result.vetoed).toBe(false);
    expect(result.systemMessages).toEqual([]);
  });

  test('passes through when hook returns allow', async () => {
    const registry = createMockRegistry({PreToolUse: [makeEntry('allow-cmd')]});
    const factory = createMockExecutorFactory([{decision: 'allow'}]);
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onPreToolUse(baseCtx);
    expect(result.vetoed).toBe(false);
  });

  test('vetoes when hook returns deny', async () => {
    const registry = createMockRegistry({PreToolUse: [makeEntry('deny-cmd')]});
    const factory = createMockExecutorFactory([{decision: 'deny', systemMessage: 'blocked'}]);
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onPreToolUse(baseCtx);
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('blocked');
  });

  test('chains multiple hooks — first deny stops chain', async () => {
    const registry = createMockRegistry({
      PreToolUse: [makeEntry('a'), makeEntry('b'), makeEntry('c')],
    });
    const factory = createMockExecutorFactory([
      {decision: 'allow', systemMessage: 'msg1'},
      {decision: 'deny', systemMessage: 'stopped'},
      {decision: 'allow', systemMessage: 'should-not-reach'},
    ]);
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onPreToolUse(baseCtx);
    expect(result.vetoed).toBe(true);
    expect(result.systemMessages).toEqual(['msg1', 'stopped']);
  });

  test('accumulates modifiedInput across chain', async () => {
    const registry = createMockRegistry({
      PreToolUse: [makeEntry('a'), makeEntry('b')],
    });
    const factory = createMockExecutorFactory([
      {updatedInput: {a: 1}},
      {updatedInput: {b: 2}},
    ]);
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onPreToolUse(baseCtx);
    expect(result.modifiedInput).toEqual({a: 1, b: 2});
  });

  test('hook execution failure treated as pass', async () => {
    const registry = createMockRegistry({PreToolUse: [makeEntry('fail')]});
    const factory = {
      createStrategy() {
        return {execute: async () => { throw new Error('crash'); }};
      },
    };
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onPreToolUse(baseCtx);
    expect(result.vetoed).toBe(false);
  });
});

describe('HookPipeline — Notify (Observer)', () => {
  test('collects systemMessages from parallel hooks', async () => {
    const registry = createMockRegistry({
      SessionStart: [
        makeEntry('a', 'SessionStart' as any),
        makeEntry('b', 'SessionStart' as any),
      ],
    });
    const factory = createMockExecutorFactory([
      {systemMessage: 'hello'},
      {systemMessage: 'world'},
    ]);
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onSessionStart({
      sessionId: 'test', hookEvent: 'SessionStart', timestamp: '', cwd: '/tmp',
    });
    expect(result.systemMessages).toContain('hello');
    expect(result.systemMessages).toContain('world');
  });

  test('partial failure does not affect other hooks', async () => {
    const registry = createMockRegistry({
      SessionStart: [
        makeEntry('a', 'SessionStart' as any),
        makeEntry('b', 'SessionStart' as any),
      ],
    });
    let callIdx = 0;
    const factory = {
      createStrategy() {
        const idx = callIdx++;
        return {
          execute: async () => {
            if (idx === 0) throw new Error('fail');
            return {systemMessage: 'survived'};
          },
        };
      },
    };
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onSessionStart({
      sessionId: 'test', hookEvent: 'SessionStart', timestamp: '', cwd: '/tmp',
    });
    expect(result.systemMessages).toEqual(['survived']);
  });
});

describe('HookPipeline — Stop hook', () => {
  test('Stop hook deny prevents agent from stopping', async () => {
    const registry = createMockRegistry({
      Stop: [makeEntry('check', 'Stop' as any)],
    });
    const factory = createMockExecutorFactory([
      {decision: 'deny', systemMessage: 'Not done yet'},
    ]);
    const pipeline = new HookPipeline(registry, factory);
    const result = await pipeline.onStop({
      sessionId: 'test', hookEvent: 'Stop', timestamp: '',
      reason: 'complete', reachedMaxTurns: false, turns: 3,
    });
    expect(result.vetoed).toBe(true);
    expect(result.vetoReason).toBe('Not done yet');
  });
});
