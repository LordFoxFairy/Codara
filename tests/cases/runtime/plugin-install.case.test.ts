import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'bun:test';
import {runRealCliCase} from '../helpers/real-cli';

describe('runtime plugin install cases', () => {
  it('should import superpowers skills through the Claude-style plugin install command', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-plugin-install-'));
    const projectRoot = path.join(root, 'project');
    const homeRoot = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'superpowers-fixture');
    const skillDir = path.join(fixtureRoot, 'skills', 'using-superpowers');

    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(skillDir, {recursive: true});
    await mkdir(homeRoot, {recursive: true});
    await Bun.write(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: using-superpowers',
      'description: Introduce the imported superpowers workflow.',
      '---',
      '',
      '# Using Superpowers',
      '',
      'Imported fixture skill.',
      '',
    ].join('\n'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/plugin install superpowers@claude-plugins-official',
      scenario: 'plugin-install',
      env: {
        HOME: homeRoot,
        CODARA_PLUGIN_SUPERPOWERS_SOURCE: fixtureRoot,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Imported plugin superpowers@claude-plugins-official');
    expect(result.output).toContain('Installed 1 skills');

    const installedSkill = path.join(homeRoot, '.codara', 'skills', 'using-superpowers', 'SKILL.md');
    const content = await readFile(installedSkill, 'utf8');
    expect(content).toContain('using-superpowers');
  });
});
