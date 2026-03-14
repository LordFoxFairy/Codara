import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createCodaraGuidelinesSource} from '@core/context/instructions/guidelines';

describe('AGENTS guidelines', () => {
  it('loads only the startup-visible AGENTS chain before deeper paths are touched', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const cwd = path.join(projectRoot, 'packages');
    const deeperDir = path.join(projectRoot, 'packages', 'app');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(deeperDir, {recursive: true});
    await writeFile(path.join(userHome, '.codara', 'AGENTS.md'), '# Global Rules', 'utf8');
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Project Rules', 'utf8');
    await writeFile(path.join(projectRoot, 'packages', 'AGENTS.md'), '# Package Rules', 'utf8');
    await writeFile(path.join(deeperDir, 'AGENTS.md'), '# App Rules', 'utf8');

    const guidelinesSource = createCodaraGuidelinesSource({userHome, cwd});
    const content = await guidelinesSource?.getContent();

    expect(content).toBeDefined();
    expect(content).toContain('# Global Rules');
    expect(content).toContain('# Project Rules');
    expect(content).toContain('# Package Rules');
    expect(content).not.toContain('# App Rules');
  });

  it('does not load deeper subtree AGENTS just because a deeper file exists', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const userHome = path.join(root, 'home');
    const projectRoot = path.join(root, 'project');
    const cwd = projectRoot;
    const deeperDir = path.join(projectRoot, 'packages', 'app');

    await mkdir(path.join(userHome, '.codara'), {recursive: true});
    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(path.join(deeperDir, 'src'), {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Project Rules', 'utf8');
    await writeFile(path.join(deeperDir, 'AGENTS.md'), '# App Rules', 'utf8');
    const guidelinesSource = createCodaraGuidelinesSource({userHome, cwd});
    const content = await guidelinesSource?.getContent();

    expect(content).toContain('# Project Rules');
    expect(content).not.toContain('# App Rules');
  });

  it('expands @path imports up to the fixed depth limit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const projectRoot = path.join(root, 'project');
    const importsDir = path.join(projectRoot, 'imports');

    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await mkdir(importsDir, {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Root\n@./imports/level1.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level1.md'), 'L1\n@./level2.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level2.md'), 'L2\n@./level3.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level3.md'), 'L3\n@./level4.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level4.md'), 'L4\n@./level5.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level5.md'), 'L5\n@./level6.md\n', 'utf8');
    await writeFile(path.join(importsDir, 'level6.md'), 'L6\n', 'utf8');

    const guidelinesSource = createCodaraGuidelinesSource({projectRoot});
    const content = await guidelinesSource?.getContent();

    expect(content).toContain('# Root');
    expect(content).toContain('L1');
    expect(content).toContain('L5');
    expect(content).not.toContain('L6');
    expect(content).toContain('@./level6.md');
  });

  it('loads large AGENTS files in full instead of truncating to 200 lines', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-guidelines-'));
    const projectRoot = path.join(root, 'project');
    const lines = Array.from({length: 240}, (_, index) => `line ${index + 1}`).join('\n');

    await mkdir(path.join(projectRoot, '.git'), {recursive: true});
    await writeFile(path.join(projectRoot, 'AGENTS.md'), lines, 'utf8');

    const guidelinesSource = createCodaraGuidelinesSource({projectRoot});
    const content = await guidelinesSource?.getContent();

    expect(content).toContain('line 1');
    expect(content).toContain('line 240');
    expect(content).not.toContain('Truncated after 200 lines');
  });
});
