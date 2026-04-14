import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('runtime default workflow cases', () => {
  it('should expose the default todo + shared task + delegation flow through the real CLI', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-default-runtime-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run the default runtime workflow.',
      scenario: 'default-runtime-workflow',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Track default runtime workflow');
    expect(result.output).toContain('DEFAULT_RUNTIME_FLOW_DONE');
  });
});
