import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {ToolCall} from '@langchain/core/messages';
import {
  bashSpecifierMatches,
  formatBashToolScopeExpression,
  normalizeBashCommandForMatching,
} from '@core/middleware/permission/bash';
import {normalizeToolReferenceName} from '@core/tools/names';
import {resolveWorkspaceRoot} from '@core/config/workspace';

export type PermissionDecision = 'allow' | 'ask' | 'deny';
export type PermissionGrantScope = 'exact' | 'path' | 'tool' | 'project';

export interface PermissionRuleMatch {
  bucket: PermissionDecision;
  rule: string;
  scope: string;
  path: string;
  format: string | null;
}

export interface PermissionSourceInfo {
  scope: string;
  path: string;
  exists: boolean;
  format: string | null;
}

export interface PermissionEvaluationResult {
  input: string;
  decision: PermissionDecision;
  matched: PermissionRuleMatch | null;
  defaultDecision: PermissionDecision;
  sources: PermissionSourceInfo[];
  policySummary: {
    deny: number;
    ask: number;
    allow: number;
  };
}

export interface PermissionValidationResult {
  scope: string;
  path: string;
  exists: boolean;
  format: string | null;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  errors: string[];
  policySummary: {
    allow: number;
    ask: number;
    deny: number;
  };
}

export interface PermissionPolicyOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  policyFiles?: string[];
  settingsFile?: string;
}

const DEFAULT_ALLOWED_PERMISSION_RULES = [
  'Read(*)',
  'Fetch(*)',
  'Search(*)',
  'Glob(*)',
  'Grep(*)',
  'Bash(git status)',
  'Bash(git diff *)',
  'Bash(git show *)',
  'Bash(git log *)',
  'Bash(git branch *)',
  'Bash(git rev-parse *)',
  'Bash(git ls-files *)',
  'Bash(ls *)',
  'Bash(pwd)',
  'Bash(cat *)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(wc *)',
  'Bash(stat *)',
  'Bash(file *)',
  'Bash(find *)',
  'Bash(rg *)',
  'Bash(grep *)',
] as const;

interface ParsedPolicy {
  format: string;
  allow: string[];
  ask: string[];
  deny: string[];
  defaultDecision: PermissionDecision | null;
  errors: string[];
}

interface PermissionSourceRecord {
  scope: string;
  path: string;
}

interface LoadedPermissionSource extends PermissionSourceInfo {
  policy: ParsedPolicy | null;
}

interface ParsedToolExpression {
  tool: string;
  specifier: string | null;
}

interface MatchedRuleEntry {
  rule: string;
  scope: string;
  path: string;
  format: string | null;
}

interface CanonicalPathPattern {
  value: string;
  isDirectory: boolean;
}

interface BashPermissionPathTarget {
  tool: 'Read' | 'Write' | 'Edit';
  specifier: string;
  scopeSpecifier: string;
}

interface MergedPermissionPolicy {
  defaultDecision: PermissionDecision | null;
  deny: MatchedRuleEntry[];
  ask: MatchedRuleEntry[];
  allow: MatchedRuleEntry[];
}

export function formatPermissionExpression(toolCall: ToolCall): string | undefined {
  const toolName = normalizeToolReferenceName(toolCall.name ?? '');
  const args = normalizeArgs(toolCall.args);

  switch (toolName) {
    case 'bash':
      return formatExpression('Bash', readOptionalString(args.command));
    case 'read_file':
      return formatExpression('Read', readPermissionPathArg(toolName, args));
    case 'write_file':
      return formatExpression('Write', readPermissionPathArg(toolName, args));
    case 'edit_file':
      return formatExpression('Edit', readPermissionPathArg(toolName, args));
    case 'fetch_url':
      return formatExpression('Fetch', readOptionalString(args.url));
    case 'web_search':
      return formatExpression('Search', readOptionalString(args.query));
    case 'glob':
      return formatExpression('Glob', readOptionalString(args.pattern));
    case 'grep':
      return formatExpression('Grep', readOptionalString(args.pattern));
    default:
      return undefined;
  }
}

