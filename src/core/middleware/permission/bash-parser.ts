/**
 * Bash command parser for permission evaluation.
 *
 * Ported from Claude Code's shell parsing approach with Codara-specific
 * extensions for heredoc stripping, compound command splitting, and
 * redirection analysis.
 */
import path from 'node:path';

export interface NormalizedBashCommand {
  tokens: string[];
  commandName: string;
  args: string[];
  specifier: string;
  complex: boolean;
  hasRedirection: boolean;
}

export const SHELL_LAUNCHER_COMMANDS = new Set(['bash', 'sh', 'zsh']);

// ── Shell Preparation ────────────────────────────────────────────────

/**
 * Strip heredoc bodies and line continuations from a command.
 * Returns null for unparseable commands.
 */
function prepareCommand(command: string): string | null {
  if (!command.trim()) return null;
  const cleaned = command.replace(/\\\n[ \t]*/g, ' ');
  return stripHeredocBodies(cleaned);
}

function stripHeredocBodies(command: string): string | null {
  const lines = command.split('\n');
  const output: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const idx = findHeredocMarker(line);
    if (idx < 0) { output.push(line); continue; }

    const marker = parseHeredocMarker(line, idx);
    if (!marker || findHeredocMarker(marker.after) >= 0) return null;

    let found = false;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = marker.allowTabs ? (lines[j]!).replace(/^\t+/, '') : lines[j]!;
      if (candidate === marker.delimiter) { i = j; found = true; break; }
    }
    if (!found) return null;
    output.push(`${marker.before}${marker.after}`.trimEnd());
  }
  return output.join('\n');
}

function findHeredocMarker(line: string): number {
  let quote: '"' | '\'' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) i++;
      continue;
    }
    if (ch === '"' || ch === '\'') { quote = ch; continue; }
    if (ch === '<' && line[i + 1] === '<') return i;
  }
  return -1;
}

function parseHeredocMarker(line: string, idx: number) {
  let i = idx + 2;
  let allowTabs = false;
  if (line[i] === '-') { allowTabs = true; i++; }
  if (line[i] === '<' || line[i] === '(') return undefined;
  while (line[i] === ' ' || line[i] === '\t') i++;
  if (i >= line.length) return undefined;

  let delimiter = '';
  if (line[i] === '"' || line[i] === '\'') {
    const quote = line[i]!;
    i++;
    const end = line.indexOf(quote, i);
    if (end < 0) return undefined;
    delimiter = line.slice(i, end);
    i = end + 1;
  } else {
    const start = i;
    while (i < line.length && !/[\s;|&<>]/.test(line[i]!)) i++;
    delimiter = line.slice(start, i);
  }
  if (!delimiter) return undefined;
  return { before: line.slice(0, idx), after: line.slice(i), delimiter, allowTabs };
}

// ── Tokenization ─────────────────────────────────────────────────────

export function tokenizeShellCommand(command: string): { tokens: string[]; complex: boolean } {
  const prepared = prepareCommand(command);
  if (!prepared?.trim()) return { tokens: [], complex: true };
  return tokenize(prepared, 'reject');
}

/**
 * Split a compound command (with ;, &&, ||) into individual segments.
 * Returns [] for commands with pipes or subshells.
 */
export function splitCompoundShellCommands(command: string): string[] {
  const prepared = prepareCommand(command);
  if (!prepared?.trim()) return [];
  return tokenize(prepared, 'split').segments;
}

type TokenizeMode = 'reject' | 'split';

