/**
 * Last-match-wins permission evaluation engine.
 *
 * Rules are evaluated in order. The last rule that matches wins.
 * If no rule matches, the default decision ('ask') is used.
 */
import type {ToolCall} from '@langchain/core/messages';
import {normalizeToolReferenceName} from '@core/tools/names';
import {
  bashSpecifierMatches,
  extractBashWritePathOperands,
  normalizeBashCommandForMatching,
} from '@core/middleware/permission/bash';
import type {
  PermissionAction,
  PermissionEvaluationResult,
  PermissionPolicyOptions,
  PermissionRuleEntry,
  PermissionRuleMatch,
} from '../types';
import {match as wildcardMatch, matchTool} from './wildcard';
import {loadPermissionRules, resolvePermissionProjectRoot} from './config';
import path from 'node:path';

/**
 * Evaluate a permission for a tool call using last-match-wins.
 */
export async function evaluatePermissionToolCall(
  toolCall: ToolCall,
  options: PermissionPolicyOptions = {},
): Promise<PermissionEvaluationResult | undefined> {
  const expression = formatPermissionExpression(toolCall);
  if (!expression) return undefined;
  return evaluatePermissionExpression(expression, options);
}

/**
 * Evaluate a permission expression string (e.g. "Bash(git status)").
 */
export async function evaluatePermissionExpression(
  expression: string,
  options: PermissionPolicyOptions = {},
): Promise<PermissionEvaluationResult> {
  const {permission, specifier} = parseExpression(expression);
  if (!permission) {
    throw new Error(`Invalid permission expression: ${expression}`);
  }

  const {rules, defaultDecision, sources} = await loadPermissionRules(options);

  // Last-match-wins: find the last rule that matches
  const matchedRule = findLastMatch(permission, specifier, rules, options);

  const decision = matchedRule?.action ?? defaultDecision;

  return {
    input: expression,
    decision,
    matchedRule,
    matched: toRuleMatch(matchedRule),
    defaultDecision,
    sources,
    ruleSummary: {total: rules.length},
  };
}

/** Convert PermissionRuleEntry to legacy PermissionRuleMatch format. */
function toRuleMatch(entry: PermissionRuleEntry | null): PermissionRuleMatch | null {
  if (!entry) return null;
  return {
    bucket: entry.action,
    rule: `${entry.permission}(${entry.pattern})`,
    scope: entry.source.scope,
    path: entry.source.path,
    format: null,
  };
}

/**
 * Core evaluation: find the last matching rule (last-match-wins).
 */
export function evaluatePermission(
  permission: string,
  pattern: string,
  rules: PermissionRuleEntry[],
  options: PermissionPolicyOptions = {},
): PermissionAction | undefined {
  const matched = findLastMatch(permission, pattern, rules, options);
  return matched?.action;
}

/**
 * Find the last rule that matches the given permission + specifier.
 */
function findLastMatch(
  permission: string,
  specifier: string,
  rules: PermissionRuleEntry[],
  options: PermissionPolicyOptions,
): PermissionRuleEntry | null {
  const callNorm = permission.trim().toLowerCase();

  // Iterate backwards to find the last match
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (!rule) continue;

    const ruleNorm = rule.permission.trim().toLowerCase();

    // Allow cross-tool matching: Bash calls can match Write/Edit path-scoped rules
    // (NOT Read — a bash command writing to a path doesn't match a Read rule)
    const toolMatches = matchTool(permission, rule.permission)
      || (callNorm === 'bash' && (ruleNorm === 'write' || ruleNorm === 'edit'));

    if (!toolMatches) continue;
    if (!matchSpecifier(permission, specifier, rule.permission, rule.pattern, options)) continue;

    return rule;
  }

  return null;
}

/**
 * Match a specifier against a rule pattern.
 * Handles special cases for Bash commands and path-scoped tools.
 */
function matchSpecifier(
  callPermission: string,
  callSpecifier: string,
  rulePermission: string,
  rulePattern: string,
  options: PermissionPolicyOptions,
): boolean {
  // Wildcard pattern matches everything
  if (rulePattern === '*') return true;

  const callNorm = callPermission.trim().toLowerCase();
  const ruleNorm = rulePermission.trim().toLowerCase();

  // Bash-to-Bash matching uses bash-aware specifier comparison
  if (callNorm === 'bash' && ruleNorm === 'bash') {
    return bashSpecifierMatches(callSpecifier, rulePattern);
  }

  // Path-scoped tool matching (Read, Write, Edit)
  if (isPathScopedTool(callNorm) && isPathScopedTool(ruleNorm)) {
    return pathSpecifierMatches(callSpecifier, rulePattern, options);
  }

  // Bash call matching against path-scoped rules (e.g. Bash(mkdir foo) vs Write(foo/))
  if (callNorm === 'bash' && isPathScopedTool(ruleNorm)) {
    return bashPathSpecifierMatches(callSpecifier, rulePermission, rulePattern, options);
  }

  // General matching: exact or glob
  if (!rulePattern.includes('*')) {
    return callSpecifier === rulePattern;
  }
  return wildcardMatch(callSpecifier, rulePattern);
}

