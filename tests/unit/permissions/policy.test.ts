import {describe, expect, it} from 'bun:test';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {type ToolCall} from '@langchain/core/messages';
import {ensurePermissionSettingsFile, evaluatePermissionToolCall, persistPermissionScope} from '@core';

describe('permission policy defaults', () => {
  it('should seed the settings skeleton with common read-only allow rules', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-defaults-'));
    const result = ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const content = JSON.parse(await readFile(result.settingsFile, 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };

    expect(content.permissions?.rules?.allow).toContain('Read(*)');
    expect(content.permissions?.rules?.allow).toContain('Bash(git status)');
    expect(content.permissions?.rules?.allow).toContain('Bash(rg *)');
  });

  it('should allow read-oriented builtin tools from the default settings skeleton', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-read-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_read_default_1', name: 'read_file', args: {file_path: '/tmp/demo.ts'}};

    const evaluation = await evaluatePermissionToolCall(toolCall, {projectRoot, cwd: projectRoot});

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Read(*)');
  });

  it('should keep guarded bash commands at ask by default', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-guarded-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_bash_guarded_1', name: 'bash', args: {command: 'touch guarded.txt'}};

    const evaluation = await evaluatePermissionToolCall(toolCall, {projectRoot, cwd: projectRoot});

    expect(evaluation?.decision).toBe('ask');
    expect(evaluation?.matched).toBeNull();
  });

  it('should persist command-type scope rules for bash approvals', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-tool-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope({id: 'call_tool_scope', name: 'bash', args: {command: 'touch guarded.txt'}}, 'tool', {
      projectRoot,
      cwd: projectRoot,
    });

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Bash(touch *)');
  });

  it('should persist project trust as permissions.defaultDecision=allow', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-project-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope({id: 'call_project_scope', name: 'bash', args: {command: 'touch guarded.txt'}}, 'project', {
      projectRoot,
      cwd: projectRoot,
    });

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {defaultDecision?: string};
    };
    expect(content.permissions?.defaultDecision).toBe('allow');
  });
});
