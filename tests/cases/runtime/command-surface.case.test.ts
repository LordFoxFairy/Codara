import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'bun:test';
import {runRealCliCase} from '../helpers/real-cli';

describe('runtime command surface cases', () => {
  it('should render paginated help through the real CLI path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-help-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const firstPage = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/help',
      scenario: 'command-surface',
    });

    expect(firstPage.exitCode).toBe(0);
    expect(firstPage.output).toContain('Codara commands (page 1/2)');
    expect(firstPage.output).toContain('Run /help 2 for more commands.');
    expect(firstPage.output).toContain('Built-in commands:');

    const secondPage = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/help 2',
      scenario: 'command-surface',
    });

    expect(secondPage.exitCode).toBe(0);
    expect(secondPage.output).toContain('Codara commands (page 2/2)');
    expect(secondPage.output).toContain('/reload');
  });

  it('should render runtime status through the real CLI path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-status-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/status',
      scenario: 'command-surface',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Runtime status:');
    expect(result.output).toContain('session_status: ready');
    expect(result.output).toContain('permissions:');
  });

  it('should route /permissions edit through the CLI host open_file handling', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permissions-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/permissions edit',
      scenario: 'command-surface',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Open file:');
    expect(result.output).toContain(path.join('.codara', 'settings.local.json'));
  });

  it('should clear the active conversation through the real CLI path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-clear-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/clear',
      scenario: 'command-surface',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Conversation cleared. Session is ready for a new prompt.');
  });

  it('should show skill command runtime requirements through the real CLI help path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-help-skill-cli-'));
    const projectRoot = path.join(root, 'project');
    const skillDir = path.join(projectRoot, '.codara', 'skills', 'code-review-code-review');

    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: code-review-code-review
description: Review a pull request with multiple agents.
command-name: code-review
allowed-tools:
  - Bash(gh pr view:*)
  - read_file
---
# Code Review
`, 'utf8');

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/help code-review',
      scenario: 'command-surface-skill-help',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Type: skill command');
    expect(result.output).toContain('Execution: agent workflow');
    expect(result.output).toContain('Scope: project');
    expect(result.output).toContain('Allowed tools: Bash(gh pr view:*), read_file');
    expect(result.output).toContain('Required shell commands: gh');
    expect(result.output).toContain('Runtime requirement: run this command in a Codara runtime');
  });
});
