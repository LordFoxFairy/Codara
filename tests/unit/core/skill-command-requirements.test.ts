import {describe, expect, it} from 'bun:test';
import {
  deriveSkillCommandRequirements,
  extractShellCommandName,
  parseAllowedToolReference,
} from '@capability/command/skill-requirements';

describe('skill command requirements', () => {
  it('should normalize allowed tools into runtime tools and shell command requirements', () => {
    const requirements = deriveSkillCommandRequirements([
      'bash',
      'read',
      'webfetch',
      'Bash(gh pr view:*)',
    ]);

    expect(requirements.allowedTools).toEqual([
      'bash',
      'read',
      'webfetch',
      'Bash(gh pr view:*)',
    ]);
    expect(requirements.runtimeTools).toEqual([
      'bash',
      'read_file',
      'fetch_url',
    ]);
    expect(requirements.requiredShellCommands).toEqual(['gh']);
  });

  it('should parse aliased tool names and bash shell commands from allowed-tools references', () => {
    expect(parseAllowedToolReference('read')).toEqual({toolName: 'read_file'});
    expect(parseAllowedToolReference('websearch')).toEqual({toolName: 'web_search'});
    expect(parseAllowedToolReference('Bash(gh pr view:*)')).toEqual({
      toolName: 'bash',
      shellCommand: 'gh',
    });
  });

  it('should extract shell command names from bash expressions with env and sudo prefixes', () => {
    expect(extractShellCommandName('env GH_TOKEN=test gh pr view')).toBe('gh');
    expect(extractShellCommandName('sudo env DEBUG=1 git status')).toBe('git');
    expect(extractShellCommandName('FOO=bar bun test')).toBe('bun');
    expect(extractShellCommandName('command -v git')).toBeUndefined();
  });
});
