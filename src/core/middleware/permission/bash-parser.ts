import path from 'node:path';

export interface NormalizedBashCommand {
  tokens: string[];
  commandName: string;
  args: string[];
  specifier: string;
  complex: boolean;
  hasRedirection: boolean;
}

interface PreparedShellCommand {
  command: string;
  complex: boolean;
}

interface ParsedHeredocMarker {
  before: string;
  after: string;
  delimiter: string;
  allowTabs: boolean;
}

export const SHELL_LAUNCHER_COMMANDS = new Set(['bash', 'sh', 'zsh']);

export function prepareShellCommand(command: string): PreparedShellCommand {
  if (!command.trim()) {
    return {command: '', complex: true};
  }

  const withoutContinuations = command.replace(/\\\n[ \t]*/g, ' ');
  const stripped = stripShellHeredocBodies(withoutContinuations);
  if (!stripped) {
    return {command: '', complex: true};
  }

  return {
    command: stripped,
    complex: false,
  };
}

function stripShellHeredocBodies(command: string): string | undefined {
  const lines = command.split('\n');
  const output: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const markerIndex = findHeredocMarkerIndex(line);
    if (markerIndex < 0) {
      output.push(line);
      continue;
    }

    const marker = parseHeredocMarker(line, markerIndex);
    if (!marker || findHeredocMarkerIndex(marker.after) >= 0) {
      return undefined;
    }

    let terminatorIndex = lineIndex + 1;
    let foundTerminator = false;
    while (terminatorIndex < lines.length) {
      const candidate = marker.allowTabs
        ? (lines[terminatorIndex] ?? '').replace(/^\t+/, '')
        : (lines[terminatorIndex] ?? '');
      if (candidate === marker.delimiter) {
        foundTerminator = true;
        break;
      }
      terminatorIndex += 1;
    }

    if (!foundTerminator) {
      return undefined;
    }

    output.push(`${marker.before}${marker.after}`.trimEnd());
    lineIndex = terminatorIndex;
  }

  return output.join('\n');
}

function findHeredocMarkerIndex(line: string): number {
  let quote: '"' | '\'' | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (character === '\\' && quote === '"' && index + 1 < line.length) {
        index += 1;
      }
      continue;
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (character === '<' && line[index + 1] === '<') {
      return index;
    }
  }

  return -1;
}

function parseHeredocMarker(line: string, markerIndex: number): ParsedHeredocMarker | undefined {
  let index = markerIndex + 2;
  let allowTabs = false;

  if (line[index] === '-') {
    allowTabs = true;
    index += 1;
  }

  if (line[index] === '<' || line[index] === '(') {
    return undefined;
  }

  while (line[index] === ' ' || line[index] === '\t') {
    index += 1;
  }

  if (index >= line.length) {
    return undefined;
  }

  let delimiter = '';
  if (line[index] === '"' || line[index] === '\'') {
    const quote = line[index];
    index += 1;
    const end = line.indexOf(quote, index);
    if (end < 0) {
      return undefined;
    }
    delimiter = line.slice(index, end);
    index = end + 1;
  } else {
    const start = index;
    while (index < line.length && !/[\s;|&<>]/.test(line[index] ?? '')) {
      index += 1;
    }
    delimiter = line.slice(start, index);
  }

  if (!delimiter) {
    return undefined;
  }

  return {
    before: line.slice(0, markerIndex),
    after: line.slice(index),
    delimiter,
    allowTabs,
  };
}

export function tokenizeShellCommand(command: string): {tokens: string[]; complex: boolean} {
  const prepared = prepareShellCommand(command);
  if (prepared.complex || !prepared.command.trim()) {
    return {tokens: [], complex: true};
  }

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;

  for (let index = 0; index < prepared.command.length; index += 1) {
    const character = prepared.command[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }

      if (character === '\\' && quote === '"' && index + 1 < prepared.command.length) {
        current += prepared.command[index + 1];
        index += 1;
        continue;
      }

      current += character;
      continue;
    }

    if (character === '`') {
      return {tokens: [], complex: true};
    }

    if (character === '$' && prepared.command[index + 1] === '(') {
      return {tokens: [], complex: true};
    }

    if (character === ';') {
      return {tokens: [], complex: true};
    }

    if (
      character === '|'
      || (character === '&' && prepared.command[index - 1] !== '>' && prepared.command[index + 1] !== '>')
    ) {
      return {tokens: [], complex: true};
    }

    if (character === '<' && prepared.command[index + 1] === '(') {
      return {tokens: [], complex: true};
    }

    if (character === '>' && prepared.command[index + 1] === '(') {
      return {tokens: [], complex: true};
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (character === '\\' && index + 1 < prepared.command.length) {
      current += prepared.command[index + 1];
      index += 1;
      continue;
    }

    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += character;
  }

  if (quote) {
    return {tokens: [], complex: true};
  }

  if (current) {
    tokens.push(current);
  }

  return {
    tokens,
    complex: false,
  };
}

export function stripLeadingShellEnvironment(tokens: string[]): string[] {
  let index = 0;
  while (index < tokens.length && isShellEnvAssignment(tokens[index])) {
    index += 1;
  }

  if (tokens[index] === 'env') {
    index += 1;
    while (index < tokens.length && isShellEnvAssignment(tokens[index])) {
      index += 1;
    }
  }

  return tokens.slice(index);
}

