import path from 'node:path';

export interface NormalizedBashCommand {
  tokens: string[];
  commandName: string;
  args: string[];
  specifier: string;
  complex: boolean;
  hasRedirection: boolean;
}

export function formatBashToolScopeExpression(command: string): string {
  const normalized = normalizeBashCommandForMatching(command);
  if (!normalized || normalized.tokens.length === 0) {
    return 'Bash(*)';
  }

  if (normalized.commandName === 'git') {
    const subcommand = normalized.args[0]?.trim();
    if (subcommand) {
      return `Bash(git ${subcommand} *)`;
    }
  }

  return `Bash(${normalized.commandName} *)`;
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

  const normalized = normalizeBashCommandForMatching(raw);
  if (!normalized || normalized.complex) {
    return false;
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

function isStandaloneShellRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?(?:>>?|<)$/.test(token));
}

function isInlineShellRedirection(token: string | undefined): boolean {
  return Boolean(token && /^(?:\d+)?(?:>>?|<).+|^(?:&>>?|>&)\S*$|^\d+>&\d+$|^&>>?\S*$/.test(token));
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
  if (!command.trim()) {
    return {tokens: [], complex: true};
  }

  const tokens: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];

    if (quote) {
      if (character === quote) {
        quote = null;
        continue;
      }

      if (character === '\\' && quote === '"' && index + 1 < command.length) {
        current += command[index + 1];
        index += 1;
        continue;
      }

      current += character;
      continue;
    }

    if (character === '`') {
      return {tokens: [], complex: true};
    }

    if (character === '$' && command[index + 1] === '(') {
      return {tokens: [], complex: true};
    }

    if (character === ';') {
      return {tokens: [], complex: true};
    }

    if (
      character === '|'
      || (
        character === '&'
        && command[index - 1] !== '>'
        && command[index + 1] !== '>'
      )
    ) {
      return {tokens: [], complex: true};
    }

    if (character === '<' && (command[index + 1] === '<' || command[index + 1] === '(')) {
      return {tokens: [], complex: true};
    }

    if (character === '>' && command[index + 1] === '(') {
      return {tokens: [], complex: true};
    }

    if (character === '"' || character === '\'') {
      quote = character;
      continue;
    }

    if (character === '\\') {
      if (command[index + 1] === '\n') {
        index += 1;
        continue;
      }

      if (index + 1 < command.length) {
        current += command[index + 1];
        index += 1;
        continue;
      }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
