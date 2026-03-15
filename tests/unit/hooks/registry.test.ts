import {describe, expect, test, beforeEach} from 'bun:test';
import {HookRegistryImpl} from '@engine/hook/registry';
import type {HookSource} from '@engine/hook/types';
import {writeFileSync, mkdirSync, rmSync} from 'fs';
import path from 'path';

const TMP = path.join(import.meta.dir, '__tmp_registry__');

function writeTmpHooks(name: string, content: object): string {
  const dir = path.join(TMP, name);
  mkdirSync(dir, {recursive: true});
  const filePath = path.join(dir, 'hooks.json');
  writeFileSync(filePath, JSON.stringify(content));
  return filePath;
}

beforeEach(() => {
  rmSync(TMP, {recursive: true, force: true});
  mkdirSync(TMP, {recursive: true});
});

describe('HookRegistryImpl', () => {
  test('loads hooks from a single source', async () => {
    const filePath = writeTmpHooks('project', {
      hooks: {
        PreToolUse: [{hooks: [{type: 'command', command: 'echo test'}]}],
      },
    });
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    expect(registry.size).toBe(1);
    expect(registry.getHooks('PreToolUse')).toHaveLength(1);
    expect(registry.getHooks('Stop')).toHaveLength(0);
  });

  test('merges hooks from multiple sources', async () => {
    const p1 = writeTmpHooks('project', {
      hooks: {PreToolUse: [{hooks: [{type: 'command', command: 'echo a'}]}]},
    });
    const p2 = writeTmpHooks('user', {
      hooks: {PreToolUse: [{hooks: [{type: 'command', command: 'echo b'}]}]},
    });
    const registry = new HookRegistryImpl();
    await registry.load([
      {kind: 'project', path: p1},
      {kind: 'user', path: p2},
    ]);
    expect(registry.getHooks('PreToolUse')).toHaveLength(2);
  });

  test('sorts by priority descending (user > project)', async () => {
    const p1 = writeTmpHooks('project', {
      hooks: {PreToolUse: [{hooks: [{type: 'command', command: 'project-cmd'}]}]},
    });
    const p2 = writeTmpHooks('user', {
      hooks: {PreToolUse: [{hooks: [{type: 'command', command: 'user-cmd'}]}]},
    });
    const registry = new HookRegistryImpl();
    await registry.load([
      {kind: 'project', path: p1},
      {kind: 'user', path: p2},
    ]);
    const hooks = registry.getHooks('PreToolUse');
    expect(hooks[0]!.definition.command).toBe('user-cmd');
    expect(hooks[1]!.definition.command).toBe('project-cmd');
  });

  test('preserves declaration order within same priority', async () => {
    const filePath = writeTmpHooks('project', {
      hooks: {
        PreToolUse: [
          {hooks: [{type: 'command', command: 'first'}]},
          {hooks: [{type: 'command', command: 'second'}]},
        ],
      },
    });
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    const hooks = registry.getHooks('PreToolUse');
    expect(hooks[0]!.definition.command).toBe('first');
    expect(hooks[1]!.definition.command).toBe('second');
  });

  test('getMatchedHooks filters by toolName', async () => {
    const filePath = writeTmpHooks('project', {
      hooks: {
        PreToolUse: [{hooks: [
          {type: 'command', command: 'bash-only', matcher: {toolName: 'Bash'}},
          {type: 'command', command: 'all-tools'},
        ]}],
      },
    });
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    const bashHooks = registry.getMatchedHooks('PreToolUse', {toolName: 'Bash'});
    expect(bashHooks).toHaveLength(2); // matcher matches + no matcher matches all
    const readHooks = registry.getMatchedHooks('PreToolUse', {toolName: 'Read'});
    expect(readHooks).toHaveLength(1); // only the no-matcher one
  });

  test('getMatchedHooks filters by commandPattern', async () => {
    const filePath = writeTmpHooks('project', {
      hooks: {
        PreToolUse: [{hooks: [
          {type: 'command', command: 'block-rm', matcher: {toolName: 'Bash', commandPattern: 'rm\\s+-rf'}},
        ]}],
      },
    });
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    const matched = registry.getMatchedHooks('PreToolUse', {toolName: 'Bash', commandText: 'rm -rf /'});
    expect(matched).toHaveLength(1);
    const notMatched = registry.getMatchedHooks('PreToolUse', {toolName: 'Bash', commandText: 'ls -la'});
    expect(notMatched).toHaveLength(0);
  });

  test('skips missing files gracefully', async () => {
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: '/nonexistent/hooks.json'}]);
    expect(registry.size).toBe(0);
  });

  test('skips invalid JSON gracefully', async () => {
    const dir = path.join(TMP, 'bad');
    mkdirSync(dir, {recursive: true});
    const filePath = path.join(dir, 'hooks.json');
    writeFileSync(filePath, 'not json{{{');
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    expect(registry.size).toBe(0);
  });

  test('skips invalid hook definitions within valid config', async () => {
    const filePath = writeTmpHooks('project', {
      hooks: {
        PreToolUse: [{hooks: [
          {type: 'command'},  // missing command field
          {type: 'command', command: 'valid'},
        ]}],
      },
    });
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    expect(registry.size).toBe(1); // only the valid one
  });

  test('reload clears and reloads', async () => {
    const filePath = writeTmpHooks('project', {
      hooks: {Stop: [{hooks: [{type: 'command', command: 'echo'}]}]},
    });
    const registry = new HookRegistryImpl();
    await registry.load([{kind: 'project', path: filePath}]);
    expect(registry.size).toBe(1);

    // Overwrite with empty
    writeFileSync(filePath, JSON.stringify({hooks: {}}));
    await registry.reload();
    expect(registry.size).toBe(0);
  });
});
