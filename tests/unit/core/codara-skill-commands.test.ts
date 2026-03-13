import {describe, expect, it} from 'bun:test';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {createCodara} from '@core';
import {EchoModel} from './codara-fixtures';

describe('Codara skill commands', () => {
  it('should expose skill-defined slash commands from the same skills runtime sources', async () => {
    const skillsRoot = await createSkillRoot('architect', `---
name: architect
description: Architecture planning skill
command-name: architect
command-description: Run the architecture planning skill explicitly.
command-aliases:
  - arch
---
# Architect Skill
`);

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: {
        sources: [skillsRoot],
        cacheTtlMs: 0,
      },
    });

    const commands = await codara.listCommands();
    expect(commands.map((command) => command.name)).toContain('architect');
    expect(commands.find((command) => command.name === 'architect')?.source).toEqual({
      type: 'skill',
      skillName: 'architect',
      skillPath: path.join(skillsRoot, 'architect', 'SKILL.md'),
    });

    const help = await codara.executeCommand('/help architect');
    expect(help.ok).toBe(true);
    expect(help.output).toContain('Run the architecture planning skill explicitly.');
    expect(help.output).toContain('Aliases: /arch');
    expect(help.output).toContain('Type: skill command');
    expect(help.output).toContain('Skill: architect');

    const result = await codara.executeCommand('/arch design a safer session model');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('seen_humans:1');
    expect(result.state?.messages.some((message) => String(message.content).includes('design a safer session model'))).toBe(true);
  });

  it('should refuse to run a skill command when required tools are unavailable', async () => {
    const skillsRoot = await createSkillRoot('shell-review', `---
name: shell-review
description: Review shell output
command-name: shell-review
allowed-tools:
  - bash
---
# Shell Review
`);

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: {
        sources: [skillsRoot],
        cacheTtlMs: 0,
      },
    });

    const result = await codara.executeCommand('/shell-review inspect git history');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Cannot run /shell-review in this runtime.');
    expect(result.output).toContain('Missing tools: bash');
  });

  it('should refuse to run a skill command when a required shell binary is missing', async () => {
    const skillsRoot = await createSkillRoot('repo-review', `---
name: repo-review
description: Review repository state
command-name: repo-review
allowed-tools:
  - Bash(codara-missing-binary-please-do-not-install status)
---
# Repo Review
`);

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: {
        sources: [skillsRoot],
        cacheTtlMs: 0,
      },
    });

    const result = await codara.executeCommand('/repo-review inspect repository state');
    expect(result.ok).toBe(false);
    expect(result.output).toContain('Cannot run /repo-review in this runtime.');
    expect(result.output).toContain('Missing shell commands in PATH: codara-missing-binary-please-do-not-install');
  });

  it('should refresh skill-derived commands when session sources are reloaded', async () => {
    const skillsRoot = await createSkillRoot('architect', `---
name: architect
description: Architecture planning skill
command-name: architect
---
# Architect Skill
`);
    const skillFile = path.join(skillsRoot, 'architect', 'SKILL.md');

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: {
        sources: [skillsRoot],
      },
    });

    expect((await codara.listCommands()).map((command) => command.name)).toContain('architect');

    await writeFile(skillFile, `---
name: architect
description: Architecture planning skill
command-name: design
---
# Architect Skill
`, 'utf8');

    await codara.reloadSources();

    const commandNames = (await codara.listCommands()).map((command) => command.name);
    expect(commandNames).toContain('design');
    expect(commandNames).not.toContain('architect');
  });

  it('should keep skill-derived commands stable until reloadSources is called', async () => {
    const skillsRoot = await createSkillRoot('architect', `---
name: architect
description: Architecture planning skill
command-name: architect
---
# Architect Skill
`);
    const skillFile = path.join(skillsRoot, 'architect', 'SKILL.md');

    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      builtinTools: false,
      skills: {
        sources: [skillsRoot],
        cacheTtlMs: 0,
      },
    });

    expect((await codara.listCommands()).map((command) => command.name)).toContain('architect');

    await writeFile(skillFile, `---
name: architect
description: Architecture planning skill
command-name: design
---
# Architect Skill
`, 'utf8');

    const commandNamesBeforeReload = (await codara.listCommands()).map((command) => command.name);
    expect(commandNamesBeforeReload).toContain('architect');
    expect(commandNamesBeforeReload).not.toContain('design');

    await codara.reloadSources();

    const commandNamesAfterReload = (await codara.listCommands()).map((command) => command.name);
    expect(commandNamesAfterReload).toContain('design');
    expect(commandNamesAfterReload).not.toContain('architect');
  });
});

async function createSkillRoot(skillName: string, content: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'codara-skill-command-'));
  const skillDir = path.join(root, skillName);
  await mkdir(skillDir, {recursive: true});
  await writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
  return root;
}
