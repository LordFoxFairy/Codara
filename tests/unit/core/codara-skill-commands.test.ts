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
    expect(help.output).toContain('Source: skill "architect"');

    const result = await codara.executeCommand('/arch design a safer session model');
    expect(result.ok).toBe(true);
    expect(result.output).toBe('seen_humans:1');
    expect(result.state?.messages.some((message) => String(message.content).includes('design a safer session model'))).toBe(true);
  });

  it('should refresh skill-derived commands when host sources are reloaded', async () => {
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
