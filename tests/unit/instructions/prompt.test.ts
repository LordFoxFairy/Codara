import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createCodaraPromptSource} from '@core/instructions/prompt';

describe('Codara handbook prompt source', () => {
  it('loads only the startup-visible handbook chain before deeper paths are touched', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-prompt-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const cwd = path.join(projectRoot, 'packages');
    const deeperDir = path.join(projectRoot, 'packages', 'app');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(path.join(cwd, '.codara'), {recursive: true});
    await mkdir(path.join(deeperDir, '.codara'), {recursive: true});
    await writeFile(path.join(userHome, '.codara', 'codara.md'), '# Global Handbook', 'utf8');
    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), '# Project Handbook', 'utf8');
    await writeFile(path.join(cwd, '.codara', 'codara.md'), '# Package Handbook', 'utf8');
    await writeFile(path.join(deeperDir, '.codara', 'codara.md'), '# App Handbook', 'utf8');

    const promptSource = createCodaraPromptSource({userHome, cwd, projectRoot});
    const content = await promptSource?.getContent();

    expect(content).toBeDefined();
    expect(content).toContain('# Global Handbook');
    expect(content).toContain('# Project Handbook');
    expect(content).toContain('# Package Handbook');
    expect(content).not.toContain('# App Handbook');
  });

  it('loads deeper subtree handbook files after a matching file path is activated', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-prompt-'));
    const projectRoot = path.join(root, 'project');
    const deeperDir = path.join(projectRoot, 'packages', 'app');
    const targetFile = path.join(deeperDir, 'src', 'feature.ts');

    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(path.join(deeperDir, '.codara'), {recursive: true});
    await mkdir(path.dirname(targetFile), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), '# Project Handbook', 'utf8');
    await writeFile(path.join(deeperDir, '.codara', 'codara.md'), '# App Handbook', 'utf8');
    await writeFile(targetFile, 'export const feature = true;\n', 'utf8');

    const promptSource = createCodaraPromptSource({projectRoot});
    expect(await promptSource?.getContent()).not.toContain('# App Handbook');

    await promptSource?.activateTarget?.({path: targetFile, kind: 'file'});
    const content = await promptSource?.getContent();

    expect(content).toContain('# Project Handbook');
    expect(content).toContain('# App Handbook');
  });

  it('expands handbook @path imports recursively up to the fixed limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-prompt-'));
    const projectRoot = path.join(root, 'project');
    const importsDir = path.join(projectRoot, '.codara', 'imports');

    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(importsDir, {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'codara.md'), '# Root Handbook\n@./imports/level1.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level1.md'), 'H1\n@./level2.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level2.md'), 'H2\n@./level3.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level3.md'), 'H3\n@./level4.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level4.md'), 'H4\n@./level5.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level5.md'), 'H5\n@./level6.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level6.md'), 'H6\n', 'utf8');

    const promptSource = createCodaraPromptSource({projectRoot});
    const content = await promptSource?.getContent();

    expect(content).toContain('H1');
    expect(content).toContain('H5');
    expect(content).not.toContain('H6');
    expect(content).toContain('@./level6.md');
  });
});
