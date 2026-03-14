import type {ParsedHeredocMarker, PreparedShellCommand} from './types';

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

function pushShellSegment(segments: string[], segment: string): void {
  const normalized = segment.trim();
  if (normalized) {
    segments.push(normalized);
  }
}

function prepareShellCommand(command: string): PreparedShellCommand {
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
