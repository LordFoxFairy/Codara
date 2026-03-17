import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import type {BaseMessage} from '@langchain/core/messages';
import {createCodara, createCodaraRuntime} from '@/index';
import {EchoModel, SystemEchoModel} from './codara-fixtures';

const createRuntimeForTest = (options: Parameters<typeof createCodaraRuntime>[0]) => (
  createCodaraRuntime({
    ...options,
    autoMemory: false,
  })
);

describe('Codara slash commands', () => {
  function readSummaryMessage(messages: BaseMessage[]): BaseMessage | undefined {
    return messages.find((message) => message.type === 'ai' && message.text.startsWith('Summary:\n'));
  }

  it('should expose built-in slash command help', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/help');
    expect(result.ok).toBe(true);
    expect(result.output).toMatch(/Codara commands \(page 1\/\d+\)/);
    expect(result.output).toContain('Run /help <command> for details.');
    expect(result.output).toMatch(/Run \/help \d+ for more commands\./);
    expect(result.output).toContain('Built-in commands:');
    expect(result.output).toContain('/help');
    expect(result.output).toContain('/clear');
    expect(result.output).toContain('/model');
    expect(result.output).not.toContain('/compact');
    expect(result.output).not.toContain('/reload');

    const secondPage = await codara.executeCommand('/help 2');
    expect(secondPage.ok).toBe(true);
    expect(secondPage.output).toMatch(/Codara commands \(page 2\/\d+\)/);
    expect(secondPage.output).toContain('Built-in commands (continued):');
    expect(secondPage.output).toMatch(/Run \/help \d+ (for more commands|to go back)\./);


    const helpDetails = await codara.executeCommand('/help help');
    expect(helpDetails.ok).toBe(true);
    expect(helpDetails.output).toContain('/help');
    expect(helpDetails.output).toContain('Usage: /help [command|page]');
    expect(helpDetails.output).toContain('Type: built-in command');
    expect(helpDetails.output).toContain('Execution: runtime command');
    expect((await codara.listCommands()).map((command) => ({
      name: command.name,
      source: command.source.type,
    }))).toEqual([
      {name: 'help', source: 'builtin'},
      {name: 'clear', source: 'builtin'},
      {name: 'status', source: 'builtin'},
      {name: 'model', source: 'builtin'},
      {name: 'memory', source: 'builtin'},
      {name: 'permissions', source: 'builtin'},
      {name: 'plugin', source: 'builtin'},
      {name: 'resume', source: 'builtin'},
      {name: 'compact', source: 'builtin'},
      {name: 'reload', source: 'builtin'},
      {name: 'hooks', source: 'builtin'},
      {name: 'mcp', source: 'builtin'},
      {name: 'cost', source: 'builtin'},
      {name: 'context', source: 'builtin'},
      {name: 'config', source: 'builtin'},
      {name: 'diff', source: 'builtin'},
      {name: 'rewind', source: 'builtin'},
      {name: 'team', source: 'builtin'},
      {name: 'remote', source: 'builtin'},
      {name: 'serve', source: 'builtin'},
    ]);
  });

  it('should import supported Claude-style plugins by copying their skills into Codara skill sources', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-plugin-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'superpowers-fixture');
    const skillDir = path.join(fixtureRoot, 'skills', 'brainstorming');

    await mkdir(skillDir, {recursive: true});
    await Bun.write(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: brainstorming',
      'description: Facilitate better design brainstorming.',
      '---',
      '',
      '# Brainstorming',
      '',
      'Fixture skill.',
      '',
    ].join('\n'));

    const previousOverride = process.env.CODARA_PLUGIN_SUPERPOWERS_SOURCE;
    process.env.CODARA_PLUGIN_SUPERPOWERS_SOURCE = fixtureRoot;

    try {
      const codara = createCodara({
        cwd: projectRoot,
        projectRoot,
        userHome,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.executeCommand('/plugin install superpowers@claude-plugins-official');
      expect(result.ok).toBe(true);
      expect(result.output).toContain('Installed 1 skills');
      expect(result.output).toContain('brainstorming');

      const installed = await readFile(path.join(userHome, '.codara', 'skills', 'brainstorming', 'SKILL.md'), 'utf8');
      expect(installed).toContain('name: brainstorming');
    } finally {
      if (previousOverride === undefined) {
        delete process.env.CODARA_PLUGIN_SUPERPOWERS_SOURCE;
      } else {
        process.env.CODARA_PLUGIN_SUPERPOWERS_SOURCE = previousOverride;
      }
    }
  });

  it('should import official skill plugins that already ship Codara-compatible skills', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-plugin-skill-creator-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'skill-creator-fixture');
    const skillDir = path.join(fixtureRoot, 'skills', 'skill-creator');

    await mkdir(skillDir, {recursive: true});
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

    const previousOverride = process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE;
    process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE = fixtureRoot;

    try {
      const codara = createCodara({
        cwd: projectRoot,
        projectRoot,
        userHome,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.executeCommand('/plugin install skill-creator@claude-plugins-official');
      expect(result.ok).toBe(true);
      expect(result.output).toContain('skill-creator');

      const installed = await readFile(path.join(userHome, '.codara', 'skills', 'skill-creator', 'SKILL.md'), 'utf8');
      expect(installed).toContain('name: skill-creator');
    } finally {
      if (previousOverride === undefined) {
        delete process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE;
      } else {
        process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE = previousOverride;
      }
    }
  });

  it('should install plugins into the project when .codara/settings.json sets plugins.installGlobal=false', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-plugin-project-scope-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'skill-creator-fixture');
    const skillDir = path.join(fixtureRoot, 'skills', 'skill-creator');

    await mkdir(skillDir, {recursive: true});
    await mkdir(path.join(projectRoot, '.codara'), {recursive: true});
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

    const previousOverride = process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE;
    process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE = fixtureRoot;

    try {
      const codara = createCodara({
        cwd: projectRoot,
        projectRoot,
        userHome,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.executeCommand('/plugin install skill-creator@claude-plugins-official');
      expect(result.ok).toBe(true);
      expect(result.output).toContain(path.join(projectRoot, '.codara', 'skills'));

      const installed = await readFile(path.join(projectRoot, '.codara', 'skills', 'skill-creator', 'SKILL.md'), 'utf8');
      expect(installed).toContain('name: skill-creator');
    } finally {
      if (previousOverride === undefined) {
        delete process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE;
      } else {
        process.env.CODARA_PLUGIN_SKILL_CREATOR_SOURCE = previousOverride;
      }
    }
  });

  it('should translate supported plugin commands into Codara skill commands when the plugin ships commands without skills', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-plugin-command-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const fixtureRoot = path.join(root, 'code-review-fixture');
    const commandDir = path.join(fixtureRoot, 'commands');

    await mkdir(commandDir, {recursive: true});
    await Bun.write(path.join(commandDir, 'code-review.md'), [
      '---',
      'description: Review a pull request with multiple agents.',
      'allowed-tools: Bash(gh pr view:*)',
      '---',
      '',
      'Provide a code review for the current pull request.',
      '',
    ].join('\n'));

    const previousOverride = process.env.CODARA_PLUGIN_CODE_REVIEW_SOURCE;
    process.env.CODARA_PLUGIN_CODE_REVIEW_SOURCE = fixtureRoot;

    try {
      const codara = createCodara({
        cwd: projectRoot,
        projectRoot,
        userHome,
        model: new EchoModel() as unknown as BaseChatModel,
        skills: false,
        builtinTools: false,
      });

      const result = await codara.executeCommand('/plugin install code-review@claude-plugins-official');
      expect(result.ok).toBe(true);
      expect(result.output).toContain('code-review-code-review');

      const installed = await readFile(path.join(userHome, '.codara', 'skills', 'code-review-code-review', 'SKILL.md'), 'utf8');
      expect(installed).toContain('command-name: code-review');
      expect(installed).toContain('Provide a code review for the current pull request.');

      const runtime = createCodara({
        cwd: projectRoot,
        projectRoot,
        userHome,
        model: new EchoModel() as unknown as BaseChatModel,
        builtinTools: false,
      });

      const help = await runtime.executeCommand('/help code-review');
      expect(help.ok).toBe(true);
      expect(help.output).toContain('Type: skill command');
      expect(help.output).toContain('Execution: agent workflow');
      expect(help.output).toContain('Scope: global');
      expect(help.output).toContain('Allowed tools: Bash(gh pr view:*)');
      expect(help.output).toContain('Required shell commands: gh');
      expect(help.output).toContain('Skill: code-review-code-review');
      expect(help.output).toContain('Runtime requirement: run this command in a Codara runtime that exposes the listed tools.');
    } finally {
      if (previousOverride === undefined) {
        delete process.env.CODARA_PLUGIN_CODE_REVIEW_SOURCE;
      } else {
        process.env.CODARA_PLUGIN_CODE_REVIEW_SOURCE = previousOverride;
      }
    }
  });

  it('should report the current runtime status through slash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-status-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const codara = createCodara({
      cwd: projectRoot,
      projectRoot,
      userHome,
      alias: 'sonnet',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('status me');

    const result = await codara.executeCommand('/status');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Runtime status:');
    expect(result.output).toContain('model: sonnet');
    expect(result.output).toContain('session_status: ready');
    expect(result.output).toContain('project_memory:');
    expect(result.output).toContain('permissions:');
  });

  it('should expose project and global memory targets through slash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-memory-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const codara = createCodara({
      cwd: projectRoot,
      projectRoot,
      userHome,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const show = await codara.executeCommand('/memory show');
    expect(show.ok).toBe(true);
    expect(show.output).toContain(path.join(projectRoot, 'AGENTS.md'));
    expect(show.output).toContain(path.join(userHome, '.codara', 'AGENTS.md'));

    const project = await codara.executeCommand('/memory project');
    expect(project.action).toEqual({
      type: 'open_file',
      path: path.join(projectRoot, 'AGENTS.md'),
    });

    const global = await codara.executeCommand('/memory global');
    expect(global.action).toEqual({
      type: 'open_file',
      path: path.join(userHome, '.codara', 'AGENTS.md'),
    });
  });

  it('should reload session sources through slash commands without touching createAgent', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });
    const events: string[] = [];
    codara.subscribeRuntimeEvents((event) => {
      if (event.kind === 'command') {
        events.push(`${event.phase}:${event.status}:${event.label}`);
      }
    });

    const result = await codara.executeCommand('/reload');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('AGENTS.md');
    expect(events.some((entry) => entry.includes('start:running:Running /reload'))).toBe(true);
    expect(events.some((entry) => entry.includes('end:done:Completed /reload'))).toBe(true);
  });

  it('should expose permission policy files through slash commands', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-permissions-'));
    const projectRoot = path.join(root, 'project');
    const userHome = path.join(root, 'home');
    const codara = createCodara({
      cwd: projectRoot,
      projectRoot,
      userHome,
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const show = await codara.executeCommand('/permissions show');
    expect(show.ok).toBe(true);
    expect(show.output).toContain('Permission policy sources:');
    expect(show.output).toContain(path.join(projectRoot, '.codara', 'settings.local.json'));

    const edit = await codara.executeCommand('/permissions edit');
    expect(edit.action).toEqual({
      type: 'open_file',
      path: path.join(projectRoot, '.codara', 'settings.local.json'),
    });
  });

  it('should clear the current conversation through slash commands', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    await codara.invoke('one');
    expect(codara.getState().metadata?.messageCount).toBeGreaterThan(0);

    const result = await codara.executeCommand('/clear');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Conversation cleared');
    expect(codara.getState().metadata?.messageCount).toBe(0);
  });

  it('should compact the current conversation through the session-owned compact path', async () => {
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        summarize: () => 'manual compact summary',
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('Conversation context compacted');
    expect(readSummaryMessage(result.state?.messages ?? [])?.text).toBe('Summary:\nmanual compact summary');
  });

  it('should pass custom compact instructions into the summary middleware path', async () => {
    let seenInstructions: string | undefined;
    const codara = createCodara({
      model: new SystemEchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
      summary: {
        summarize: ({instructions}) => {
          seenInstructions = instructions;
          return 'manual compact summary';
        },
      },
    });

    await codara.invoke('one');
    await codara.invoke('two');
    await codara.invoke('three');

    const result = await codara.executeCommand('/compact focus on decisions and pending risks');

    expect(result.ok).toBe(true);
    expect(seenInstructions).toBe('focus on decisions and pending risks');
  });

  it('should compact checkpoint history through the slash command agent surface', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/compact checkpoints 5');

    expect(result.ok).toBe(true);
    expect(result.output).toContain('latest 5 snapshots');
  });

  it('should return a clear error for unknown slash commands', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/missing');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Unknown command');
  });

  it('should return a resume_session action for a target stored session id', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'codara-command-resume-'));
    const projectRoot = path.join(root, 'project');
    const codaraPath = path.join(projectRoot, '.codara');
    const current = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      codaraPath,
      sessionId: 'current-session',
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });
    const target = await createRuntimeForTest({
      cwd: projectRoot,
      projectRoot,
      codaraPath,
      sessionId: 'resume-target-session',
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: false,
    });

    await current.invoke('current');
    await target.invoke('target');

    const result = await current.executeCommand('/resume resume-target-session');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('resume-target-session');
    expect(result.action).toEqual({
      type: 'resume_session',
      sessionId: 'resume-target-session',
    });
  });

  it('should show session picker when /resume is called without args', async () => {
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/resume');
    expect(result.ok).toBe(true);
    expect(result.action).toEqual({type: 'show_session_picker'});
  });

  it('should report when /resume targets the current session', async () => {
    const codara = createCodara({
      sessionId: 'same-session',
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const result = await codara.executeCommand('/resume same-session');
    expect(result.ok).toBe(true);
    expect(result.output).toContain('Already using session same-session.');
    expect(result.action).toEqual({
      type: 'resume_session',
      sessionId: 'same-session',
    });
  });
});
