import {createCodara} from '../../index';
import type {Codara} from '../../index';
import type {CliMessage, CliRole} from '../state/shell-types';
export {
  extractMessageChunk,
  isSlashCommandPrompt,
  normalizeUserInput,
  renderChunkContent,
} from './chunk-helpers';
import {isSlashCommandPrompt} from './chunk-helpers';

export const THREAD_ID = 'cli-dev';
export const VISIBLE_MESSAGE_LIMIT = 12;
export const STARTUP_MESSAGE =
  'Interactive Codara CLI. Type a prompt or slash command and press Enter. Press Ctrl+C or Esc to exit.';

export function createCliSession(): Codara {
  return createCodara({threadId: THREAD_ID});
}

export function createCliMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStartupMessage(): CliMessage {
  return {
    id: createCliMessageId('system'),
    role: 'system',
    content: STARTUP_MESSAGE,
  };
}

export function createAssistantPlaceholder(prompt: string): CliMessage {
  const role: CliRole = isSlashCommandPrompt(prompt) ? 'system' : 'assistant';
  return {
    id: createCliMessageId(role),
    role,
    content: '',
  };
}
