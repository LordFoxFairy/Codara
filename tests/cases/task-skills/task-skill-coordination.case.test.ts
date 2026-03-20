import {describe, expect, it} from 'bun:test';
import {mkdtemp, readdir, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('task-skills cases', () => {
  it('should expose project skill context during a task-oriented skill workflow through the real CLI', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-cli-task-skill-'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Please complete the task using project skill workflow.',
      scenario: 'task-skill-workflow',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('TASK_DONE');
  });

  it('should let a skill-selected Task delegate read shared tasks through the real CLI', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-cli-task-delegate-'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Coordinate task and skill flow',
      scenario: 'task-skill-delegate',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('parent_done');
    expect(result.output).toContain('✓ Agent: Inspect shared tasks');

    const taskDir = path.join(projectRoot, '.codara', 'case-tasks');
    const entries = (await readdir(taskDir)).filter((entry) => entry.endsWith('.json'));
    expect(entries).toHaveLength(1);

    const task = JSON.parse(await readFile(path.join(taskDir, entries[0] as string), 'utf8')) as {
      subject: string;
      status: string;
    };
    expect(task.subject).toBe('Inspect task-skill integration');
    expect(task.status).toBe('pending');

    const taskRunDir = path.join(projectRoot, '.codara', 'case-task-runs');
    const runEntries = (await readdir(taskRunDir)).filter((entry) => entry.endsWith('.json'));
    expect(runEntries).toEqual(['call_task_delegate.json']);

    const runRecord = JSON.parse(await readFile(path.join(taskRunDir, runEntries[0] as string), 'utf8')) as {
      runId: string;
      status: string;
      summary?: string;
    };
    expect(runRecord).toMatchObject({
      runId: 'call_task_delegate',
      status: 'completed',
      summary: 'shared_tasks_visible:true',
    });
  });
});
