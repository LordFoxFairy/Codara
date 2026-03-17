import {clearCommand} from './clear';
import type {CodaraCommandDefinition} from '@capability/command/types';
import {compactCommand} from './compact';
import {configCommand} from './config';
import {contextCommand} from './context';
import {costCommand} from './cost';
import {diffCommand} from './diff';
import {helpCommand} from './help';
import {hooksCommand} from './hooks';
import {mcpCommand} from './mcp';
import {memoryCommand} from './memory';
import {modelCommand} from './model';
import {permissionsCommand} from './permissions';
import {pluginCommand} from './plugin';
import {reloadCommand} from './reload';
import {resumeCommand} from './resume';
import {rewindCommand} from './rewind';
import {statusCommand} from './status';
import {teamCommand} from './team';

export function createBuiltInCommands(): readonly CodaraCommandDefinition[] {
  return [
    helpCommand,
    clearCommand,
    statusCommand,
    modelCommand,
    memoryCommand,
    permissionsCommand,
    pluginCommand,
    resumeCommand,
    compactCommand,
    reloadCommand,
    hooksCommand,
    mcpCommand,
    costCommand,
    contextCommand,
    configCommand,
    diffCommand,
    rewindCommand,
    teamCommand,
  ];
}