function tokenize(
  input: string,
  mode: TokenizeMode,
): { tokens: string[]; complex: boolean; segments: string[] } {
  const tokens: string[] = [];
  const segments: string[] = [];
  let current = '';
  let segBuf = '';
  let quote: '"' | '\'' | null = null;

  const pushSegment = () => {
    const s = segBuf.trim();
    if (s) segments.push(s);
    segBuf = '';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;

    if (quote) {
      if (ch === quote) {
        quote = null;
        if (mode === 'split') segBuf += ch;
        continue;
      }
      if (ch === '\\' && quote === '"' && i + 1 < input.length) {
        if (mode === 'reject') current += input[i + 1];
        if (mode === 'split') { segBuf += ch; segBuf += input[i + 1]; }
        i++;
        continue;
      }
      if (mode === 'reject') current += ch;
      if (mode === 'split') segBuf += ch;
      continue;
    }

    // Backtick / $( / <( / >( — always complex
    if (ch === '`') return { tokens: [], complex: true, segments: [] };
    if (ch === '$' && input[i + 1] === '(') return { tokens: [], complex: true, segments: [] };
    if ((ch === '<' || ch === '>') && input[i + 1] === '(') return { tokens: [], complex: true, segments: [] };

    // Separator handling differs by mode
    if (ch === ';' || ch === '\n') {
      if (mode === 'reject') return { tokens: [], complex: true, segments: [] };
      pushSegment();
      continue;
    }

    if (ch === '&') {
      if (input[i - 1] !== '>' && input[i + 1] !== '>') {
        if (mode === 'reject') return { tokens: [], complex: true, segments: [] };
        if (input[i + 1] === '&') { pushSegment(); i++; continue; }
        return { tokens: [], complex: true, segments: [] };
      }
    }

    if (ch === '|') {
      if (mode === 'reject') return { tokens: [], complex: true, segments: [] };
      if (input[i + 1] === '|') { pushSegment(); i++; continue; }
      return { tokens: [], complex: true, segments: [] };
    }

    // Quote start
    if (ch === '"' || ch === '\'') {
      quote = ch;
      if (mode === 'split') segBuf += ch;
      continue;
    }

    // Escape
    if (ch === '\\' && i + 1 < input.length) {
      if (mode === 'reject') current += input[i + 1];
      if (mode === 'split') { segBuf += ch; segBuf += input[i + 1]; }
      i++;
      continue;
    }

    // Whitespace
    if (/\s/.test(ch)) {
      if (mode === 'reject' && current) { tokens.push(current); current = ''; }
      if (mode === 'split') segBuf += ch;
      continue;
    }

    if (mode === 'reject') current += ch;
    if (mode === 'split') segBuf += ch;
  }

  if (quote) return { tokens: [], complex: true, segments: [] };
  if (mode === 'reject' && current) tokens.push(current);
  if (mode === 'split') pushSegment();
  return { tokens, complex: false, segments };
}

// ── Token Processing ─────────────────────────────────────────────────

export function stripLeadingShellEnvironment(tokens: string[]): string[] {
  let i = 0;
  while (i < tokens.length && isEnvAssignment(tokens[i]!)) i++;
  if (tokens[i] === 'env') { i++; while (i < tokens.length && isEnvAssignment(tokens[i]!)) i++; }
  return tokens.slice(i);
}

export function stripShellRedirections(tokens: string[]): { tokens: string[]; hasRedirection: boolean } {
  const result: string[] = [];
  let hasRedirection = false;
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) { skipNext = false; continue; }
    if (isStandaloneRedirection(token)) { hasRedirection = true; skipNext = true; continue; }
    if (isInlineRedirection(token)) { hasRedirection = true; continue; }
    result.push(token);
  }
  return { tokens: result, hasRedirection };
}

export function unwrapShellLauncherCommand(tokens: string[]): string | undefined {
  const cmd = path.basename(tokens[0] ?? '').trim().toLowerCase();
  if (!SHELL_LAUNCHER_COMMANDS.has(cmd)) return undefined;

  const args = tokens.slice(1);
  for (let i = 0; i < args.length; i++) {
    const token = args[i]?.trim();
    if (!token) continue;
    if (token === '--') break;
    if (!token.startsWith('-')) break;
    if (token === '-c' || token === '-lc' || token === '-cl') return args[i + 1]?.trim() || undefined;
  }
  return undefined;
}

export function normalizeBashCommandTokens(tokens: string[]): string[] {
  if (!tokens.length) return [];
  const cmd = path.basename(tokens[0] ?? '').trim();
  if (!cmd) return [];
  const args = tokens.slice(1);
  return cmd.toLowerCase() === 'git' ? [cmd, ...normalizeGitArgs(args)] : [cmd, ...args];
}

function normalizeGitArgs(args: string[]): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < args.length) {
    const token = args[i]!;
    if (token === '--') { result.push(...args.slice(i + 1)); break; }
    if (!token.startsWith('-')) { result.push(...args.slice(i)); break; }
    i += 1 + gitGlobalOptionArity(token);
  }
  return result;
}

function gitGlobalOptionArity(token: string): number {
  if (['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--exec-path', '--config-env'].includes(token)) return 1;
  return 0;
}

// ── Redirection Helpers ──────────────────────────────────────────────

function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isStandaloneRedirection(token: string): boolean {
  return /^(?:\d+)?(?:>>?|<)$/.test(token);
}

function isInlineRedirection(token: string): boolean {
  return /^(?:\d+)?(?:>>?|<).+|^(?:&>>?|>&)\S*$|^\d+>&\d+$|^&>>?\S*$/.test(token);
}

export function isStandaloneShellRedirection(token: string | undefined): boolean {
  return Boolean(token && isStandaloneRedirection(token));
}

export function isInlineShellRedirection(token: string | undefined): boolean {
  return Boolean(token && isInlineRedirection(token));
}

export function isStandaloneShellWriteRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?>>?$|^&>>?$/.test(token));
}

export function readInlineShellWriteRedirectionTarget(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const match = token.match(/^(?:\d+)?(>>?|>|&>>?|&>)(.+)$/);
  const target = match?.[2]?.trim();
  return target && !isShellDescriptorTarget(target) ? target : undefined;
}

export function isShellDescriptorTarget(token: string | undefined): boolean {
  return Boolean(token && /^&\d+$/.test(token));
}
