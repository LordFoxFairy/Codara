import path from 'node:path';
import {globToRegExp} from '@core/middleware/permission/policy/wildcard';

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

const SHELL_CONTEXT_COMMANDS = new Set([
  '.',
  'alias',
  'cd',
  'dirs',
  'eval',
  'exec',
  'export',
  'false',
  'hash',
  'popd',
  'printf',
  'pushd',
  'pwd',
  'set',
  'shift',
  'source',
  'test',
  'true',
  'type',
  'ulimit',
  'umask',
  'unalias',
  'unset',
  'wait',
]);

const SHELL_LAUNCHER_COMMANDS = new Set(['bash', 'sh', 'zsh']);
const SUBCOMMAND_SCOPED_COMMANDS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'python3']);

export function formatBashToolScopeExpression(command: string): string {
  const normalized = normalizeBashCommandForMatching(command);
  if (normalized && !normalized.complex && normalized.tokens.length > 0) {
    return formatNormalizedBashToolScope(normalized);
  }

  const compoundCommands = normalizeCompoundBashCommands(command);
  if (compoundCommands.length === 0) {
    return 'Bash(*)';
  }

  const actionable = compoundCommands.filter((entry) => !SHELL_CONTEXT_COMMANDS.has(entry.commandName));
  const candidates = actionable.length > 0 ? actionable : compoundCommands;
  if (candidates.length === 1) {
    return formatNormalizedBashToolScope(candidates[0]);
  }

  const commandName = candidates[0]?.commandName;
  if (!commandName || !candidates.every((entry) => entry.commandName === commandName)) {
    return 'Bash(*)';
  }

  const scopedPrefixes = candidates
    .map((entry) => deriveBashCommandScopePrefix(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (scopedPrefixes.length === candidates.length && new Set(scopedPrefixes).size === 1) {
    return `Bash(${scopedPrefixes[0]} *)`;
  }

  return `Bash(${commandName} *)`;
}

export function bashSpecifierMatches(callSpecifier: string, ruleSpecifier: string): boolean {
  const raw = callSpecifier.trim();
  const rule = ruleSpecifier.trim();
  if (!raw || !rule) {
    return false;
  }

  if (!rule.includes('*')) {
    if (raw === rule) {
      return true;
    }

    const normalized = normalizeBashCommandForMatching(raw);
    if (!normalized) {
      return false;
    }

    return normalized.specifier === rule;
  }

  if (rule === '*') {
    return raw.length > 0;
  }

  const normalized = normalizeBashCommandForMatching(raw);
  if (!normalized || normalized.complex) {
    return false;
  }

  // Commands with write redirections should not match wildcard rules
  // (only exact rules or catch-all '*'). This prevents e.g. Bash(cat *)
  // from matching "cat <<EOF > file".
  if (normalized.hasRedirection) {
    return false;
  }

  if (rule.endsWith(' *')) {
    const optionalPrefix = rule.slice(0, -2).trimEnd();
    if (normalized.specifier === optionalPrefix) {
      return true;
    }
  }

  return globToRegExp(rule).test(normalized.specifier);
}

export function normalizeBashCommandForMatching(command: string): NormalizedBashCommand | undefined {
  const tokenized = tokenizeShellCommand(command);
  if (tokenized.tokens.length === 0) {
    return undefined;
  }

  const withoutEnv = stripLeadingShellEnvironment(tokenized.tokens);
  if (withoutEnv.length === 0) {
    return undefined;
  }

  const {tokens: withoutRedirections, hasRedirection} = stripShellRedirections(withoutEnv);
  if (withoutRedirections.length === 0) {
    return undefined;
  }

  const unwrapped = unwrapShellLauncherCommand(withoutRedirections);
  if (unwrapped) {
    const normalized = normalizeBashCommandForMatching(unwrapped);
    return normalized
      ? {
        ...normalized,
        complex: tokenized.complex || normalized.complex,
        hasRedirection: hasRedirection || normalized.hasRedirection,
      }
      : undefined;
  }

  const normalizedTokens = normalizeBashCommandTokens(withoutRedirections);
  if (normalizedTokens.length === 0) {
    return undefined;
  }

  const commandName = path.basename(normalizedTokens[0] ?? '').trim().toLowerCase();
  if (!commandName) {
    return undefined;
  }

  return {
    tokens: normalizedTokens,
    commandName,
    args: normalizedTokens.slice(1),
    specifier: normalizedTokens.join(' '),
    complex: tokenized.complex,
    hasRedirection,
  };
}

export function extractBashWritePathOperands(command: string): string[] {
  const tokenized = tokenizeShellCommand(command);
  if (tokenized.tokens.length === 0 || tokenized.complex) {
    return [];
  }

  const withoutEnv = stripLeadingShellEnvironment(tokenized.tokens);
  if (withoutEnv.length === 0) {
    return [];
  }

  const unwrapped = unwrapShellLauncherCommand(withoutEnv);
  if (unwrapped) {
    return extractBashWritePathOperands(unwrapped);
  }

  // Check for redirection targets
  const redirectionTargets = collectShellWriteRedirectionOperands(withoutEnv);
  if (redirectionTargets.length > 0) return redirectionTargets;

  // Check for write-creating commands (mkdir, touch, cp, mv, tee, etc.)
  return collectWriteCommandOperands(withoutEnv);
}

function formatNormalizedBashToolScope(normalized: NormalizedBashCommand): string {
  const scopedPrefix = deriveBashCommandScopePrefix(normalized);
  if (scopedPrefix) {
    return `Bash(${scopedPrefix} *)`;
  }

  return `Bash(${normalized.commandName} *)`;
}

function deriveBashCommandScopePrefix(normalized: NormalizedBashCommand): string | undefined {
  if (!SUBCOMMAND_SCOPED_COMMANDS.has(normalized.commandName)) {
    return undefined;
  }

  if (normalized.commandName === 'python' || normalized.commandName === 'python3') {
    if (normalized.args[0] === '-m' && normalized.args[1]) {
      return `${normalized.commandName} -m ${normalized.args[1]}`;
    }

    return undefined;
  }

  const firstNonFlag = normalized.args.find((token) => token && !token.startsWith('-'));
  if (!firstNonFlag) {
    return undefined;
  }

  return `${normalized.commandName} ${firstNonFlag}`;
}

function normalizeCompoundBashCommands(command: string): NormalizedBashCommand[] {
  const unwrapped = unwrapLauncherCommandExpression(command);
  if (unwrapped) {
    return normalizeCompoundBashCommands(unwrapped);
  }

  const segments = splitCompoundShellCommands(command);
  if (segments.length === 0) {
    return [];
  }

  return segments
    .map((segment) => normalizeBashCommandForMatching(segment))
    .filter((entry): entry is NormalizedBashCommand => Boolean(entry && entry.tokens.length > 0));
}

function unwrapLauncherCommandExpression(command: string): string | undefined {
  const tokenized = tokenizeShellCommand(command);
  if (tokenized.tokens.length === 0) {
    return undefined;
  }

  const withoutEnv = stripLeadingShellEnvironment(tokenized.tokens);
  if (withoutEnv.length === 0) {
    return undefined;
  }

  return unwrapShellLauncherCommand(withoutEnv);
}

function splitCompoundShellCommands(command: string): string[] {
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

function stripLeadingShellEnvironment(tokens: string[]): string[] {
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

function stripShellRedirections(tokens: string[]): {tokens: string[]; hasRedirection: boolean} {
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

const WRITE_COMMANDS = new Set(['mkdir', 'touch', 'tee', 'install']);

function collectWriteCommandOperands(tokens: string[]): string[] {
  if (tokens.length < 2) return [];
  const cmd = tokens[0]?.trim();
  if (!cmd || !WRITE_COMMANDS.has(cmd)) return [];

  // Collect non-flag arguments as write targets
  const targets: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]?.trim();
    if (!token || token.startsWith('-')) continue;
    // For these commands, the operand is the path being created/written
    targets.push(token);
  }
  return targets;
}

function collectShellWriteRedirectionOperands(tokens: string[]): string[] {
  const operands: string[] = [];
  let skipNext = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (isStandaloneShellWriteRedirection(token)) {
      const next = tokens[index + 1]?.trim();
      if (next && !isShellDescriptorTarget(next)) {
        operands.push(next);
      }
      skipNext = true;
      continue;
    }

    const inlineTarget = readInlineShellWriteRedirectionTarget(token);
    if (inlineTarget) {
      operands.push(inlineTarget);
    }
  }

  return operands;
}

function isStandaloneShellRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?(?:>>?|<)$/.test(token));
}

function isInlineShellRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?(?:>>?|<).+|^(?:&>>?|>&)\S*$|^\d+>&\d+$|^&>>?\S*$/.test(token));
}

function isStandaloneShellWriteRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?>>?$|^&>>?$/.test(token));
}

function readInlineShellWriteRedirectionTarget(token: string | undefined): string | undefined {
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

function isShellDescriptorTarget(token: string | undefined): boolean {
  return Boolean(token && /^&\d+$/.test(token));
}

function isShellEnvAssignment(token: string | undefined): boolean {
  return Boolean(token && /^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
}

function normalizeBashCommandTokens(tokens: string[]): string[] {
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

function unwrapShellLauncherCommand(tokens: string[]): string | undefined {
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

function tokenizeShellCommand(command: string): {tokens: string[]; complex: boolean} {
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

/**
 * BashArity: maps command prefixes to the number of tokens that define
 * the "human-understandable command". Used to generate "always" patterns.
 *
 * Ported from OpenCode's arity.ts.
 *
 * Example: `git checkout main` → arity("git") = 2 → prefix = ["git", "checkout"]
 *          → always pattern = "git checkout *"
 */
const BASH_ARITY: Record<string, number> = {
  cat: 1, cd: 1, chmod: 1, chown: 1, cp: 1, echo: 1, env: 1,
  export: 1, grep: 1, kill: 1, killall: 1, ln: 1, ls: 1,
  mkdir: 1, mv: 1, ps: 1, pwd: 1, rm: 1, rmdir: 1, sleep: 1,
  source: 1, tail: 1, touch: 1, unset: 1, which: 1,
  aws: 3, az: 3, bazel: 2, brew: 2, bun: 2, 'bun run': 3, 'bun x': 3,
  cargo: 2, 'cargo add': 3, 'cargo run': 3, cdk: 2, cmake: 2,
  composer: 2, deno: 2, 'deno task': 3,
  docker: 2, 'docker compose': 3, 'docker container': 3,
  'docker image': 3, 'docker network': 3, 'docker volume': 3,
  firebase: 2, flyctl: 2, gcloud: 3,
  gh: 3, git: 2, 'git config': 3, 'git remote': 3, 'git stash': 3,
  go: 2, gradle: 2, helm: 2, heroku: 2,
  kubectl: 2, 'kubectl kustomize': 3, 'kubectl rollout': 3,
  make: 2, minikube: 2, mvn: 2, ng: 2,
  npm: 2, 'npm exec': 3, 'npm init': 3, 'npm run': 3, 'npm view': 3,
  nvm: 2, nx: 2,
  pip: 2, pipenv: 2, pnpm: 2, 'pnpm dlx': 3, 'pnpm exec': 3, 'pnpm run': 3,
  poetry: 2, podman: 2, psql: 2, pulumi: 2,
  pyenv: 2, python: 2, rake: 2, rbenv: 2,
  rustup: 2, serverless: 2, sst: 2, swift: 2,
  systemctl: 2, terraform: 2, 'terraform workspace': 3,
  turbo: 2, vault: 2, 'vault kv': 3, vercel: 2, volta: 2,
  yarn: 2, 'yarn dlx': 3, 'yarn run': 3,
};

/**
 * Extract the meaningful command prefix from tokens using BashArity.
 * Longest matching prefix wins.
 *
 * `["git", "checkout", "main"]` → `["git", "checkout"]`
 * `["npm", "run", "dev"]` → `["npm", "run", "dev"]`
 * `["unknown-cmd", "arg"]` → `["unknown-cmd"]`
 */
function bashArityPrefix(tokens: string[]): string[] {
  for (let len = tokens.length; len > 0; len--) {
    const prefix = tokens.slice(0, len).join(' ');
    const arity = BASH_ARITY[prefix];
    if (arity !== undefined) {
      return tokens.slice(0, arity);
    }
  }
  if (tokens.length === 0) return [];
  return tokens.slice(0, 1);
}

/**
 * Generate "always allow" pattern suggestions for a bash command.
 * Returns patterns from most specific to most general.
 *
 * `npm install lodash` → ["npm install *", "npm *", "*"]
 * `git checkout main` → ["git checkout *", "git *", "*"]
 */
export function extractBashAlwaysPatterns(command: string): string[] {
  const normalized = normalizeBashCommandForMatching(command);
  if (!normalized || normalized.tokens.length === 0) {
    return ['*'];
  }

  const prefix = bashArityPrefix(normalized.tokens);
  const patterns: string[] = [];

  // Most specific: arity-based prefix + wildcard
  if (prefix.length > 0) {
    patterns.push(`${prefix.join(' ')} *`);
  }

  // Medium: just the command name + wildcard (if different from above)
  if (prefix.length > 1) {
    patterns.push(`${normalized.commandName} *`);
  }

  // Most general
  patterns.push('*');

  return patterns;
}

