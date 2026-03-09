import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {loadCodaraSourceProjection} from '@core/codara/source-stack';

describe('Codara source stack', () => {
  it('should load preprojected guidelines and memory from the workspace source stack', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-source-stack-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const nestedCwd = path.join(projectRoot, 'packages', 'app');
    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(nestedCwd, {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), 'project rule', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'MEMORY.md'), 'project memory', 'utf8');

    const loaded = await loadCodaraSourceProjection({
      cwd: nestedCwd,
      guidelines: {userHome},
      memory: {userHome},
      skills: false,
      builtinTools: false,
    });

    expect(loaded.guidelines).toContain('project rule');
    expect(loaded.memory).toContain('project memory');
  });

  it('should respect disabled guidelines and memory independently', async () => {
    const loaded = await loadCodaraSourceProjection({
      guidelines: false,
      memory: false,
      skills: false,
      builtinTools: false,
    });

    expect(loaded).toEqual({
      guidelines: undefined,
      memory: undefined,
    });
  });
});