function formatCanonicalPermissionExpression(
  toolCall: ToolCall,
  options: PermissionPolicyOptions = {},
): string | undefined {
  const toolName = normalizeToolReferenceName(toolCall.name ?? '');
  const args = normalizeArgs(toolCall.args);

  switch (toolName) {
    case 'read_file':
      return formatExpression('Read', normalizePermissionPathSpecifier(
        readPermissionPathArg(toolName, args),
        resolveCallPathBase(options),
        resolvePermissionProjectRoot(options),
      )?.value);
    case 'write_file':
      return formatExpression('Write', normalizePermissionPathSpecifier(
        readPermissionPathArg(toolName, args),
        resolveCallPathBase(options),
        resolvePermissionProjectRoot(options),
      )?.value);
    case 'edit_file':
      return formatExpression('Edit', normalizePermissionPathSpecifier(
        readPermissionPathArg(toolName, args),
        resolveCallPathBase(options),
        resolvePermissionProjectRoot(options),
      )?.value);
    default:
      return formatPermissionExpression(toolCall);
  }
}

export async function evaluatePermissionToolCall(
  toolCall: ToolCall,
  options: PermissionPolicyOptions = {},
): Promise<PermissionEvaluationResult | undefined> {
  const expression = formatCanonicalPermissionExpression(toolCall, options);
  if (!expression) {
    return undefined;
  }

  return evaluatePermissionExpression(expression, options);
}

export async function evaluatePermissionExpression(
  expression: string,
  options: PermissionPolicyOptions = {},
): Promise<PermissionEvaluationResult> {
  const call = parseToolExpression(expression);
  if (!call.tool) {
    throw new Error(`Invalid permission expression: ${expression}`);
  }

  const sources = await Promise.all(buildSourceList(options).map(loadSource));
  const loadedSources = sources.filter((item) => item.exists && item.policy != null);
  const mergedPolicy: MergedPermissionPolicy = {
    defaultDecision: null,
    deny: [],
    ask: [],
    allow: [],
  };

  for (const source of loadedSources) {
    const policy = source.policy;
    if (!policy) {
      continue;
    }

    if (mergedPolicy.defaultDecision == null && policy.defaultDecision) {
      mergedPolicy.defaultDecision = policy.defaultDecision;
    }

    for (const rule of policy.deny) {
      mergedPolicy.deny.push({rule, scope: source.scope, path: source.path, format: source.format});
    }
    for (const rule of policy.ask) {
      mergedPolicy.ask.push({rule, scope: source.scope, path: source.path, format: source.format});
    }
    for (const rule of policy.allow) {
      mergedPolicy.allow.push({rule, scope: source.scope, path: source.path, format: source.format});
    }
  }

  let decision: PermissionDecision = mergedPolicy.defaultDecision ?? 'ask';
  let matched: PermissionRuleMatch | null = null;

  if (call.tool.trim().toLowerCase() === 'bash') {
    ({decision, matched} = evaluateBashPermissionExpression(call, mergedPolicy, options));
  } else {
    const matchedDeny = findMatch(call, mergedPolicy.deny, options);
    const matchedAsk = matchedDeny ? null : findMatch(call, mergedPolicy.ask, options);
    const matchedAllow = matchedDeny || matchedAsk ? null : findMatch(call, mergedPolicy.allow, options);

    if (matchedDeny) {
      decision = 'deny';
      matched = {bucket: 'deny', ...matchedDeny};
    } else if (matchedAsk) {
      decision = 'ask';
      matched = {bucket: 'ask', ...matchedAsk};
    } else if (matchedAllow) {
      decision = 'allow';
      matched = {bucket: 'allow', ...matchedAllow};
    }
  }

  return {
    input: expression,
    decision,
    matched,
    defaultDecision: mergedPolicy.defaultDecision ?? 'ask',
    sources: sources.map(({scope, path: filePath, exists, format}) => ({
      scope,
      path: filePath,
      exists,
      format,
    })),
    policySummary: {
      deny: mergedPolicy.deny.length,
      ask: mergedPolicy.ask.length,
      allow: mergedPolicy.allow.length,
    },
  };
}

export async function persistAllowedPermission(
  toolCallOrExpression: ToolCall | string,
  options: PermissionPolicyOptions = {},
): Promise<{settingsFile: string; alreadyPresent: boolean; created: boolean}> {
  return persistPermissionRule(toolCallOrExpression, 'allow', options);
}

