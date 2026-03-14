import {describe, expect, it} from 'bun:test';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {runRealCliCase} from '../helpers/real-cli';

describe('case: runtime permission default ask', () => {
  it('should ask by default for guarded bash commands in the real CLI and persist always-allow for the next runtime session', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-runtime-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run touch guarded.txt',
      scenario: 'runtime-permission',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'always',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('RUNTIME_PERMISSION_DONE');
    expect(first.output).not.toContain('HIL action:');

    const settingsFile = path.join(codaraPath, 'settings.local.json');
    expect(existsSync(settingsFile)).toBeTrue();
    const settings = JSON.parse(await readFile(settingsFile, 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(settings.permissions?.rules?.allow).toContain('Bash(touch guarded.txt)');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run touch guarded.txt again',
      scenario: 'runtime-permission',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('RUNTIME_PERMISSION_DONE');
    expect(second.output).not.toContain('HIL Review');
    expect(second.output).not.toContain('HIL action:');
  });

  it('should allow read-only bash inspection commands without HIL by default', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-runtime-read-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run git status',
      scenario: 'runtime-git-status',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('RUNTIME_GIT_STATUS_DONE');
    expect(result.output).not.toContain('Permission Review');
    expect(result.output).not.toContain('HIL action:');
  });

  it('should allow wrapped read-only bash inspection commands through exact git rules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-runtime-read-wrapper-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run bash -lc "git status"',
      scenario: 'runtime-git-status-wrapper',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('RUNTIME_GIT_STATUS_WRAPPER_DONE');
    expect(result.output).not.toContain('Permission Review');
    expect(result.output).not.toContain('HIL action:');
  });

  it('should allow git subcommand rules even when the bash command uses global options', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-runtime-git-option-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});
    await writeFile(path.join(codaraPath, 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(git log *)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run git -C ./tmp/repo log --oneline',
      scenario: 'runtime-git-log-option',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('RUNTIME_GIT_LOG_OPTION_DONE');
    expect(result.output).not.toContain('Permission Review');
    expect(result.output).not.toContain('HIL action:');
  });

  it('should persist smarter git command-type approvals for compound bash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-runtime-git-compound-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run cd ./tmp/repo && git fetch origin && git push origin main',
      scenario: 'runtime-git-compound',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'allow_tool',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('RUNTIME_GIT_COMPOUND_DONE');
    expect(first.output).not.toContain('HIL action:');

    const settings = JSON.parse(await readFile(path.join(codaraPath, 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(settings.permissions?.rules?.allow).toContain('Bash(git *)');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run git push origin main',
      scenario: 'runtime-git-push',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('RUNTIME_GIT_PUSH_DONE');
    expect(second.output).not.toContain('Permission Review');
    expect(second.output).not.toContain('HIL action:');
  });

  it('should support trusting the whole project for later guarded commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-project-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run touch guarded.txt',
      scenario: 'runtime-permission',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'allow_project',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).not.toContain('HIL action:');
    const settings = JSON.parse(await readFile(path.join(codaraPath, 'settings.local.json'), 'utf8')) as {
      permissions?: {defaultDecision?: string};
    };
    expect(settings.permissions?.defaultDecision).toBe('allow');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run mkdir guarded-dir',
      scenario: 'runtime-permission-other',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('RUNTIME_PERMISSION_OTHER_DONE');
    expect(second.output).not.toContain('HIL Review');
  });

  it('should repair invalid settings.local.json on runtime startup through the real CLI path', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-runtime-repair-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});

    const settingsFile = path.join(codaraPath, 'settings.local.json');
    await writeFile(settingsFile, '{invalid-json', 'utf8');

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'repair permissions',
      scenario: 'runtime-permission-repair',
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('PERMISSION_REPAIR_DONE');
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      permissions: {
        rules: {
          allow: [
            'Read(*)',
            'Fetch(*)',
            'Search(*)',
            'Glob(*)',
            'Grep(*)',
            'Bash(git status)',
            'Bash(git diff *)',
            'Bash(git show *)',
            'Bash(git log *)',
            'Bash(git branch *)',
            'Bash(git rev-parse *)',
            'Bash(git ls-files *)',
            'Bash(ls *)',
            'Bash(pwd)',
            'Bash(cat *)',
            'Bash(head *)',
            'Bash(tail *)',
            'Bash(wc *)',
            'Bash(stat *)',
            'Bash(file *)',
            'Bash(find *)',
            'Bash(rg *)',
            'Bash(grep *)',
          ],
          ask: [],
          deny: [],
        },
      },
    });
  });

  it('should complete file-edit permission approvals without extra HIL action noise in the real CLI', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-write-cli-'));
    const projectRoot = path.join(root, 'project');
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});

    const result = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Write the plan file',
      scenario: 'runtime-write-permission',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'allow_once',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('Writing(tmp/demo2/PLAN.md)');
    expect(result.output).not.toContain('HIL action:');
    expect(result.output).toContain('RUNTIME_WRITE_PERMISSION_DONE');
  });

  it('should persist directory-scoped path approvals for bash mkdir commands and reuse them for sibling directories', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-mkdir-path-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run mkdir tmp/demo2',
      scenario: 'runtime-permission-mkdir-path',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'allow_path',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('RUNTIME_PERMISSION_MKDIR_PATH_DONE');
    expect(first.output).not.toContain('HIL action:');

    const settings = JSON.parse(await readFile(path.join(codaraPath, 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(settings.permissions?.rules?.allow).toContain('Write(tmp/)');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Run mkdir tmp/demo3',
      scenario: 'runtime-permission-mkdir-path-other',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('RUNTIME_PERMISSION_MKDIR_PATH_OTHER_DONE');
    expect(second.output).not.toContain('Permission Review');
  });

  it('should persist directory-scoped path approvals for heredoc redirection writes and reuse them for later sibling writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-case-permission-heredoc-path-cli-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    await mkdir(codaraPath, {recursive: true});

    const first = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Write the plan through a heredoc',
      scenario: 'runtime-permission-heredoc-path',
      env: {
        CODARA_CLI_HIL_AUTO_ACTIONS: 'allow_path',
      },
    });

    expect(first.exitCode).toBe(0);
    expect(first.output).toContain('RUNTIME_PERMISSION_HEREDOC_PATH_DONE');
    expect(first.output).not.toContain('HIL action:');

    const settings = JSON.parse(await readFile(path.join(codaraPath, 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(settings.permissions?.rules?.allow).toContain('Write(tmp/demo2/)');

    const second = await runRealCliCase({
      cwd: projectRoot,
      prompt: 'Touch another file under tmp/demo2',
      scenario: 'runtime-permission-heredoc-path-other',
    });

    expect(second.exitCode).toBe(0);
    expect(second.output).toContain('RUNTIME_PERMISSION_HEREDOC_PATH_OTHER_DONE');
    expect(second.output).not.toContain('Permission Review');
  });
});
