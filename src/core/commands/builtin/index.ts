import type {CodaraCommandDefinition} from '@core/commands/types';
import {compactCommand} from './compact';
import {helpCommand} from './help';
import {reloadCommand} from './reload';
import {resumeCommand} from './resume';

export function createBuiltInCommands(): readonly CodaraCommandDefinition[] {
  return [
    helpCommand,
    resumeCommand,
    compactCommand,
    reloadCommand,
  ];
}
