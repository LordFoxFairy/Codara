/**
 * Permission evaluation engine — last-match-wins with 3-layer resolution.
 *
 * Layer 1: Explicit rules (last-match-wins)
 * Layer 2: Default tool-type decision (read-only -> allow, else -> ask)
 * Layer 3: Mode transformation (plan, bypassPermissions, dontAsk, acceptEdits)
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
import {loadPermissionRules, resolvePermissionProjectRoot} from './config';
import path from 'node:path';

// ── Glob/wildcard matching ──────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function globToRegExp(pattern: string, caseInsensitive = false): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
}

function wildcardMatch(value: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return value === pattern;
  return globToRegExp(pattern, true).test(value);
}

function matchTool(callTool: string, ruleTool: string): boolean {
  return globToRegExp(ruleTool, true).test(callTool);
}

// ── Mode & Default Decision ─────────────────────────────────────────

const EDIT_TOOLS = new Set(['read_file', 'write_file', 'edit_file', 'glob', 'grep', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
const READ_ONLY_TOOLS = new Set(['read', 'glob', 'grep', 'fetch', 'search', 'read_file', 'fetch_url', 'web_search']);

export function applyPermissionMode(decision: PermissionAction, mode: PermissionMode | undefined, toolName: string): PermissionAction {
  if (!mode || mode === 'default') return decision;
  switch (mode) {
    case 'bypassPermissions': return 'allow';
    case 'dontAsk': return decision === 'ask' ? 'deny' : decision;
    case 'plan': return decision === 'allow' ? 'ask' : decision;
    case 'acceptEdits': return EDIT_TOOLS.has(toolName) && decision === 'ask' ? 'allow' : decision;
    default: return decision;
  }
}

export function getDefaultToolDecision(toolName: string): PermissionAction {
  return READ_ONLY_TOOLS.has(toolName.trim().toLowerCase()) ? 'allow' : 'ask';
}

// ── 3-Layer Resolution (sync, pre-loaded rules) ─────────────────────

export function resolvePermissionDecision(params: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  rules: PermissionRuleSet;
  mode: PermissionMode | undefined;
}): PermissionAction {
  const {toolName, toolArgs, rules, mode} = params;
  const expression = formatExprFromParts(toolName, toolArgs);
  if (!expression) {
    return applyPermissionMode(getDefaultToolDecision(toolName), mode, toolName);
  }

  const {permission, specifier} = parseExpression(expression);
  const matched = findLastMatch(permission, specifier, rules.rules, {});
  const raw = matched ? matched.action : getDefaultToolDecision(permission);
  return applyPermissionMode(raw, mode, permission);
}

function formatExprFromParts(toolName: string, args: Record<string, unknown>): string | undefined {
  const norm = normalizeToolReferenceName(toolName);
  const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
  switch (norm) {
    case 'bash': return fmt('Bash', str(args.command));
    case 'read_file': return fmt('Read', str(args.file_path) ?? str(args.path));
    case 'write_file': return fmt('Write', str(args.file_path));
    case 'edit_file': return fmt('Edit', str(args.file_path));
    case 'fetch_url': return fmt('Fetch', str(args.url));
    case 'web_search': return fmt('Search', str(args.query));
    case 'glob': return fmt('Glob', str(args.pattern));
    case 'grep': return fmt('Grep', str(args.pattern));
    default: return undefined;
  }
}

// ── Full Async Evaluation ───────────────────────────────────────────

export async function evaluatePermissionToolCall(
  toolCall: ToolCall,
  options: PermissionPolicyOptions = {},
): Promise<PermissionEvaluationResult | undefined> {
  const expression = formatPermissionExpression(toolCall);
  if (!expression) return undefined;
  return evaluatePermissionExpression(expression, options);
}

export async function evaluatePermissionExpression(
  expression: string,
  options: PermissionPolicyOptions = {},
): Promise<PermissionEvaluationResult> {
  const {permission, specifier} = parseExpression(expression);
  if (!permission) throw new Error(`Invalid permission expression: ${expression}`);

  const {rules, defaultDecision, sources} = await loadPermissionRules(options);
  const matchedRule = findLastMatch(permission, specifier, rules, options);

  let rawDecision: PermissionAction;
  if (matchedRule) {
    rawDecision = matchedRule.action;
  } else {
    const toolDefault = getDefaultToolDecision(permission);
    rawDecision = defaultDecision === 'allow' ? defaultDecision : toolDefault;
  }

  const decision = applyPermissionMode(rawDecision, options.permissionMode, permission);

  return {
    input: expression,
    decision,
    matchedRule,
    matched: matchedRule ? {
      bucket: matchedRule.action,
      rule: `${matchedRule.permission}(${matchedRule.pattern})`,
      scope: matchedRule.source.scope,
      path: matchedRule.source.path,
    } : null,
    defaultDecision,
    sources,
    ruleSummary: {total: rules.length},
  };
}

// ── Rule Matching ───────────────────────────────────────────────────

function findLastMatch(
  permission: string,
  specifier: string,
  rules: PermissionRuleEntry[],
  options: PermissionPolicyOptions,
): PermissionRuleEntry | null {
  const callNorm = permission.trim().toLowerCase();
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]!;
    const ruleNorm = rule.permission.trim().toLowerCase();
    const toolMatches = matchTool(permission, rule.permission)
      || (callNorm === 'bash' && (ruleNorm === 'write' || ruleNorm === 'edit'));
    if (!toolMatches) continue;
    if (!matchSpecifier(permission, specifier, rule.permission, rule.pattern, options)) continue;
    return rule;
  }
  return null;
}

function matchSpecifier(
  callPerm: string, callSpec: string,
  rulePerm: string, rulePattern: string,
  options: PermissionPolicyOptions,
): boolean {
  if (rulePattern === '*') return true;
  const callNorm = callPerm.trim().toLowerCase();
  const ruleNorm = rulePerm.trim().toLowerCase();

  if (callNorm === 'bash' && ruleNorm === 'bash') return bashSpecifierMatches(callSpec, rulePattern);
  if (isPathTool(callNorm) && isPathTool(ruleNorm)) return pathMatch(callSpec, rulePattern, options);
  if (callNorm === 'bash' && isPathTool(ruleNorm)) return bashPathMatch(callSpec, rulePattern, options);

  return rulePattern.includes('*') ? wildcardMatch(callSpec, rulePattern) : callSpec === rulePattern;
}

function isPathTool(name: string): boolean {
  return name === 'read' || name === 'write' || name === 'edit';
}

function pathMatch(callSpec: string, ruleSpec: string, options: PermissionPolicyOptions): boolean {
  const root = resolvePermissionProjectRoot(options);
  const cwd = options.cwd ?? root;
  const cp = normalizePath(callSpec, cwd, root);
  const rp = normalizePath(ruleSpec, cwd, root);
  if (!cp || !rp) return false;
  if (rp === '*') return true;
  if (rp.includes('*')) return wildcardMatch(cp, rp);
  if (rp.endsWith('/')) return cp === rp || cp.startsWith(rp);
  return cp === rp;
}

function bashPathMatch(command: string, ruleSpec: string, options: PermissionPolicyOptions): boolean {
  const normalized = normalizeBashCommandForMatching(command);
  if (!normalized || normalized.complex) return false;
  return extractBashWritePathOperands(command).some(t => pathMatch(t, ruleSpec, options));
}

function normalizePath(specifier: string, cwd: string, projectRoot: string): string | undefined {
  const raw = specifier.trim();
  if (!raw) return undefined;
  if (raw === '*') return '*';
  const isDir = raw.endsWith('/');
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(cwd, raw);
  const relative = path.relative(projectRoot, resolved);
  if (relative === '') return '.';
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    const n = relative.replace(/\\/g, '/');
    return isDir ? `${n}/` : n;
  }
  const abs = path.resolve(resolved).replace(/\\/g, '/');
  return isDir ? `${abs}/` : abs;
}

// ── Expression Formatting & Parsing ─────────────────────────────────

export function formatPermissionExpression(toolCall: ToolCall): string | undefined {
  const toolName = normalizeToolReferenceName(toolCall.name ?? '');
  const args = normalizeArgs(toolCall.args);
  const str = (v: unknown) => typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const pathArg = (n: string, a: Record<string, unknown>) =>
    n === 'read_file' ? str(a.file_path) ?? str(a.path) : str(a.file_path);

  switch (toolName) {
    case 'bash': return fmt('Bash', str(args.command));
    case 'read_file': return fmt('Read', pathArg(toolName, args));
    case 'write_file': return fmt('Write', pathArg(toolName, args));
    case 'edit_file': return fmt('Edit', pathArg(toolName, args));
    case 'fetch_url': return fmt('Fetch', str(args.url));
    case 'web_search': return fmt('Search', str(args.query));
    case 'glob': return fmt('Glob', str(args.pattern));
    case 'grep': return fmt('Grep', str(args.pattern));
    default: return undefined;
  }
}

export function parseExpression(input: string): { permission: string; specifier: string } {
  const text = input.trim();
  const open = text.indexOf('(');
  if (open < 0) return {permission: text, specifier: '*'};
  if (!text.endsWith(')')) throw new Error(`Invalid permission expression: ${input}`);
  return {permission: text.slice(0, open).trim(), specifier: text.slice(open + 1, -1) || '*'};
}

function fmt(label: string, specifier: string | undefined): string {
  return `${label}(${specifier?.trim() || '*'})`;
}

function normalizeArgs(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
