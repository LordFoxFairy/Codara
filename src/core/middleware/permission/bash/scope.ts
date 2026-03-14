import {splitCompoundShellCommands, tokenizeShellCommand} from './parser';
import {deriveBashCommandScopePrefix, normalizeBashCommandForMatching, stripLeadingShellEnvironment, unwrapShellLauncherCommand} from './normalize';
import {SHELL_CONTEXT_COMMANDS} from './types';
import type {NormalizedBashCommand} from './types';

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

  if (rule.endsWith(' *')) {
    const optionalPrefix = rule.slice(0, -2).trimEnd();
    if (normalized.specifier === optionalPrefix) {
      return true;
    }
  }

  return globToRegExp(rule).test(normalized.specifier);
}

function formatNormalizedBashToolScope(normalized: NormalizedBashCommand): string {
  const scopedPrefix = deriveBashCommandScopePrefix(normalized);
  if (scopedPrefix) {
    return `Bash(${scopedPrefix} *)`;
  }

  return `Bash(${normalized.commandName} *)`;
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}
