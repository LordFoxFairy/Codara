/**
 * Last-match-wins permission evaluation engine.
 *
 * Rules are evaluated in order. The last rule that matches wins.
 * If no rule matches, the default decision ('ask') is used.
 */
import type {ToolCall} from '@langchain/core/messages';
import {normalizeToolReferenceName} from '@shared/tool-names';
import {bashSpecifierMatches, normalizeBashCommandForMatching} from '@core/middleware/permission/bash-matcher';
import {extractBashWritePathOperands} from '@core/middleware/permission/bash-scope';
import type {PermissionMode} from '@config/schema';
import type {
  PermissionAction,
  PermissionEvaluationResult,
  PermissionPolicyOptions,
  PermissionRuleEntry,
  PermissionRuleMatch,
  PermissionRuleSet,
} from '../types';
import {match as wildcardMatch, matchTool} from './wildcard';
import {loadPermissionRules, resolvePermissionProjectRoot} from './config';
import path from 'node:path';

/** Tools that are considered "edit/file" tools for the acceptEdits mode */
const EDIT_TOOLS = new Set([
  'read_file', 'write_file', 'edit_file', 'glob', 'grep',
  'Read', 'Write', 'Edit', 'Glob', 'Grep',
]);

/**
 * Transform a raw permission decision based on the active permission mode.
 *
 * Modes:
 *  - default:           no transformation
 *  - bypassPermissions: everything → allow
 *  - dontAsk:           ask → deny (never prompt the user)
 *  - plan:              allow → ask (everything needs explicit approval)
 *  - acceptEdits:       ask → allow for file-editing tools only
 */
export function applyPermissionMode(
  decision: PermissionAction,
  mode: PermissionMode | undefined,
  toolName: string,
): PermissionAction {
  if (!mode || mode === 'default') return decision;

  switch (mode) {
    case 'bypassPermissions':
      return 'allow';
    case 'dontAsk':
      return decision === 'ask' ? 'deny' : decision;
    case 'plan':
      return decision === 'allow' ? 'ask' : decision;
    case 'acceptEdits': {
      if (EDIT_TOOLS.has(toolName) && decision === 'ask') return 'allow';
      return decision;
    }
    default:
      return decision;
  }
}

/** Tools that are considered read-only and safe by default (Layer 2) */
const READ_ONLY_TOOLS = new Set([
  'read', 'glob', 'grep', 'fetch', 'search',
  // Unnormalized variants
  'read_file', 'glob', 'grep', 'fetch_url', 'web_search',
]);

/**
 * Layer 2: Get default permission decision based on tool type.
 *
 * Read-only tools default to 'allow'; everything else defaults to 'ask'.
 * This provides a sensible baseline when no explicit rule matches.
 */
export function getDefaultToolDecision(toolName: string): PermissionAction {
  const norm = toolName.trim().toLowerCase();
  return READ_ONLY_TOOLS.has(norm) ? 'allow' : 'ask';
}

/**
 * 3-layer permission resolution.
 *
 * Layer 1: Check explicit rules (alwaysAllow → allow, alwaysDeny → deny, alwaysAsk → ask)
 * Layer 2: Default decision based on tool type (read-only → allow, else → ask)
 * Layer 3: Apply mode transformation (plan, bypassPermissions, dontAsk, acceptEdits)
 *
 * This is a pure, synchronous function that operates on a pre-loaded rule set.
 * For the full async flow (loading rules from disk), use evaluatePermissionExpression.
 */
export function resolvePermissionDecision(params: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  rules: PermissionRuleSet;
  mode: PermissionMode | undefined;
}): PermissionAction {
  const {toolName, toolArgs, rules, mode} = params;

  // Build expression to evaluate against rules
  const expression = formatPermissionExpressionFromParts(toolName, toolArgs);
  if (!expression) {
    // Unknown tool — Layer 2 default + Layer 3 mode
    const layer2 = getDefaultToolDecision(toolName);
    return applyPermissionMode(layer2, mode, toolName);
  }

  const {permission, specifier} = parseExpression(expression);

  // Layer 1: Check explicit rules
  const matchedRule = findLastMatch(permission, specifier, rules.rules, {});
  if (matchedRule) {
    // Layer 3: Apply mode transformation to the explicit rule decision
    return applyPermissionMode(matchedRule.action, mode, permission);
  }

  // Layer 2: Default decision based on tool type
  const layer2Decision = getDefaultToolDecision(permission);

  // Layer 3: Apply mode transformation
  return applyPermissionMode(layer2Decision, mode, permission);
}

/**
 * Build a permission expression from tool name + args (without requiring a ToolCall object).
 */
function formatPermissionExpressionFromParts(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const norm = normalizeToolReferenceName(toolName);
  switch (norm) {
    case 'bash':
      return formatExpr('Bash', readString(args.command));
    case 'read_file':
      return formatExpr('Read', readString(args.file_path) ?? readString(args.path));
    case 'write_file':
      return formatExpr('Write', readString(args.file_path));
    case 'edit_file':
      return formatExpr('Edit', readString(args.file_path));
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
 *
 * Implements the 3-layer resolution:
 *   Layer 1: Explicit rules (last-match-wins)
 *   Layer 2: Default tool decision (read-only tools → allow, else → ask)
 *   Layer 3: Mode transformation (plan, bypassPermissions, dontAsk, acceptEdits)
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

  // Layer 1: Check explicit rules (last-match-wins)
  const matchedRule = findLastMatch(permission, specifier, rules, options);

  // Determine raw decision: Layer 1 (explicit rule) → Layer 2 (tool-type default) → config default
  let rawDecision: PermissionAction;
  if (matchedRule) {
    // Layer 1: explicit rule matched
    rawDecision = matchedRule.action;
  } else {
    // Layer 2: no explicit rule — use tool-type default, falling back to config default
    const toolDefault = getDefaultToolDecision(permission);
    // Use the more restrictive of tool-type default and config default
    // If config says 'allow' (trusted project), honor it; otherwise use tool default
    rawDecision = defaultDecision === 'allow' ? defaultDecision : toolDefault;
  }

  // Layer 3: Apply mode transformation
  const decision = applyPermissionMode(rawDecision, options.permissionMode, permission);

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
  _ruleTool: string,
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
