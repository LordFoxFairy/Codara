import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {type ToolCall} from '@langchain/core/messages';
import {ensurePermissionSettingsFile, evaluatePermissionToolCall, persistPermissionScope} from '@/index';
import {formatPermissionPathScopeExpression} from '@engine/pipeline/permission/policy';

describe('permission policy defaults', () => {
  it('should seed the settings skeleton with common read-only allow rules', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-defaults-'));
    const result = ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const content = JSON.parse(await readFile(result.settingsFile, 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };

    expect(content.permissions?.rules?.allow).toContain('Read(*)');
    expect(content.permissions?.rules?.allow).toContain('Bash(git status)');
    expect(content.permissions?.rules?.allow).toContain('Bash(rg *)');
  });

  it('should allow read-oriented builtin tools from the default settings skeleton', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-read-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_read_default_1', name: 'read_file', args: {file_path: '/tmp/demo.ts'}};

    const evaluation = await evaluatePermissionToolCall(toolCall, {projectRoot, cwd: projectRoot});

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Read(*)');
  });

  it('should keep guarded bash commands at ask by default', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-guarded-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});
    const toolCall: ToolCall = {id: 'call_bash_guarded_1', name: 'bash', args: {command: 'touch guarded.txt'}};

    const evaluation = await evaluatePermissionToolCall(toolCall, {projectRoot, cwd: projectRoot});

    expect(evaluation?.decision).toBe('ask');
    expect(evaluation?.matched).toBeNull();
  });

  it('should match directory-scoped write rules against files inside that directory', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-path-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Write(tmp/demo2/)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_write_dir_rule', name: 'write_file', args: {file_path: 'tmp/demo2/PLAN.md', content: 'hello'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Write(tmp/demo2/)');
  });

  it('should match directory-scoped read rules when read_file uses args.path', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-read-path-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Read(docs/)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_read_dir_rule', name: 'read_file', args: {path: 'docs/guide.md'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Read(docs/)');
  });

  it('should match directory-scoped write rules for bash mkdir commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-dir-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Write(tmp/)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_dir_rule', name: 'bash', args: {command: 'mkdir tmp/demo2'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Write(tmp/)');
  });

  it('should derive a directory-scoped permission expression for file edits', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-path-scope-'));

    const expression = formatPermissionPathScopeExpression(
      {id: 'call_path_scope', name: 'write_file', args: {file_path: 'tmp/demo2/PLAN.md', content: 'hello'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(expression).toBe('Write(tmp/demo2/)');
  });

  it('should derive a directory-scoped permission expression for bash mkdir commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-path-scope-'));

    const expression = formatPermissionPathScopeExpression(
      {id: 'call_bash_path_scope', name: 'bash', args: {command: 'mkdir tmp/demo2'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(expression).toBe('Write(tmp/)');
  });

  it('should derive a directory-scoped permission expression for heredoc writes with redirection', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-heredoc-scope-'));

    const expression = formatPermissionPathScopeExpression(
      {
        id: 'call_bash_heredoc_scope',
        name: 'bash',
        args: {
          command: `cat <<'EOF' > tmp/demo2/PLAN.md\nhello\nEOF`,
        },
      },
      {projectRoot, cwd: projectRoot},
    );

    expect(expression).toBe('Write(tmp/demo2/)');
  });

  it('should avoid deriving path scope for complex bash commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-complex-'));

    const expression = formatPermissionPathScopeExpression(
      {id: 'call_bash_complex_scope', name: 'bash', args: {command: 'mkdir tmp/demo2 && touch tmp/demo2/a.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(expression).toBeUndefined();
  });

  it('should keep malformed heredoc bash commands conservative', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-heredoc-malformed-'));

    const expression = formatPermissionPathScopeExpression(
      {
        id: 'call_bash_heredoc_malformed',
        name: 'bash',
        args: {
          command: `cat <<'EOF' > tmp/demo2/PLAN.md\nhello`,
        },
      },
      {projectRoot, cwd: projectRoot},
    );

    expect(expression).toBeUndefined();
  });

  it('should persist command-type scope rules for bash approvals', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-tool-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope({id: 'call_tool_scope', name: 'bash', args: {command: 'touch guarded.txt'}}, 'tool', {
      projectRoot,
      cwd: projectRoot,
    });

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Bash(touch *)');
  });

  it('should persist project trust as permissions.defaultDecision=allow', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-project-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope({id: 'call_project_scope', name: 'bash', args: {command: 'touch guarded.txt'}}, 'project', {
      projectRoot,
      cwd: projectRoot,
    });

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {defaultDecision?: string};
    };
    expect(content.permissions?.defaultDecision).toBe('allow');
  });

  it('should persist path scope rules for file edits', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-path-persist-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope(
      {id: 'call_path_persist', name: 'write_file', args: {file_path: 'tmp/demo2/PLAN.md', content: 'hello'}},
      'path',
      {projectRoot, cwd: projectRoot},
    );

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Write(tmp/demo2/)');
  });

  it('should allow unmatched guarded commands when permissions.defaultDecision=allow', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-default-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: [
            'Bash(git status)',
            'Bash(touch guarded.txt)',
          ],
          ask: [],
          deny: [],
        },
        defaultDecision: 'allow',
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_default_allow', name: 'bash', args: {command: 'mkdir guarded-dir'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched).toBeNull();
    expect(evaluation?.defaultDecision).toBe('allow');
  });

  it('should still ask when an ask rule matches even if permissions.defaultDecision=allow', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-default-allow-ask-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(git status)'],
          ask: ['Bash(touch *)'],
          deny: [],
        },
        defaultDecision: 'allow',
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_default_allow_ask', name: 'bash', args: {command: 'touch guarded.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('ask');
    expect(evaluation?.matched?.bucket).toBe('ask');
    expect(evaluation?.matched?.rule).toBe('Bash(touch *)');
    expect(evaluation?.defaultDecision).toBe('allow');
  });

  it('should honor exact bash allow rules even when bash path fallback would otherwise ask by default', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-exact-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(touch guarded.txt)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_exact_allow', name: 'bash', args: {command: 'touch guarded.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(touch guarded.txt)');
  });

  it('should allow explicit bash rules for heredoc commands after stripping the heredoc body', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-heredoc-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(cat)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {
        id: 'call_bash_heredoc_allow',
        name: 'bash',
        args: {
          command: `cat <<'EOF' > tmp/demo2/PLAN.md\nhello\nEOF`,
        },
      },
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(cat)');
  });

  it('should still ask for heredoc write commands when only a broad bash command-type rule matches', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-heredoc-broad-rule-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(cat *)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {
        id: 'call_bash_heredoc_broad_rule',
        name: 'bash',
        args: {
          command: `cat <<'EOF' > tmp/demo2/PLAN.md\nhello\nEOF`,
        },
      },
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('ask');
    expect(evaluation?.matched).toBeNull();
  });

  it('should match exact bash allow rules when the command uses inline env wrappers', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-env-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(touch guarded.txt)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_env_allow', name: 'bash', args: {command: 'FOO=bar env BAZ=qux touch guarded.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(touch guarded.txt)');
  });

  it('should still ask for redirection writes when only a broad bash command-type rule matches', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-redirection-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(python *)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_redirection_allow', name: 'bash', args: {command: 'python script.py > output.txt 2>&1'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('ask');
    expect(evaluation?.matched).toBeNull();
  });

  it('should still honor explicit bash rules when the command only adds output redirections', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-redirection-explicit-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(python script.py)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_redirection_explicit_allow', name: 'bash', args: {command: 'python script.py > output.txt 2>&1'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(python script.py)');
  });

  it('should normalize git global options before matching bash allow rules', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-git-options-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(git log *)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_git_options_allow', name: 'bash', args: {command: 'git -C ./tmp/repo log --oneline'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(git log *)');
  });

  it('should normalize git global options when persisting command-type bash approvals', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-git-tool-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope(
      {id: 'call_bash_git_tool_scope', name: 'bash', args: {command: 'git -C ./tmp/repo log --oneline'}},
      'tool',
      {projectRoot, cwd: projectRoot},
    );

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Bash(git log *)');
  });

  it('should not let wildcard bash allow rules match compound commands with shell operators', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-compound-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(git *)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_compound_allow', name: 'bash', args: {command: 'git status && touch guarded.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('ask');
    expect(evaluation?.matched).toBeNull();
  });

  it('should match exact bash allow rules when the command uses backslash-newline continuation', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-continuation-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(touch guarded.txt)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_continuation_allow', name: 'bash', args: {command: 'touch \\\n  guarded.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(touch guarded.txt)');
  });

  it('should treat Bash(*) as an explicit allow for complex bash commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-any-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(*)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_any_allow', name: 'bash', args: {command: 'git status && touch guarded.txt'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(*)');
  });

  it('should match exact bash allow rules through shell launcher wrappers', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-wrapper-allow-'));
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
    await writeFile(path.join(projectRoot, '.codara', 'settings.local.json'), JSON.stringify({
      permissions: {
        rules: {
          allow: ['Bash(git status)'],
          ask: [],
          deny: [],
        },
      },
    }, null, 2));

    const evaluation = await evaluatePermissionToolCall(
      {id: 'call_bash_wrapper_allow', name: 'bash', args: {command: 'bash -lc "git status"'}},
      {projectRoot, cwd: projectRoot},
    );

    expect(evaluation?.decision).toBe('allow');
    expect(evaluation?.matched?.rule).toBe('Bash(git status)');
  });

  it('should persist a smarter tool-scope rule for compound git bash commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-git-compound-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope(
      {id: 'call_bash_git_compound_scope', name: 'bash', args: {command: 'cd ./tmp/repo && git fetch origin && git push origin main'}},
      'tool',
      {projectRoot, cwd: projectRoot},
    );

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Bash(git *)');
  });

  it('should persist smarter tool-scope rules for wrapped compound git bash commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-wrapper-compound-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope(
      {id: 'call_bash_wrapper_compound_scope', name: 'bash', args: {command: 'bash -lc "cd ./tmp/repo && git fetch origin && git push origin main"'}},
      'tool',
      {projectRoot, cwd: projectRoot},
    );

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Bash(git *)');
  });

  it('should persist subcommand-scoped rules for repeated npm compound commands', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'codara-permission-bash-npm-compound-scope-'));
    ensurePermissionSettingsFile({projectRoot, cwd: projectRoot});

    await persistPermissionScope(
      {id: 'call_bash_npm_compound_scope', name: 'bash', args: {command: 'npm install lodash && npm install react'}},
      'tool',
      {projectRoot, cwd: projectRoot},
    );

    const content = JSON.parse(await readFile(path.join(projectRoot, '.codara', 'settings.local.json'), 'utf8')) as {
      permissions?: {rules?: {allow?: string[]}};
    };
    expect(content.permissions?.rules?.allow).toContain('Bash(npm install *)');
  });
});
