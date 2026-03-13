import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('runtime progressive disclosure cases', () => {
  it('loads subtree AGENTS.md after the agent reads a file in that subtree through the real CLI path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-progressive-disclosure-'));
    const projectRoot = path.join(root, 'project');
    const targetFile = path.join(projectRoot, 'packages', 'app', 'src', 'feature.ts');

    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(path.dirname(targetFile), {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'ROOT_RULE', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'app', 'AGENTS.md'), 'APP_RULE', 'utf8');
    await writeFile(targetFile, 'export const feature = true;\n', 'utf8');

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'inspect the feature file',
      scenario: 'progressive-disclosure',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('PROGRESSIVE_DISCLOSURE_DONE:true');
  });
});
