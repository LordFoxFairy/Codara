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

  it('should translate official plugin commands into Codara skill commands through the same install flow', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-plugin-command-install-'));
    const projectRoot = path.join(root, 'project');
    const homeRoot = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'code-review-fixture');
    const commandDir = path.join(fixtureRoot, 'commands');

    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(commandDir, {recursive: true});
    await mkdir(homeRoot, {recursive: true});
    await Bun.write(path.join(commandDir, 'code-review.md'), [
      '---',
      'description: Review a pull request with multiple agents.',
      'allowed-tools: Bash(gh pr view:*)',
      '---',
      '',
      'Provide a code review for the current pull request.',
      '',
    ].join('\n'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/plugin install code-review@claude-plugins-official',
      scenario: 'plugin-install',
      env: {
        HOME: homeRoot,
        CODARA_PLUGIN_CODE_REVIEW_SOURCE: fixtureRoot,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Imported plugin code-review@claude-plugins-official');
    expect(result.output).toContain('code-review-code-review');

    const installedSkill = path.join(homeRoot, '.codara', 'skills', 'code-review-code-review', 'SKILL.md');
    const content = await readFile(installedSkill, 'utf8');
    expect(content).toContain('command-name: code-review');
  });

  it('should import official skill-based plugins through the same install flow', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-plugin-skill-install-'));
    const projectRoot = path.join(root, 'project');
    const homeRoot = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'skill-creator-fixture');
    const skillDir = path.join(fixtureRoot, 'skills', 'skill-creator');

    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(skillDir, {recursive: true});
    await mkdir(homeRoot, {recursive: true});
    await Bun.write(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: skill-creator',
      'description: Create Codara-compatible skills.',
      '---',
      '',
      '# Skill Creator',
      '',
      'Imported fixture skill.',
      '',
    ].join('\n'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/plugin install skill-creator@claude-plugins-official',
      scenario: 'plugin-install',
      env: {
        HOME: homeRoot,
        CODARA_PLUGIN_SKILL_CREATOR_SOURCE: fixtureRoot,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Imported plugin skill-creator@claude-plugins-official');
    expect(result.output).toContain('skill-creator');

    const installedSkill = path.join(homeRoot, '.codara', 'skills', 'skill-creator', 'SKILL.md');
    const content = await readFile(installedSkill, 'utf8');
    expect(content).toContain('name: skill-creator');
  });

  it('should install plugins into the current project when .codara/settings.json disables global installs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-plugin-project-scope-'));
    const projectRoot = path.join(root, 'project');
    const homeRoot = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'skill-creator-fixture');
    const skillDir = path.join(fixtureRoot, 'skills', 'skill-creator');

    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await mkdir(skillDir, {recursive: true});
    await mkdir(homeRoot, {recursive: true});
    await Bun.write(path.join(projectRoot, '.codara', 'settings.json'), JSON.stringify({
      plugins: {
        installGlobal: false,
      },
    }, null, 2));
    await Bun.write(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: skill-creator',
      'description: Create Codara-compatible skills.',
      '---',
      '',
      '# Skill Creator',
      '',
      'Imported fixture skill.',
      '',
    ].join('\n'));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/plugin install skill-creator@claude-plugins-official',
      scenario: 'plugin-install',
      env: {
        HOME: homeRoot,
        CODARA_PLUGIN_SKILL_CREATOR_SOURCE: fixtureRoot,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Installed 1 skills into');
    expect(result.output).toContain(path.join('.codara', 'skills'));

    const installedSkill = path.join(projectRoot, '.codara', 'skills', 'skill-creator', 'SKILL.md');
    const content = await readFile(installedSkill, 'utf8');
    expect(content).toContain('name: skill-creator');
  });
});
