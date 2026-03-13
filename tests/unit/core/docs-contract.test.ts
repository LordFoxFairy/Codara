import {describe, expect, it} from 'bun:test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {createCodara} from '@core';
import type {BaseChatModel} from '@langchain/core/language_models/chat_models';
import {EchoModel} from './codara-fixtures';

const repoRoot = process.cwd();

describe('core docs contracts', () => {
  it('should keep README slash commands aligned with the builtin registry', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
    const codara = createCodara({
      model: new EchoModel() as unknown as BaseChatModel,
      skills: false,
      builtinTools: false,
    });

    const commandNames = (await codara.listCommands()).map((command) => `/${command.name}`);
    expect(commandNames).toEqual(['/help', '/memory', '/resume', '/compact', '/reload']);
    for (const command of commandNames) {
      expect(readme).toContain(command);
    }
  });

  it('should keep the documented tasking and architecture references pointed at real files', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
    const coreReadme = await readFile(path.join(repoRoot, 'src/core/README.md'), 'utf8');

    expect(readme).toContain('src/core/tasks');
    expect(readme).not.toContain('src/core/tasking');
    expect(coreReadme).toContain('src/core/tasks/README.md');
    expect(coreReadme).not.toContain('docs/subagent-task-architecture.md');
  });
});
