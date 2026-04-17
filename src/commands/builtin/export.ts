import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {BaseMessage} from '@langchain/core/messages';
import type {CodaraCommandDefinition} from '@commands/runtime/types';
import {BUILTIN_SOURCE} from './formatters';

/**
 * Sanitise a string for use as a filename: lowercase, alphanumeric + hyphens only.
 */
function sanitizeFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}-${h}${mi}${s}`;
}

function extractFirstHumanText(messages: readonly BaseMessage[]): string {
  for (const msg of messages) {
    if (msg.getType() === 'human') {
      const text = msg.text.trim();
      if (text) {
        const firstLine = text.split('\n')[0] ?? '';
        return firstLine.length > 50 ? `${firstLine.substring(0, 49)}…` : firstLine;
      }
    }
  }
  return '';
}

/** Render messages as human-readable Markdown. */
function renderMarkdown(messages: readonly BaseMessage[], sessionId: string): string {
  const lines: string[] = [
    `# Codara conversation — ${sessionId}`,
    '',
  ];

  for (const msg of messages) {
    const role = msg.getType();
    const text = msg.text.trim();
    if (!text) continue;

    switch (role) {
      case 'human':
        lines.push(`## User\n\n${text}\n`);
        break;
      case 'ai':
        lines.push(`## Assistant\n\n${text}\n`);
        break;
      case 'tool':
        lines.push(`## Tool\n\n\`\`\`\n${text}\n\`\`\`\n`);
        break;
      case 'system':
        lines.push(`## System\n\n${text}\n`);
        break;
      default:
        lines.push(`## ${role}\n\n${text}\n`);
        break;
    }
  }

  return lines.join('\n');
}

/** Render messages as a JSON array. */
function renderJson(messages: readonly BaseMessage[], sessionId: string): string {
  const entries = messages.map((msg) => ({
    role: msg.getType(),
    content: msg.text,
  }));

  return JSON.stringify({sessionId, messages: entries}, null, 2);
}

function generateDefaultFilename(messages: readonly BaseMessage[]): string {
  const timestamp = formatTimestamp(new Date());
  const firstPrompt = extractFirstHumanText(messages);
  if (firstPrompt) {
    const sanitized = sanitizeFilename(firstPrompt);
    return sanitized ? `${timestamp}-${sanitized}.md` : `conversation-${timestamp}.md`;
  }
  return `conversation-${timestamp}.md`;
}

export const exportCommand: CodaraCommandDefinition = {
  name: 'export',
  usage: '/export [json] [<path>]',
  description: 'Export the current conversation to a file.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, agent, environment}) {
    const state = await agent.hydrate();
    const messages = state.messages;

    if (messages.length === 0) {
      return {
        ok: false,
        command: command.name,
        output: 'Nothing to export — the conversation is empty.',
      };
    }

    const session = agent.getState();
    const args = command.args;
    let format: 'markdown' | 'json' = 'markdown';
    let targetPath: string | undefined;

    // Parse arguments: /export [json] [<path>]
    for (const arg of args) {
      if (arg === 'json') {
        format = 'json';
      } else {
        targetPath = arg;
      }
    }

    const content = format === 'json'
      ? renderJson(messages, session.sessionId)
      : renderMarkdown(messages, session.sessionId);

    const ext = format === 'json' ? '.json' : '.md';

    // Determine output path
    if (!targetPath) {
      const baseName = generateDefaultFilename(messages);
      const finalName = format === 'json'
        ? baseName.replace(/\.md$/, '.json')
        : baseName;
      targetPath = path.resolve(environment.cwd ?? process.cwd(), finalName);
    } else {
      // Ensure extension matches format
      if (!targetPath.endsWith(ext)) {
        targetPath = targetPath.replace(/\.[^.]+$/, '') + ext;
      }
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.resolve(environment.cwd ?? process.cwd(), targetPath);
      }
    }

    try {
      await writeFile(targetPath, content, 'utf-8');
      return {
        ok: true,
        command: command.name,
        output: `Conversation exported to: ${targetPath}`,
      };
    } catch (error) {
      return {
        ok: false,
        command: command.name,
        output: `Failed to export conversation: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
