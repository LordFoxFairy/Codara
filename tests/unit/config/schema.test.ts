import {describe, expect, it} from 'bun:test';
import {codaraSettingsSchema, type CodaraSettings} from '@config/schema';

describe('CodaraSettings schema', () => {
  it('should accept empty object as valid settings', () => {
    const result = codaraSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('should accept full settings', () => {
    const full: CodaraSettings = {
      model: 'opus',
      maxTurns: 50,
      defaultShell: 'zsh',
      theme: 'dark',
      permissions: {
        defaultMode: 'default',
        alwaysAllow: ['Read', 'Glob', 'Grep'],
        alwaysDeny: ['Bash(rm -rf:*)'],
        alwaysAsk: [],
      },
      hooks: {
        PreToolUse: [{matcher: {toolName: 'Bash'}, command: 'echo hi', timeout: 5000}],
      },
      mcpServers: {
        filesystem: {
          type: 'stdio',
          command: 'npx',
          args: ['@modelcontextprotocol/server-filesystem'],
        },
      },
      skillSources: ['~/.codara/skills'],
    };
    const result = codaraSettingsSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('should reject invalid permission mode', () => {
    const result = codaraSettingsSchema.safeParse({
      permissions: {defaultMode: 'invalid_mode'},
    });
    expect(result.success).toBe(false);
  });

  it('should passthrough unknown fields for forward compat', () => {
    const result = codaraSettingsSchema.safeParse({unknownField: 'value'});
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>).unknownField).toBe('value');
    }
  });
});
