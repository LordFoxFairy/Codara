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
    expect(result.output).toContain('PARENT_DONE');
    expect(result.output).toContain('✓ Plan: Create the implementation plan');
    expect(result.output).toContain('✓ Explore: Explore the current codebase state');
    expect(result.output).toContain('✓ Agent: Inspect the shared tasks');

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

    const taskRunDir = path.join(projectRoot, '.codara', 'case-task-runs');
    const runEntries = (await readdir(taskRunDir)).filter((entry) => entry.endsWith('.json')).sort();
    expect(runEntries).toEqual([
      'call_parent_explore.json',
      'call_parent_general.json',
      'call_parent_plan.json',
    ]);

    const runs = await Promise.all(runEntries.map(async (entry) => (
      JSON.parse(await readFile(path.join(taskRunDir, entry), 'utf8')) as {
        runId: string;
        status: string;
        summary?: string;
      }
    )));

    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 'call_parent_plan',
        status: 'completed',
        summary: 'PLAN_DONE:true',
      }),
      expect.objectContaining({
        runId: 'call_parent_explore',
        status: 'completed',
        summary: 'EXPLORE_DONE:true',
      }),
      expect.objectContaining({
        runId: 'call_parent_general',
        status: 'completed',
        summary: 'GENERAL_DONE:true',
      }),
    ]));
  });
});
