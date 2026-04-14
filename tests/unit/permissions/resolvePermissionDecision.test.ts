import {describe, expect, it} from 'bun:test';
import {resolvePermissionDecision, getDefaultToolDecision} from '@core/middleware/permission/policy';
import type {PermissionRuleSet} from '@core/middleware/permission/types';

/**
 * Tests for the 3-layer permission resolution:
 *   Layer 1: Explicit rules (alwaysAllow/alwaysDeny/alwaysAsk)
 *   Layer 2: Default tool-type decision (read-only → allow, write → ask)
 *   Layer 3: Mode transformation (plan, bypassPermissions, dontAsk, acceptEdits)
 */

function makeRuleSet(overrides?: Partial<PermissionRuleSet>): PermissionRuleSet {
  return {
    rules: overrides?.rules ?? [],
    defaultDecision: overrides?.defaultDecision ?? 'ask',
  };
}

const source = {scope: 'test', path: '<test>'};

describe('getDefaultToolDecision (Layer 2)', () => {
  it('should return allow for read-only tools', () => {
    expect(getDefaultToolDecision('Read')).toBe('allow');
    expect(getDefaultToolDecision('Glob')).toBe('allow');
    expect(getDefaultToolDecision('Grep')).toBe('allow');
    expect(getDefaultToolDecision('Fetch')).toBe('allow');
    expect(getDefaultToolDecision('Search')).toBe('allow');
  });

  it('should return allow for read-only tools (case-insensitive)', () => {
    expect(getDefaultToolDecision('read')).toBe('allow');
    expect(getDefaultToolDecision('glob')).toBe('allow');
    expect(getDefaultToolDecision('grep')).toBe('allow');
    expect(getDefaultToolDecision('fetch')).toBe('allow');
    expect(getDefaultToolDecision('search')).toBe('allow');
  });

  it('should return ask for write tools', () => {
    expect(getDefaultToolDecision('Bash')).toBe('ask');
    expect(getDefaultToolDecision('Write')).toBe('ask');
    expect(getDefaultToolDecision('Edit')).toBe('ask');
  });

  it('should return ask for unknown tools', () => {
    expect(getDefaultToolDecision('UnknownTool')).toBe('ask');
  });
});

describe('resolvePermissionDecision (3-layer)', () => {
  describe('Layer 1: Explicit rules take priority', () => {
    it('should allow when an explicit allow rule matches', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'git *', action: 'allow', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'git status'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('allow');
    });

    it('should deny when an explicit deny rule matches', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'rm *', action: 'deny', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'rm -rf /'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('deny');
    });

    it('should ask when an explicit ask rule matches', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'npm *', action: 'ask', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'npm install foo'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('ask');
    });
  });

  describe('Layer 2: Default tool-type decision when no rule matches', () => {
    it('should allow read-only tools with no matching rules', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'read_file',
        toolArgs: {file_path: '/tmp/foo.ts'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('allow');
    });

    it('should allow Glob tool with no matching rules', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'glob',
        toolArgs: {pattern: '**/*.ts'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('allow');
    });

    it('should allow Grep tool with no matching rules', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'grep',
        toolArgs: {pattern: 'foo'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('allow');
    });

    it('should ask for write tools with no matching rules', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'touch newfile.txt'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('ask');
    });

    it('should ask for Edit tool with no matching rules', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'edit_file',
        toolArgs: {file_path: '/tmp/foo.ts'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('ask');
    });

    it('should ask for Write tool with no matching rules', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'write_file',
        toolArgs: {file_path: '/tmp/foo.ts'},
        rules,
        mode: undefined,
      });
      expect(result).toBe('ask');
    });
  });

  describe('Layer 3: Mode transformation applied after Layer 1+2', () => {
    it('plan mode: explicit allow rule → ask (mode transforms allow to ask)', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'git *', action: 'allow', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'git status'},
        rules,
        mode: 'plan',
      });
      expect(result).toBe('ask');
    });

    it('plan mode: read-only tool default allow → ask', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'read_file',
        toolArgs: {file_path: '/tmp/foo.ts'},
        rules,
        mode: 'plan',
      });
      expect(result).toBe('ask');
    });

    it('bypassPermissions mode: everything → allow', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'rm *', action: 'deny', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'rm -rf /'},
        rules,
        mode: 'bypassPermissions',
      });
      expect(result).toBe('allow');
    });

    it('dontAsk mode: ask → deny', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'touch newfile.txt'},
        rules,
        mode: 'dontAsk',
      });
      expect(result).toBe('deny');
    });

    it('dontAsk mode: read-only tool (Layer 2 allow) stays allow', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'read_file',
        toolArgs: {file_path: '/tmp/foo.ts'},
        rules,
        mode: 'dontAsk',
      });
      expect(result).toBe('allow');
    });

    it('acceptEdits mode: Write tool ask → allow', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'write_file',
        toolArgs: {file_path: '/tmp/foo.ts'},
        rules,
        mode: 'acceptEdits',
      });
      expect(result).toBe('allow');
    });

    it('acceptEdits mode: Bash ask stays ask', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'touch newfile.txt'},
        rules,
        mode: 'acceptEdits',
      });
      expect(result).toBe('ask');
    });
  });

  describe('Layer interaction: explicit rules + mode', () => {
    it('explicit deny + plan mode: deny stays deny', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'rm *', action: 'deny', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'rm -rf /'},
        rules,
        mode: 'plan',
      });
      expect(result).toBe('deny');
    });

    it('explicit ask + dontAsk mode: ask → deny', () => {
      const rules = makeRuleSet({
        rules: [{permission: 'Bash', pattern: 'npm *', action: 'ask', source}],
      });
      const result = resolvePermissionDecision({
        toolName: 'bash',
        toolArgs: {command: 'npm install foo'},
        rules,
        mode: 'dontAsk',
      });
      expect(result).toBe('deny');
    });

    it('unknown tool with no expression falls through to Layer 2 default', () => {
      const rules = makeRuleSet();
      const result = resolvePermissionDecision({
        toolName: 'unknown_tool',
        toolArgs: {},
        rules,
        mode: undefined,
      });
      expect(result).toBe('ask');
    });
  });
});
