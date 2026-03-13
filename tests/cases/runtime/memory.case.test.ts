import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('runtime memory command cases', () => {
  it('should route /memory project through the CLI host open_file handling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-memory-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/memory project',
      scenario: 'memory-project',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Open file:');
    expect(result.output).toContain(path.join(projectRoot, 'AGENTS.md').split(path.sep).slice(-2).join(path.sep));
  });
});
