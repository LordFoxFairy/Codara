import {describe, expect, it} from 'bun:test';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

async function waitForCondition(
  predicate: () => Promise<boolean> | boolean,
  options: {timeoutMs?: number; intervalMs?: number} = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() <= deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error('Condition was not satisfied before timeout');
}

describe('subagent multi-profile cases', () => {
  it('should launch Plan, Explore, and Agent from one parent response through the real CLI', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-cli-multi-profile-'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Coordinate multiple delegates',
      scenario: 'multi-profile-coordination',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Task created.');

    const taskDir = path.join(projectRoot, '.codara', 'case-tasks');
    await waitForCondition(async () => {
      try {
        return (await readdir(taskDir)).some((entry) => entry.endsWith('.json'));
      } catch {
        return false;
      }
    });
    const entries = (await readdir(taskDir)).filter((entry) => entry.endsWith('.json'));
    expect(entries).toHaveLength(1);

    const task = JSON.parse(await readFile(path.join(taskDir, entries[0] as string), 'utf8')) as {
      subject: string;
      status: string;
      owner?: string;
    };
    expect(task.subject).toBe('Coordinate multi-subagent run');
    expect(task.status).toBe('in_progress');
    expect(task.owner).toBe('Agent');

    const agentRunDir = path.join(projectRoot, '.codara', 'case-agent-runs');
    await waitForCondition(async () => {
      try {
        return (await readdir(agentRunDir)).filter((entry) => entry.endsWith('.json')).length === 3;
      } catch {
        return false;
      }
    });
    const runEntries = (await readdir(agentRunDir)).filter((entry) => entry.endsWith('.json')).sort();
    expect(runEntries).toEqual([
      'call_parent_explore.json',
      'call_parent_general.json',
      'call_parent_plan.json',
    ]);

    await waitForCondition(async () => {
      const currentRuns = await Promise.all(runEntries.map(async (entry) => (
        JSON.parse(await readFile(path.join(agentRunDir, entry), 'utf8')) as {
          status: string;
        }
      )));
      return currentRuns.every((run) => run.status === 'completed');
    });

    const runs = await Promise.all(runEntries.map(async (entry) => (
      JSON.parse(await readFile(path.join(agentRunDir, entry), 'utf8')) as {
        runId: string;
        status: string;
        summary?: string;
        label?: string;
      }
    )));

    expect(runs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 'call_parent_plan',
        status: 'completed',
        summary: 'PLAN_DONE:true',
        label: 'Delegating Plan: Create the implementation plan',
      }),
      expect.objectContaining({
        runId: 'call_parent_explore',
        status: 'completed',
        summary: 'EXPLORE_DONE:true',
        label: 'Delegating Explore: Explore the current codebase state',
      }),
      expect.objectContaining({
        runId: 'call_parent_general',
        status: 'completed',
        summary: 'GENERAL_DONE:true',
        label: 'Delegating Agent: Inspect the shared tasks and mark the active item in progress',
      }),
    ]));
  });
});
