import path from 'node:path';
import {globToRegExp} from '@core/middleware/permission/policy/wildcard';
import type {NormalizedBashCommand} from '@core/middleware/permission/bash-parser';
import {
  normalizeBashCommandTokens,
  splitCompoundShellCommands,
  stripLeadingShellEnvironment,
  stripShellRedirections,
  tokenizeShellCommand,
  unwrapShellLauncherCommand,
} from '@core/middleware/permission/bash-parser';

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

export function normalizeCompoundBashCommands(command: string): NormalizedBashCommand[] {
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