export async function persistPermissionScope(
  toolCallOrExpression: ToolCall | string,
  scope: PermissionGrantScope,
  options: PermissionPolicyOptions = {},
): Promise<{settingsFile: string; alreadyPresent: boolean; created: boolean; rule?: string; defaultDecision?: PermissionDecision}> {
  if (scope === 'project') {
    const settingsFile = resolveSettingsFile(options);
    const created = !existsSync(settingsFile);
    const root = await loadJsonRecord(settingsFile);
    const permissions = isRecord(root.permissions) ? {...root.permissions} : {};
    const alreadyPresent = permissions.defaultDecision === 'allow';
    permissions.defaultDecision = 'allow';
    root.permissions = permissions;

    await mkdir(path.dirname(settingsFile), {recursive: true});
    await writeFile(settingsFile, `${JSON.stringify(normalizeSettingsRecord(root), null, 2)}\n`, 'utf8');

    return {settingsFile, alreadyPresent, created, defaultDecision: 'allow'};
  }

  const expression = scope === 'tool'
    ? formatPermissionToolScopeExpression(toolCallOrExpression)
    : scope === 'path'
      ? formatPermissionPathScopeExpression(toolCallOrExpression, options)
    : typeof toolCallOrExpression === 'string'
      ? toolCallOrExpression.trim()
      : formatCanonicalPermissionExpression(toolCallOrExpression, options);

  if (!expression) {
    throw new Error('Unsupported permission expression');
  }

  const result = await persistPermissionRule(expression, 'allow', options);
  return {...result, rule: expression};
}

export async function persistPermissionRule(
  toolCallOrExpression: ToolCall | string,
  bucket: PermissionDecision,
  options: PermissionPolicyOptions = {},
): Promise<{settingsFile: string; alreadyPresent: boolean; created: boolean}> {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatCanonicalPermissionExpression(toolCallOrExpression, options);

  if (!expression) {
    throw new Error('Unsupported permission expression');
  }

  if (bucket !== 'allow' && bucket !== 'ask' && bucket !== 'deny') {
    throw new Error(`Unsupported permission bucket: ${bucket}`);
  }

  const settingsFile = resolveSettingsFile(options);
  const created = !existsSync(settingsFile);
  const root = await loadJsonRecord(settingsFile);
  const permissions = isRecord(root.permissions) ? {...root.permissions} : {};
  const rules = isRecord(permissions.rules) ? {...permissions.rules} : {};
  const existingRules = Array.isArray(rules[bucket])
    ? rules[bucket].filter((item): item is string => typeof item === 'string')
    : [];
  const alreadyPresent = existingRules.includes(expression);

  if (!alreadyPresent) {
    existingRules.push(expression);
  }

  rules[bucket] = existingRules;
  permissions.rules = rules;
  root.permissions = permissions;

  await mkdir(path.dirname(settingsFile), {recursive: true});
  await writeFile(settingsFile, `${JSON.stringify(root, null, 2)}\n`, 'utf8');

  return {settingsFile, alreadyPresent, created};
}

export function ensurePermissionSettingsFile(
  options: PermissionPolicyOptions = {},
): {settingsFile: string; created: boolean; repaired: boolean} {
  const settingsFile = resolveSettingsFile(options);
  const normalized = readNormalizedSettingsRecord(settingsFile);

  if (normalized.status === 'valid') {
    return {settingsFile, created: false, repaired: false};
  }

  mkdirSync(path.dirname(settingsFile), {recursive: true});
  writeFileSync(settingsFile, `${JSON.stringify(normalized.record, null, 2)}\n`, 'utf8');

  return {
    settingsFile,
    created: normalized.status === 'missing',
    repaired: normalized.status === 'invalid',
  };
}

export async function validatePermissionSettings(
  options: PermissionPolicyOptions & {targets?: string[]},
): Promise<PermissionValidationResult[]> {
  const sources = options.targets?.length
    ? options.targets.map((target) => ({scope: 'explicit_target', path: path.resolve(target)}))
    : buildSourceList(options);

  const results: PermissionValidationResult[] = [];
  for (const source of sources) {
    if (!existsSync(source.path)) {
      results.push({
        scope: source.scope,
        path: source.path,
        exists: false,
        format: null,
        status: 'skip',
        errors: [],
        policySummary: {allow: 0, ask: 0, deny: 0},
      });
      continue;
    }

    try {
      const parsed = JSON.parse(await readFile(source.path, 'utf8')) as unknown;
      const policy = parsePolicyData(parsed);
      results.push({
        scope: source.scope,
        path: source.path,
        exists: true,
        format: policy.format,
        status: policy.errors.length > 0 ? 'fail' : policy.format === 'unknown' ? 'warn' : 'ok',
        errors: [...policy.errors],
        policySummary: {
          allow: policy.allow.length,
          ask: policy.ask.length,
          deny: policy.deny.length,
        },
      });
    } catch (error) {
      results.push({
        scope: source.scope,
        path: source.path,
        exists: true,
        format: null,
        status: 'fail',
        errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
        policySummary: {allow: 0, ask: 0, deny: 0},
      });
    }
  }

  return results;
}

