import {createCompactCommand} from '@core/codara/commands/compact';
import {createHelpCommand} from '@core/codara/commands/help';
import {createMemoryCommand} from '@core/codara/commands/memory';
import {createReloadCommand} from '@core/codara/commands/reload';
import {createResumeCommand} from '@core/codara/commands/resume';
import type {CodaraCommandDefinition} from '@core/codara/commands/types';

export function createBuiltInCodaraCommands(): CodaraCommandDefinition[] {
  return [
    createHelpCommand(),
    createMemoryCommand(),
    createResumeCommand(),
    createCompactCommand(),
    createReloadCommand(),
  ];
}
