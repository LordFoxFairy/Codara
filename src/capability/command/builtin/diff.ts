import {execSync} from 'node:child_process';
import type {CodaraCommandDefinition} from '@capability/command/runtime/types';
import {BUILTIN_SOURCE} from './formatters';

export const diffCommand: CodaraCommandDefinition = {
  name: 'diff',
  usage: '/diff',
  description: 'Show all file changes made in this session (git diff).',
  source: BUILTIN_SOURCE,
  help: {executionMode: 'runtime_command'},
  async execute({command, environment}) {
    const cwd = environment.cwd ?? process.cwd();

    try {
      const staged = execSync('git diff --cached --stat', {cwd, stdio: 'pipe'}).toString().trim();
      const unstaged = execSync('git diff --stat', {cwd, stdio: 'pipe'}).toString().trim();
      const untracked = execSync('git ls-files --others --exclude-standard', {cwd, stdio: 'pipe'}).toString().trim();

      const sections: string[] = [];

      if (staged) {
        sections.push('Staged changes:\n' + staged);
      }
      if (unstaged) {
        sections.push('Unstaged changes:\n' + unstaged);
      }
      if (untracked) {
        const files = untracked.split('\n').map(f => `  + ${f}`).join('\n');
        sections.push('Untracked files:\n' + files);
      }

      if (sections.length === 0) {
        return {ok: true, command: command.name, output: 'No changes detected.'};
      }

      return {ok: true, command: command.name, output: sections.join('\n\n')};
    } catch (err: unknown) {
      return {ok: false, command: command.name, output: `Git error: ${err instanceof Error ? err.message : String(err)}`};
    }
  },
};
