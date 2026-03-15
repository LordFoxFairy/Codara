// tests/integration/permission-basic.test.ts

import {describe, it, expect} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ensurePermissionSettingsFile, evaluatePermissionToolCall} from '@/index';
import {evaluatePermissionExpression} from '@engine/pipeline/permission/policy';

describe('Permission System Integration', () => {
  it('should evaluate allow decision from default rules', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-basic-allow-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    const result = await evaluatePermissionToolCall(
      {id: 'call_read_1', name: 'read_file', args: {file_path: 'src/index.ts'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(result?.decision).toBe('allow');
    expect(result?.matched).toBeDefined();
    expect(result?.matched?.rule).toBe('Read(*)');
  });

  it('should evaluate expression strings directly', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-basic-expr-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Read(*)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const result = await evaluatePermissionExpression('Read(src/index.ts)', {
      projectRoot,
      cwd: projectRoot,
    });

    expect(result.decision).toBe('allow');
    expect(result.matched?.rule).toBe('Read(*)');
  });

  it('should respect deny rules with last-match-wins', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-basic-deny-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(*)'],
          ask: [],
          deny: ['Bash(rm -rf /)'],
        },
      },
    }, null, 2));

    const result = await evaluatePermissionToolCall(
      {id: 'call_bash_deny', name: 'bash', args: {command: 'rm -rf /'}},
      {projectRoot, cwd: projectRoot},
    );

    // Last-match-wins: deny rule comes after allow, so deny wins
    expect(result?.decision).toBe('deny');
    expect(result?.matched?.bucket).toBe('deny');
  });

  it('should default to ask when no rules match', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-perm-basic-default-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    const result = await evaluatePermissionToolCall(
      {id: 'call_bash_default', name: 'bash', args: {command: 'touch new-file.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(result?.decision).toBe('ask');
    expect(result?.matched).toBeNull();
    expect(result?.defaultDecision).toBe('ask');
  });
});
