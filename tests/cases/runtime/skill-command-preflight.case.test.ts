import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'bun:test';
import {runRealCliCase} from '../helpers/real-cli';

describe('runtime skill command preflight cases', () => {
  it('should stop a skill command in the real CLI when its required tool is unavailable', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-skill-preflight-tool-'));
    const projectRoot = path.join(root, 'project');
    const skillDir = path.join(projectRoot, '.codara', 'skills', 'shell-review');

    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: shell-review
description: Review shell output
command-name: shell-review
allowed-tools:
  - bash
---
# Shell Review
`, 'utf8');

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/shell-review inspect git history',
      scenario: 'skill-command-preflight-missing-tool',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Cannot run /shell-review in this runtime.');
    expect(result.output).toContain('Reason: the current runtime does not satisfy this skill command');
    expect(result.output).toContain('Missing runtime tools: bash');
    expect(result.output).toContain('Suggested fixes:');
  });

  it('should stop a skill command in the real CLI when a required shell binary is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-skill-preflight-binary-'));
    const projectRoot = path.join(root, 'project');
    const skillDir = path.join(projectRoot, '.codara', 'skills', 'repo-review');

    await mkdir(skillDir, {recursive: true});
    await writeFile(path.join(skillDir, 'SKILL.md'), `---
name: repo-review
description: Review repository state
command-name: repo-review
allowed-tools:
  - Bash(codara-missing-binary-please-do-not-install status)
---
# Repo Review
`, 'utf8');

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: '/repo-review inspect repository state',
      scenario: 'skill-command-preflight-missing-binary',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Cannot run /repo-review in this runtime.');
    expect(result.output).toContain('Missing shell commands in PATH:');
    expect(result.output).toContain('codara-missing-binary-please-do-not-install');
    expect(result.output).toContain('Suggested fixes:');
  });
});
