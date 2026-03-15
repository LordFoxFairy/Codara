import {clearCommand} from './clear';
import type {CodaraCommandDefinition} from '@core/commands/types';
import {compactCommand} from './compact';
import {helpCommand} from './help';
import {hooksCommand} from './hooks';
import {memoryCommand} from './memory';
import {permissionsCommand} from './permissions';
import {pluginCommand} from './plugin';
import {reloadCommand} from './reload';
import {resumeCommand} from './resume';
import {statusCommand} from './status';

export function createBuiltInCommands(): readonly CodaraCommandDefinition[] {
  return [
    helpCommand,
    clearCommand,
    statusCommand,
    memoryCommand,
    permissionsCommand,
    pluginCommand,
    resumeCommand,
    compactCommand,
    reloadCommand,
    hooksCommand,
  ];
}