function normalizeArgs(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function formatExpression(label: string, specifier: string | undefined): string {
  return `${label}(${specifier?.trim() || '*'})`;
}

export function formatPermissionToolScopeExpression(toolCallOrExpression: ToolCall | string): string | undefined {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatPermissionExpression(toolCallOrExpression);
  if (!expression) {
    return undefined;
  }

  const parsed = parseToolExpression(expression);
  const tool = parsed.tool.trim();
  if (!tool) {
    return undefined;
  }

  if (tool.toLowerCase() !== 'bash') {
    return `${tool}(*)`;
  }

  const command = parsed.specifier?.trim();
  if (!command || command === '*') {
    return 'Bash(*)';
  }

  return formatBashToolScopeExpression(command);
}

export function formatPermissionPathScopeExpression(
  toolCallOrExpression: ToolCall | string,
  options: PermissionPolicyOptions = {},
): string | undefined {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatCanonicalPermissionExpression(toolCallOrExpression, options);
  if (!expression) {
    return undefined;
  }

  const parsed = parseToolExpression(expression);
  const tool = parsed.tool.trim();
  if (tool.toLowerCase() === 'bash') {
    const bashTarget = deriveSingleBashPathScopeTarget(parsed.specifier, options);
    return bashTarget ? `${bashTarget.tool}(${bashTarget.scopeSpecifier})` : undefined;
  }

  if (!isPathScopedTool(tool)) {
    return undefined;
  }

  const specifier = parsed.specifier?.trim();
  if (!specifier || specifier === '*') {
    return undefined;
  }

  const scopeSpecifier = derivePermissionPathScopeSpecifier(specifier);
  if (!scopeSpecifier) {
    return undefined;
  }

  return `${tool}(${scopeSpecifier})`;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readPermissionPathArg(toolName: string, args: Record<string, unknown>): string | undefined {
  if (toolName === 'read_file') {
    return readOptionalString(args.file_path) ?? readOptionalString(args.path);
  }

  return readOptionalString(args.file_path);
}

function parseToolExpression(input: string): ParsedToolExpression {
  const text = input.trim();
  const openIndex = text.indexOf('(');

  if (openIndex < 0) {
    return {tool: text, specifier: null};
  }

  if (!text.endsWith(')')) {
    throw new Error(`Invalid permission expression: ${input}`);
  }

  return {
    tool: text.slice(0, openIndex).trim(),
    specifier: text.slice(openIndex + 1, -1),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(pattern: string, caseInsensitive = false): RegExp {
  const escaped = escapeRegExp(pattern).replace(/\\\*/g, '.*');
  return new RegExp(`^${escaped}$`, caseInsensitive ? 'i' : '');
}

function toolMatches(callTool: string, ruleTool: string): boolean {
  return globToRegExp(ruleTool, true).test(callTool);
}

function specifierMatches(
  call: ParsedToolExpression,
  rule: ParsedToolExpression,
  entry: MatchedRuleEntry,
  options: PermissionPolicyOptions,
  matchMode: 'all' | 'direct' = 'all',
): boolean {
  const callSpecifier = call.specifier;
  const ruleSpecifier = rule.specifier;
  if (ruleSpecifier == null) {
    return true;
  }
  if (callSpecifier == null) {
    return false;
  }

  if (call.tool.trim().toLowerCase() === 'bash' && rule.tool.trim().toLowerCase() === 'bash') {
    return bashSpecifierMatches(callSpecifier, ruleSpecifier);
  }

  if (isPathScopedTool(call.tool) && isPathScopedTool(rule.tool)) {
    return pathSpecifierMatches(callSpecifier, ruleSpecifier, entry, options);
  }

  if (
    matchMode === 'all'
    && call.tool.trim().toLowerCase() === 'bash'
    && isPathScopedTool(rule.tool)
  ) {
    return bashPathSpecifierMatches(callSpecifier, rule.tool, ruleSpecifier, entry, options);
  }

  if (!ruleSpecifier.includes('*')) {
    return callSpecifier === ruleSpecifier;
  }
  return globToRegExp(ruleSpecifier).test(callSpecifier);
}

function findMatch(
  call: ParsedToolExpression,
  rules: MatchedRuleEntry[],
  options: PermissionPolicyOptions,
  matchMode: 'all' | 'direct' = 'all',
): MatchedRuleEntry | null {
  for (const entry of rules) {
    const parsedRule = parseToolExpression(entry.rule);
    if (!parsedRule.tool) {
      continue;
    }
    if (!toolMatches(call.tool, parsedRule.tool)) {
      continue;
    }
    if (!specifierMatches(call, parsedRule, entry, options, matchMode)) {
      continue;
    }
    return entry;
  }

  return null;
}

function pathSpecifierMatches(
  callSpecifier: string,
  ruleSpecifier: string,
  entry: MatchedRuleEntry,
  options: PermissionPolicyOptions,
): boolean {
  const projectRoot = resolvePermissionProjectRoot(options);
  const callPattern = normalizePermissionPathSpecifier(callSpecifier, resolveCallPathBase(options), projectRoot);
  const rulePattern = normalizePermissionPathSpecifier(
    ruleSpecifier,
    resolveRulePathBase(entry.scope, entry.path, options),
    projectRoot,
  );
  if (!callPattern || !rulePattern) {
    return false;
  }

  if (rulePattern.value === '*') {
    return true;
  }

  if (rulePattern.value.includes('*')) {
    return globToRegExp(rulePattern.value).test(callPattern.value);
  }

  if (rulePattern.isDirectory) {
    return callPattern.value === rulePattern.value
      || callPattern.value.startsWith(rulePattern.value);
  }

  return callPattern.value === rulePattern.value;
}

function bashPathSpecifierMatches(
  commandSpecifier: string,
  ruleTool: string,
  ruleSpecifier: string,
  entry: MatchedRuleEntry,
  options: PermissionPolicyOptions,
): boolean {
  const targets = analyzeBashPermissionPathTargets(commandSpecifier, options);
  return targets.some((target) => (
    target.tool.toLowerCase() === ruleTool.trim().toLowerCase()
    && pathSpecifierMatches(target.specifier, ruleSpecifier, entry, options)
  ));
}

function evaluateBashPermissionExpression(
  call: ParsedToolExpression,
  policy: MergedPermissionPolicy,
  options: PermissionPolicyOptions,
): {decision: PermissionDecision; matched: PermissionRuleMatch | null} {
  const directDeny = findMatch(call, policy.deny, options, 'direct');
  if (directDeny) {
    return {decision: 'deny', matched: {bucket: 'deny', ...directDeny}};
  }

  const directAsk = findMatch(call, policy.ask, options, 'direct');
  const directAllow = directAsk ? null : findMatch(call, policy.allow, options, 'direct');
  const pathDecision = evaluateBashPathDecision(call.specifier, policy, options);

  if (pathDecision?.decision === 'deny') {
    return pathDecision;
  }

  if (directAsk) {
    return {decision: 'ask', matched: {bucket: 'ask', ...directAsk}};
  }

  if (pathDecision?.decision === 'ask' && pathDecision.matched) {
    return pathDecision;
  }

  if (directAllow) {
    return {decision: 'allow', matched: {bucket: 'allow', ...directAllow}};
  }

  if (pathDecision?.decision === 'ask') {
    return pathDecision;
  }

  if (pathDecision?.decision === 'allow') {
    return pathDecision;
  }

  return {
    decision: policy.defaultDecision ?? 'ask',
    matched: null,
  };
}

function evaluateBashPathDecision(
  commandSpecifier: string | null,
  policy: MergedPermissionPolicy,
  options: PermissionPolicyOptions,
): {decision: PermissionDecision; matched: PermissionRuleMatch | null} | undefined {
  if (!commandSpecifier) {
    return undefined;
  }

  const targets = analyzeBashPermissionPathTargets(commandSpecifier, options);
  if (targets.length === 0) {
    return undefined;
  }

  const defaultDecision = policy.defaultDecision ?? 'ask';
  let matchedAllow: MatchedRuleEntry | null = null;

  for (const target of targets) {
    const call: ParsedToolExpression = {tool: target.tool, specifier: target.specifier};

    const matchedDeny = findMatch(call, policy.deny, options, 'direct');
    if (matchedDeny) {
      return {decision: 'deny', matched: {bucket: 'deny', ...matchedDeny}};
    }

    const matchedAsk = findMatch(call, policy.ask, options, 'direct');
    if (matchedAsk) {
      return {decision: 'ask', matched: {bucket: 'ask', ...matchedAsk}};
    }

    const allow = findMatch(call, policy.allow, options, 'direct');
    if (allow) {
      matchedAllow ??= allow;
      continue;
    }

    if (defaultDecision !== 'allow') {
      return {decision: defaultDecision, matched: null};
    }
  }

  if (matchedAllow) {
    return {decision: 'allow', matched: {bucket: 'allow', ...matchedAllow}};
  }

  return {decision: defaultDecision, matched: null};
}

function buildSourceList(
  options: PermissionPolicyOptions,
): PermissionSourceRecord[] {
  const list: PermissionSourceRecord[] = [];
  for (const policyFile of options.policyFiles ?? []) {
    list.push({scope: 'explicit', path: path.resolve(policyFile)});
  }

  addCodaraSources(list, options);

  const seen = new Set<string>();
  return list.filter((item) => {
    const resolved = path.resolve(item.path);
    if (seen.has(resolved)) {
      return false;
    }
    seen.add(resolved);
    item.path = resolved;
    return true;
  });
}

function isPathScopedTool(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return normalized === 'read' || normalized === 'write' || normalized === 'edit';
}

function resolveCallPathBase(options: PermissionPolicyOptions): string {
  return path.resolve(options.cwd ?? resolvePermissionProjectRoot(options));
}

function resolveRulePathBase(
  scope: string,
  settingsPath: string,
  options: PermissionPolicyOptions,
): string {
  switch (scope) {
    case 'codara_local':
    case 'codara_project':
      return resolvePermissionProjectRoot(options);
    case 'codara_user':
      return resolveUserHome(options);
    default:
      return path.dirname(settingsPath);
  }
}

function normalizePermissionPathSpecifier(
  specifier: string | undefined,
  resolveFrom: string,
  projectRoot: string,
): CanonicalPathPattern | undefined {
  const raw = specifier?.trim();
  if (!raw) {
    return undefined;
  }

  if (raw === '*') {
    return {value: '*', isDirectory: false};
  }

  const isDirectory = raw.endsWith('/') || raw.endsWith('\\');
  const resolved = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(resolveFrom, raw);

  let canonical = canonicalizePermissionPath(resolved, projectRoot);
  if (isDirectory) {
    canonical = ensureDirectoryPattern(canonical);
  }

  return {
    value: canonical,
    isDirectory,
  };
}

function canonicalizePermissionPath(targetPath: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, targetPath);
  if (relative === '') {
    return '.';
  }

  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return toPosixPath(relative);
  }

  return toPosixPath(path.resolve(targetPath));
}

function derivePermissionPathScopeSpecifier(specifier: string): string | undefined {
  const normalized = specifier.trim();
  if (!normalized || normalized === '*') {
    return undefined;
  }

  if (normalized.endsWith('/') || normalized.endsWith('\\')) {
    return ensureDirectoryPattern(normalized.replace(/\\/g, '/'));
  }

  const value = normalized.replace(/\\/g, '/');
  const directory = path.posix.dirname(value);
  if (!directory || directory === '.') {
    return './';
  }

  return ensureDirectoryPattern(directory);
}

function deriveParentPermissionPathScopeSpecifier(specifier: string): string | undefined {
  const normalized = specifier.endsWith('/') ? specifier.slice(0, -1) : specifier;
  return derivePermissionPathScopeSpecifier(normalized);
}

function ensureDirectoryPattern(value: string): string {
  const normalized = value === '.' ? './' : value;
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function deriveSingleBashPathScopeTarget(
  commandSpecifier: string | null,
  options: PermissionPolicyOptions,
): BashPermissionPathTarget | undefined {
  if (!commandSpecifier) {
    return undefined;
  }

  const targets = analyzeBashPermissionPathTargets(commandSpecifier, options);
  if (targets.length !== 1) {
    return undefined;
  }

  return targets[0];
}

function analyzeBashPermissionPathTargets(
  commandSpecifier: string,
  options: PermissionPolicyOptions,
): BashPermissionPathTarget[] {
  const normalized = normalizeBashCommandForMatching(commandSpecifier);
  if (!normalized || normalized.complex || normalized.hasRedirection) {
    return [];
  }

  const commandName = normalized.commandName;
  const args = normalized.args;
  if (!commandName) {
    return [];
  }

  switch (commandName) {
    case 'mkdir':
      return buildBashPathTargets(args, options, {
        tool: 'Write',
        mode: 'parent',
        directoryTargets: true,
        optionValueFlags: ['-m', '--mode'],
      });
    case 'touch':
      return buildBashPathTargets(args, options, {
        tool: 'Write',
        mode: 'parent',
        optionValueFlags: ['-a', '-m', '-c', '-r', '--reference', '-d', '--date', '-t'],
      });
    case 'rm':
    case 'rmdir':
    case 'unlink':
      return buildBashPathTargets(args, options, {
        tool: 'Write',
        mode: 'parent',
        directoryTargets: commandName === 'rmdir',
      });
    default:
      return [];
  }
}

function buildBashPathTargets(
  args: string[],
  options: PermissionPolicyOptions,
  config: {
    tool: BashPermissionPathTarget['tool'];
    mode: 'self' | 'parent';
    directoryTargets?: boolean;
    optionValueFlags?: string[];
  },
): BashPermissionPathTarget[] {
  const operands = collectShellPathOperands(args, new Set(config.optionValueFlags ?? []));
  if (operands.length === 0) {
    return [];
  }

  const resolveFrom = resolveCallPathBase(options);
  const projectRoot = resolvePermissionProjectRoot(options);
  const targets: BashPermissionPathTarget[] = [];
  const seen = new Set<string>();

  for (const operand of operands) {
    const target = createBashPathTarget(operand, resolveFrom, projectRoot, config);
    if (!target) {
      continue;
    }

    const key = `${target.tool}:${target.specifier}:${target.scopeSpecifier}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    targets.push(target);
  }

  return targets;
}

function createBashPathTarget(
  operand: string,
  resolveFrom: string,
  projectRoot: string,
  config: {
    tool: BashPermissionPathTarget['tool'];
    mode: 'self' | 'parent';
    directoryTargets?: boolean;
  },
): BashPermissionPathTarget | undefined {
  const raw = operand.trim();
  if (!raw || raw === '--' || hasWildcardPathSyntax(raw) || raw.startsWith('$')) {
    return undefined;
  }

  const resolved = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(resolveFrom, raw);

  let specifier = canonicalizePermissionPath(resolved, projectRoot);
  if (config.directoryTargets) {
    specifier = ensureDirectoryPattern(specifier);
  }

  const scopeSpecifier = config.mode === 'self'
    ? ensureDirectoryPattern(specifier)
    : deriveParentPermissionPathScopeSpecifier(specifier);
  if (!scopeSpecifier) {
    return undefined;
  }

  return {
    tool: config.tool,
    specifier,
    scopeSpecifier,
  };
}

function collectShellPathOperands(args: string[], optionValueFlags: Set<string>): string[] {
  const operands: string[] = [];
  let skipNext = false;
  let afterDoubleDash = false;

  for (const token of args) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (!afterDoubleDash && token === '--') {
      afterDoubleDash = true;
      continue;
    }

    if (!afterDoubleDash && token.startsWith('-')) {
      if (optionValueFlags.has(token)) {
        skipNext = true;
      }
      continue;
    }

    operands.push(token);
  }

  return operands;
}

function hasWildcardPathSyntax(value: string): boolean {
  return /[*?[\]{}]/.test(value);
}

function addCodaraSources(target: PermissionSourceRecord[], options: PermissionPolicyOptions): void {
  const projectRoot = resolvePermissionProjectRoot(options);
  const userHome = resolveUserHome(options);

  target.push(
    {scope: 'codara_local', path: path.join(projectRoot, '.codara', 'settings.local.json')},
    {scope: 'codara_project', path: path.join(projectRoot, '.codara', 'settings.json')},
    {scope: 'codara_user', path: path.join(userHome, '.codara', 'settings.json')},
  );
}

async function loadSource(source: PermissionSourceRecord): Promise<LoadedPermissionSource> {
  if (!existsSync(source.path)) {
    return {
      scope: source.scope,
      path: source.path,
      exists: false,
      format: null,
      policy: null,
    };
  }

  const parsed = JSON.parse(await readFile(source.path, 'utf8')) as unknown;
  const policy = parsePolicyData(parsed);

  return {
    scope: source.scope,
    path: source.path,
    exists: true,
    format: policy.format,
    policy,
  };
}

function parsePolicyData(parsed: unknown): ParsedPolicy {
  const root = isRecord(parsed) ? parsed : {};
  const permissions = isRecord(root.permissions) ? root.permissions : undefined;

  if (permissions) {
    const nestedRules = isRecord(permissions.rules) ? permissions.rules : undefined;
    if (nestedRules) {
      return {
        format: 'codara_settings',
        allow: normalizeRules(nestedRules.allow),
        ask: normalizeRules(nestedRules.ask),
        deny: normalizeRules(nestedRules.deny),
        defaultDecision: normalizeDefaultDecision(permissions.defaultDecision),
        errors: [
          ...collectRuleValidationErrors(nestedRules, 'permissions.rules'),
          ...collectDefaultDecisionErrors(permissions.defaultDecision, 'permissions.defaultDecision'),
        ],
      };
    }
  }

  const rules = isRecord(root.rules) ? root.rules : undefined;
  if (rules) {
    return {
      format: 'codara',
      allow: normalizeRules(rules.allow),
      ask: normalizeRules(rules.ask),
      deny: normalizeRules(rules.deny),
      defaultDecision: normalizeDefaultDecision(root.defaultDecision),
      errors: [
        ...collectRuleValidationErrors(rules, 'rules'),
        ...collectDefaultDecisionErrors(root.defaultDecision, 'defaultDecision'),
      ],
    };
  }

  const rootAllow = normalizeRules(root.allow);
  const rootAsk = normalizeRules(root.ask);
  const rootDeny = normalizeRules(root.deny);
  if (rootAllow.length || rootAsk.length || rootDeny.length) {
    return {
      format: 'root',
      allow: rootAllow,
      ask: rootAsk,
      deny: rootDeny,
      defaultDecision: normalizeDefaultDecision(root.defaultDecision),
      errors: [
        ...collectRuleValidationErrors(root, ''),
        ...collectDefaultDecisionErrors(
          root.defaultDecision,
          'defaultDecision',
        ),
      ],
    };
  }

  return {
    format: 'unknown',
    allow: [],
    ask: [],
    deny: [],
    defaultDecision: null,
    errors: [],
  };
}

function normalizeRules(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function normalizeDefaultDecision(value: unknown): PermissionDecision | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (normalized === 'allow' || normalized === 'ask' || normalized === 'deny') {
    return normalized;
  }
  return 'ask';
}

function resolvePermissionProjectRoot(options: PermissionPolicyOptions): string {
  return resolveWorkspaceRoot({
    cwd: options.cwd,
    projectRoot: options.projectRoot,
  });
}

function resolveUserHome(options: PermissionPolicyOptions): string {
  return path.resolve(options.userHome ?? os.homedir());
}

export function resolvePermissionSettingsFile(options: PermissionPolicyOptions): string {
  if (options.settingsFile?.trim()) {
    return path.resolve(options.settingsFile);
  }

  return path.join(resolvePermissionProjectRoot(options), '.codara', 'settings.local.json');
}

function resolveSettingsFile(options: PermissionPolicyOptions): string {
  return resolvePermissionSettingsFile(options);
}

function readNormalizedSettingsRecord(
  filePath: string,
): {status: 'missing' | 'invalid' | 'valid'; record: Record<string, unknown>} {
  if (!existsSync(filePath)) {
    return {
      status: 'missing',
      record: createDefaultSettingsRecord(),
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      return {
        status: 'invalid',
        record: createDefaultSettingsRecord(),
      };
    }

    const normalized = normalizeSettingsRecord(parsed);
    const changed = JSON.stringify(parsed) !== JSON.stringify(normalized);

    return {
      status: changed ? 'invalid' : 'valid',
      record: normalized,
    };
  } catch {
    return {
      status: 'invalid',
      record: createDefaultSettingsRecord(),
    };
  }
}

async function loadJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createDefaultSettingsRecord(): Record<string, unknown> {
  return {
    permissions: {
      rules: {
        allow: [...DEFAULT_ALLOWED_PERMISSION_RULES],
        ask: [],
        deny: [],
      },
    },
  };
}

function normalizeSettingsRecord(root: Record<string, unknown>): Record<string, unknown> {
  const normalized = {...root};
  const permissions = isRecord(root.permissions) ? {...root.permissions} : {};
  const rules = isRecord(permissions.rules) ? {...permissions.rules} : {};

  rules.allow = normalizeRules(rules.allow);
  rules.ask = normalizeRules(rules.ask);
  rules.deny = normalizeRules(rules.deny);
  permissions.rules = rules;
  const normalizedDefaultDecision = normalizeDefaultDecision(permissions.defaultDecision);
  if (normalizedDefaultDecision) {
    permissions.defaultDecision = normalizedDefaultDecision;
  } else {
    delete permissions.defaultDecision;
  }
  normalized.permissions = permissions;

  return normalized;
}

function collectRuleValidationErrors(
  container: Record<string, unknown>,
  prefix: string,
): string[] {
  return ['allow', 'ask', 'deny'].flatMap((key) => {
    const value = container[key];
    if (value == null || Array.isArray(value)) {
      return [];
    }

    return [`${prefix ? `${prefix}.` : ''}${key} must be string[]`];
  });
}

function collectDefaultDecisionErrors(value: unknown, field: string): string[] {
  if (value == null || typeof value === 'string') {
    return [];
  }

  return [`${field} must be string`];
}
