import {describe, expect, it} from 'bun:test';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('subagent multi-profile cases', () => {
  it('should verify Plan, Explore, and general-purpose delegates cooperate over one parent flow through the real CLI', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-cli-multi-profile-'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Coordinate multiple delegates',
      scenario: 'multi-profile-coordination',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('PLAN_DONE:true');
    expect(result.output).toContain('EXPLORE_DONE:true');
    expect(result.output).toContain('GENERAL_DONE:true');
    expect(result.output).toContain('PARENT_DONE');

    const taskDir = path.join(projectRoot, '.codara', 'case-tasks');
    const entries = (await readdir(taskDir)).filter((entry) => entry.endsWith('.json'));
    expect(entries).toHaveLength(1);

    const task = JSON.parse(await readFile(path.join(taskDir, entries[0] as string), 'utf8')) as {
      subject: string;
      status: string;
      owner?: string;
    };
    expect(task.subject).toBe('Coordinate multi-subagent run');
    expect(task.status).toBe('in_progress');
    expect(task.owner).toBe('general-purpose');
  });
});
