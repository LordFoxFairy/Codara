import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('case: subagent permission default ask', () => {
  it('should persist delegated child always-allow rules so the next runtime session can complete the background task without another review', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-subagent-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Delegate the guarded task',
      scenario: 'subagent-permission',
      env: {
        CODARA_CLI_REVIEW_AUTO_ACTIONS: 'always',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('SUBAGENT_PERMISSION_PARENT_DONE');
    expect(first.output).toContain('Task waiting for review');
    expect(first.output).toContain('Waiting for approval on bash');
    expect(first.output).not.toContain('HIL action:');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Delegate the guarded task again',
      scenario: 'subagent-permission',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('✓ Task: Inspect the repo and run touch guarded.txt');
    expect(second.output).not.toContain('Delegated task is waiting for review.');
    expect(second.output).not.toContain('Task waiting for review');
    expect(second.output).not.toContain('Permission Review');
    expect(second.output).not.toContain('HIL action:');
  });
});