export function stripShellRedirections(tokens: string[]): {tokens: string[]; hasRedirection: boolean} {
  const normalized: string[] = [];
  let hasRedirection = false;
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (isStandaloneShellRedirection(token)) {
      hasRedirection = true;
      skipNext = true;
      continue;
    }

    if (isInlineShellRedirection(token)) {
      hasRedirection = true;
      continue;
    }

    normalized.push(token);
  }

  return {tokens: normalized, hasRedirection};
}

export function unwrapShellLauncherCommand(tokens: string[]): string | undefined {
  const commandName = path.basename(tokens[0] ?? '').trim();
  const normalized = commandName.toLowerCase();
  if (!SHELL_LAUNCHER_COMMANDS.has(normalized)) {
    return undefined;
  }

  const args = tokens.slice(1);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index]?.trim();
    if (!token) {
      continue;
    }

    if (token === '--') {
      break;
    }

    if (!token.startsWith('-')) {
      break;
    }

    if (token === '-c' || token === '-lc' || token === '-cl') {
      const inlineValue = args[index + 1]?.trim();
      if (!inlineValue) {
        return undefined;
      }

      return inlineValue;
    }
  }

  return undefined;
}

export function normalizeBashCommandTokens(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return [];
  }

  const commandName = path.basename(tokens[0] ?? '').trim();
  const args = tokens.slice(1);
  if (!commandName) {
    return [];
  }

  if (commandName.toLowerCase() === 'git') {
    return [commandName, ...normalizeGitArgs(args)];
  }

  return [commandName, ...args];
}

function normalizeGitArgs(args: string[]): string[] {
  const normalized: string[] = [];
  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (!token) {
      index += 1;
      continue;
    }

    if (token === '--') {
      normalized.push(...args.slice(index + 1));
      break;
    }

    if (!token.startsWith('-')) {
      normalized.push(...args.slice(index));
      break;
    }

    index += 1 + gitGlobalOptionValueArity(token);
  }

  return normalized;
}

function gitGlobalOptionValueArity(token: string): number {
  if (
    token === '-C'
    || token === '-c'
    || token === '--git-dir'
    || token === '--work-tree'
    || token === '--namespace'
    || token === '--super-prefix'
    || token === '--exec-path'
    || token === '--config-env'
  ) {
    return 1;
  }

  if (/^--(?:git-dir|work-tree|namespace|super-prefix|exec-path|config-env)=/.test(token)) {
    return 0;
  }

  return 0;
}

export function splitCompoundShellCommands(command: string): string[] {
  const prepared = prepareShellCommand(command);
  if (prepared.complex || !prepared.command.trim()) {
    return [];
  }

  const segments: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;

  for (let index = 0; index < prepared.command.length; index += 1) {
    const character = prepared.command[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        current += character;
        continue;
      }

      if (character === '\\' && quote === '"' && index + 1 < prepared.command.length) {
        current += character;
        current += prepared.command[index + 1];
        index += 1;
        continue;
      }

      current += character;
      continue;
    }

    if (character === '`') {
      return [];
    }

    if (character === '$' && prepared.command[index + 1] === '(') {
      return [];
    }

    if (character === '<' && prepared.command[index + 1] === '(') {
      return [];
    }

    if (character === '>' && prepared.command[index + 1] === '(') {
      return [];
    }

    if (character === '"' || character === '\'') {
      quote = character;
      current += character;
      continue;
    }

    if (character === '\\' && index + 1 < prepared.command.length) {
      current += character;
      current += prepared.command[index + 1];
      index += 1;
      continue;
    }

    if (character === ';' || character === '\n') {
      pushShellSegment(segments, current);
      current = '';
      continue;
    }

    if (character === '&') {
      if (prepared.command[index + 1] === '&') {
        pushShellSegment(segments, current);
        current = '';
        index += 1;
        continue;
      }

      if (prepared.command[index - 1] !== '>' && prepared.command[index + 1] !== '>') {
        return [];
      }
    }

    if (character === '|') {
      if (prepared.command[index + 1] === '|') {
        pushShellSegment(segments, current);
        current = '';
        index += 1;
        continue;
      }

      return [];
    }

    current += character;
  }

  if (quote) {
    return [];
  }

  pushShellSegment(segments, current);
  return segments;
}

function pushShellSegment(segments: string[], segment: string): void {
  const normalized = segment.trim();
  if (normalized) {
    segments.push(normalized);
  }
}

function isShellEnvAssignment(token: string | undefined): boolean {
  return Boolean(token && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
}

export function isStandaloneShellRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?(?:>>?|<)$/.test(token));
}

export function isInlineShellRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?(?:>>?|<).+|^(?:&>>?|>&)\S*$|^\d+>&\d+$|^&>>?\S*$/.test(token));
}

export function isStandaloneShellWriteRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?>>?$|^&>>?$/.test(token));
}

export function readInlineShellWriteRedirectionTarget(token: string | undefined): string | undefined {
  if (!token) {
    return undefined;
  }

  const match = token.match(/^(?:\d+)?(>>?|>|&>>?|&>)(.+)$/);
  if (!match) {
    return undefined;
  }

  const target = match[2]?.trim();
  if (!target || isShellDescriptorTarget(target)) {
    return undefined;
  }

  return target;
}

export function isShellDescriptorTarget(token: string | undefined): boolean {
  return Boolean(token && /^&\d+$/.test(token));
}
