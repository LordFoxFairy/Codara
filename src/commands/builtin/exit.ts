import type {CodaraCommandDefinition} from '@commands/runtime/types';
import {BUILTIN_SOURCE} from './formatters';

const GOODBYE_MESSAGES = ['Goodbye!', 'See ya!', 'Bye!', 'Catch you later!'];

function getRandomGoodbyeMessage(): string {
  return GOODBYE_MESSAGES[Math.floor(Math.random() * GOODBYE_MESSAGES.length)] ?? 'Goodbye!';
}

export const exitCommand: CodaraCommandDefinition = {
  name: 'exit',
  usage: '/exit',
  description: 'Exit Codara.',
  aliases: ['quit'],
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'host_action',
  },
  execute({command}) {
    return {
      ok: true,
      command: command.name,
      output: getRandomGoodbyeMessage(),
      action: {
        type: 'exit',
      },
    };
  },
};
