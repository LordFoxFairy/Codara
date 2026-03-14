import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('case: subagent permission default ask', () => {
  it('should promote delegated child permission pauses for guarded bash commands and persist always-allow for the next delegated run in the real CLI', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-subagent-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Delegate the guarded task',
      scenario: 'subagent-permission',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'always',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('SUBAGENT_PERMISSION_PARENT_DONE');
    expect(first.output).not.toContain('HIL action:');

    const settings = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(settings.permissions?.rules?.allow).toContain('Bash(touch guarded.txt)');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Delegate the guarded task again',
      scenario: 'subagent-permission',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('SUBAGENT_PERMISSION_PARENT_DONE');
    expect(second.output).not.toContain('Permission Review');
    expect(second.output).not.toContain('HIL action:');
  });
});