function isPathScopedTool(toolName: string): boolean {
  const norm = toolName.trim().toLowerCase();
  return norm === 'read' || norm === 'write' || norm === 'edit';
}

function pathSpecifierMatches(
  callSpecifier: string,
  ruleSpecifier: string,
  options: PermissionPolicyOptions,
): boolean {
  const projectRoot = resolvePermissionProjectRoot(options);
  const cwd = options.cwd ?? projectRoot;

  const callPath = normalizePath(callSpecifier, cwd, projectRoot);
  const rulePath = normalizePath(ruleSpecifier, cwd, projectRoot);

  if (!callPath || !rulePath) return false;

  if (rulePath === '*') return true;

  if (rulePath.includes('*')) {
    return wildcardMatch(callPath, rulePath);
  }

  // Directory matching: rule "src/" matches "src/foo.ts"
  if (rulePath.endsWith('/')) {
    return callPath === rulePath || callPath.startsWith(rulePath);
  }

  return callPath === rulePath;
}

function bashPathSpecifierMatches(
  command: string,
  ruleTool: string,
  ruleSpecifier: string,
  options: PermissionPolicyOptions,
): boolean {
  const normalized = normalizeBashCommandForMatching(command);
  if (!normalized || normalized.complex) return false;

  // Check if the bash command writes to paths matching the rule
  const targets = extractBashWritePathOperands(command);

  return targets.some((target) =>
    pathSpecifierMatches(target, ruleSpecifier, options),
  );
}

function normalizePath(
  specifier: string,
  cwd: string,
  projectRoot: string,
): string | undefined {
  const raw = specifier.trim();
  if (!raw) return undefined;
  if (raw === '*') return '*';

  // Preserve trailing slash for directory rules
  const isDir = raw.endsWith('/');
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
  const relative = path.relative(projectRoot, resolved);

  if (relative === '') return '.';
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    const normalized = relative.replace(/\\/g, '/');
    return isDir ? `${normalized}/` : normalized;
  }
  const abs = path.resolve(resolved).replace(/\\/g, '/');
  return isDir ? `${abs}/` : abs;
}

/**
 * Format a tool call into a permission expression like "Bash(git status)".
 */
export function formatPermissionExpression(toolCall: ToolCall): string | undefined {
  const toolName = normalizeToolReferenceName(toolCall.name ?? '');
  const args = normalizeArgs(toolCall.args);

  switch (toolName) {
    case 'bash':
      return formatExpr('Bash', readString(args.command));
    case 'read_file':
      return formatExpr('Read', readPathArg(toolName, args));
    case 'write_file':
      return formatExpr('Write', readPathArg(toolName, args));
    case 'edit_file':
      return formatExpr('Edit', readPathArg(toolName, args));
    case 'fetch_url':
      return formatExpr('Fetch', readString(args.url));
    case 'web_search':
      return formatExpr('Search', readString(args.query));
    case 'glob':
      return formatExpr('Glob', readString(args.pattern));
    case 'grep':
      return formatExpr('Grep', readString(args.pattern));
    default:
      return undefined;
  }
}

/**
 * Parse a permission expression like "Bash(git *)" into permission + specifier.
 */
export function parseExpression(input: string): { permission: string; specifier: string } {
  const text = input.trim();
  const openIndex = text.indexOf('(');
  if (openIndex < 0) {
    return {permission: text, specifier: '*'};
  }
  if (!text.endsWith(')')) {
    throw new Error(`Invalid permission expression: ${input}`);
  }
  return {
    permission: text.slice(0, openIndex).trim(),
    specifier: text.slice(openIndex + 1, -1) || '*',
  };
}

function formatExpr(label: string, specifier: string | undefined): string {
  return `${label}(${specifier?.trim() || '*'})`;
}

function normalizeArgs(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readPathArg(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'read_file') {
    return readString(args.file_path) ?? readString(args.path);
  }
  return readString(args.file_path);
}
