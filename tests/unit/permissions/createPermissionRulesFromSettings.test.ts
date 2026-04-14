import {describe, expect, it} from 'bun:test';
import {createPermissionRulesFromSettings} from '@core/middleware/permission/policy/config';

describe('createPermissionRulesFromSettings', () => {
  it('should create permission rules from unified settings', () => {
    const result = createPermissionRulesFromSettings({
      defaultMode: 'plan',
      alwaysAllow: ['Read', 'Glob'],
      alwaysDeny: ['Bash(rm -rf:*)'],
      alwaysAsk: ['Write'],
    });

    expect(result.defaultDecision).toBe('ask');
    expect(result.rules).toHaveLength(4);

    // alwaysAllow rules
    expect(result.rules[0]).toMatchObject({permission: 'Read', pattern: '*', action: 'allow'});
    expect(result.rules[1]).toMatchObject({permission: 'Glob', pattern: '*', action: 'allow'});

    // alwaysDeny rules
    expect(result.rules[2]).toMatchObject({permission: 'Bash', pattern: 'rm -rf:*', action: 'deny'});

    // alwaysAsk rules
    expect(result.rules[3]).toMatchObject({permission: 'Write', pattern: '*', action: 'ask'});
  });

  it('should return defaults when permissions is undefined', () => {
    const result = createPermissionRulesFromSettings(undefined);

    expect(result.defaultDecision).toBe('ask');
    expect(result.rules).toHaveLength(0);
  });

  it('should map bypassPermissions defaultMode to allow', () => {
    const result = createPermissionRulesFromSettings({defaultMode: 'bypassPermissions'});

    expect(result.defaultDecision).toBe('allow');
    expect(result.rules).toHaveLength(0);
  });

  it('should map dontAsk defaultMode to allow', () => {
    const result = createPermissionRulesFromSettings({defaultMode: 'dontAsk'});

    expect(result.defaultDecision).toBe('allow');
  });

  it('should map default defaultMode to ask', () => {
    const result = createPermissionRulesFromSettings({defaultMode: 'default'});

    expect(result.defaultDecision).toBe('ask');
  });

  it('should map acceptEdits defaultMode to ask', () => {
    const result = createPermissionRulesFromSettings({defaultMode: 'acceptEdits'});

    expect(result.defaultDecision).toBe('ask');
  });

  it('should handle empty arrays gracefully', () => {
    const result = createPermissionRulesFromSettings({
      alwaysAllow: [],
      alwaysDeny: [],
      alwaysAsk: [],
    });

    expect(result.defaultDecision).toBe('ask');
    expect(result.rules).toHaveLength(0);
  });

  it('should parse expressions with patterns correctly', () => {
    const result = createPermissionRulesFromSettings({
      alwaysAllow: ['Bash(git *)'],
    });

    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]).toMatchObject({
      permission: 'Bash',
      pattern: 'git *',
      action: 'allow',
    });
  });

  it('should skip malformed expressions missing closing paren', () => {
    const result = createPermissionRulesFromSettings({
      alwaysAllow: ['Bash(git *'],
    });

    expect(result.rules).toHaveLength(0);
  });

  it('should attach source info with scope=settings', () => {
    const result = createPermissionRulesFromSettings({
      alwaysAllow: ['Read'],
    });

    expect(result.rules[0]?.source).toMatchObject({
      scope: 'settings',
      path: '<unified-settings>',
    });
  });

  it('should handle partial permissions (only some fields provided)', () => {
    const result = createPermissionRulesFromSettings({
      alwaysAllow: ['Read', 'Glob'],
    });

    expect(result.defaultDecision).toBe('ask');
    expect(result.rules).toHaveLength(2);
    expect(result.rules[0]).toMatchObject({permission: 'Read', pattern: '*', action: 'allow'});
    expect(result.rules[1]).toMatchObject({permission: 'Glob', pattern: '*', action: 'allow'});
  });
});
