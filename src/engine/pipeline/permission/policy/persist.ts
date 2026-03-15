/**
 * Rule persistence: save/load permission rules to settings files.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {ToolCall} from '@langchain/core/messages';
import type {
  PermissionAction,
  PermissionPolicyOptions,
  PermissionRule,
  PermissionValidationResult,
} from '../types';
import {formatPermissionExpression, parseExpression} from './evaluate';
import {resolvePermissionSettingsFile, resolvePermissionProjectRoot, createDefaultSettingsRecord} from './config';
import {
  extractBashWritePathOperands,
  formatBashToolScopeExpression,
  normalizeBashCommandForMatching,
} from '@engine/pipeline/permission/bash';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Persist a permission rule to the settings file.
 * Maintains backward compatibility with legacy format.
 */
export async function persistPermissionRule(
  toolCallOrExpression: ToolCall | string,
  bucket: PermissionAction,
  options: PermissionPolicyOptions = {},
): Promise<{settingsFile: string; alreadyPresent: boolean; created: boolean}> {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatPermissionExpression(toolCallOrExpression);

  if (!expression) {
    throw new Error('Unsupported permission expression');
  }

  if (bucket !== 'allow' && bucket !== 'ask' && bucket !== 'deny') {
    throw new Error(`Unsupported permission bucket: ${bucket}`);
  }

  const settingsFile = resolvePermissionSettingsFile(options);
  const created = !existsSync(settingsFile);
  const root = await loadJsonRecord(settingsFile);
  const permissions = isRecord(root.permissions) ? {...root.permissions} : {};
  const rules = isRecord(permissions.rules) ? {...permissions.rules} : {};
  const existingRules = Array.isArray(rules[bucket])
    ? rules[bucket].filter((item: unknown): item is string => typeof item === 'string')
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

/**
 * Persist an allowed permission (convenience wrapper).
 */
export async function persistAllowedPermission(
  toolCallOrExpression: ToolCall | string,
  options: PermissionPolicyOptions = {},
): Promise<{settingsFile: string; alreadyPresent: boolean; created: boolean}> {
  return persistPermissionRule(toolCallOrExpression, 'allow', options);
}

/**
 * Persist a permission with scope (exact, path, tool, project).
 */
export async function persistPermissionScope(
  toolCallOrExpression: ToolCall | string,
  scope: 'exact' | 'path' | 'tool' | 'project',
  options: PermissionPolicyOptions = {},
): Promise<{settingsFile: string; alreadyPresent: boolean; created: boolean; rule?: string; defaultDecision?: PermissionAction}> {
  if (scope === 'project') {
    const settingsFile = resolvePermissionSettingsFile(options);
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
    ? formatToolScopeExpression(toolCallOrExpression)
    : scope === 'path'
      ? formatPathScopeExpression(toolCallOrExpression)
      : typeof toolCallOrExpression === 'string'
        ? toolCallOrExpression.trim()
        : formatPermissionExpression(toolCallOrExpression);

  if (!expression) {
    throw new Error('Unsupported permission expression');
  }

  const result = await persistPermissionRule(expression, 'allow', options);
  return {...result, rule: expression};
}

/**
 * Ensure the settings file exists with valid structure.
 */
export function ensurePermissionSettingsFile(
  options: PermissionPolicyOptions = {},
): {settingsFile: string; created: boolean; repaired: boolean} {
  const settingsFile = resolvePermissionSettingsFile(options);
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

/**
 * Validate permission settings files.
 */
export async function validatePermissionSettings(
  options: PermissionPolicyOptions & {targets?: string[]},
): Promise<PermissionValidationResult[]> {
  const targets = options.targets?.length
    ? options.targets.map((target) => ({scope: 'explicit_target', path: path.resolve(target)}))
    : buildBasicSourceList(options);

  const results: PermissionValidationResult[] = [];
  for (const source of targets) {
    if (!existsSync(source.path)) {
      results.push({scope: source.scope, path: source.path, exists: false, status: 'skip', errors: [], ruleCount: 0});
      continue;
    }

    try {
      const content = await readFile(source.path, 'utf8');
      const parsed = JSON.parse(content) as unknown;
      if (!isRecord(parsed)) {
        results.push({scope: source.scope, path: source.path, exists: true, status: 'fail', errors: ['invalid JSON root'], ruleCount: 0});
        continue;
      }
      results.push({scope: source.scope, path: source.path, exists: true, status: 'ok', errors: [], ruleCount: 0});
    } catch (error) {
      results.push({
        scope: source.scope,
        path: source.path,
        exists: true,
        status: 'fail',
        errors: [`invalid JSON: ${error instanceof Error ? error.message : String(error)}`],
        ruleCount: 0,
      });
    }
  }

  return results;
}

// Helper: format tool-scope expression
function formatToolScopeExpression(toolCallOrExpression: ToolCall | string): string | undefined {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatPermissionExpression(toolCallOrExpression);
  if (!expression) return undefined;

  const {permission, specifier} = parseExpression(expression);
  if (!permission) return undefined;

  if (permission.toLowerCase() !== 'bash') {
    return `${permission}(*)`;
  }

  if (!specifier || specifier === '*') {
    return 'Bash(*)';
  }

  return formatBashToolScopeExpression(specifier);
}

// Helper: format path-scope expression
function formatPathScopeExpression(toolCallOrExpression: ToolCall | string): string | undefined {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatPermissionExpression(toolCallOrExpression);
  if (!expression) return undefined;

  const {permission, specifier} = parseExpression(expression);
  if (!permission || !specifier || specifier === '*') return undefined;

  const norm = permission.toLowerCase();
  if (norm !== 'read' && norm !== 'write' && norm !== 'edit') return undefined;

  const dir = derivePathScope(specifier);
  return dir ? `${permission}(${dir})` : undefined;
}

/**
 * Format a path-scope expression for a tool call.
 * File tools: derive directory from file path.
 * Bash tools: derive directory from write target operands.
 */
export function formatPermissionPathScopeExpression(
  toolCallOrExpression: ToolCall | string,
  _options: PermissionPolicyOptions = {},
): string | undefined {
  const expression = typeof toolCallOrExpression === 'string'
    ? toolCallOrExpression.trim()
    : formatPermissionExpression(toolCallOrExpression);
  if (!expression) return undefined;

  const {permission, specifier} = parseExpression(expression);
  if (!permission || !specifier || specifier === '*') return undefined;

  const norm = permission.toLowerCase();

  // File tools: derive directory from file path
  if (norm === 'read' || norm === 'write' || norm === 'edit') {
    const dir = derivePathScope(specifier);
    return dir ? `${permission}(${dir})` : undefined;
  }

  // Bash: extract single write target and derive directory
  if (norm === 'bash') {
    const normalized = normalizeBashCommandForMatching(specifier);
    if (!normalized || normalized.complex) return undefined;

    const targets = extractBashWritePathOperands(specifier);
    if (targets.length !== 1) return undefined;

    const dir = derivePathScope(targets[0]!);
    return dir ? `Write(${dir})` : undefined;
  }

  return undefined;
}

function derivePathScope(specifier: string): string | undefined {
  const normalized = specifier.trim().replace(/\\/g, '/');
  if (!normalized || normalized === '*') return undefined;

  if (normalized.endsWith('/')) return normalized;

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) return './';

  return `${normalized.slice(0, lastSlash + 1)}`;
}

async function loadJsonRecord(filePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(filePath)) return {};
  const content = await readFile(filePath, 'utf8');
  const parsed = JSON.parse(content) as unknown;
  return isRecord(parsed) ? parsed : {};
}

function readNormalizedSettingsRecord(
  filePath: string,
): {status: 'missing' | 'invalid' | 'valid'; record: Record<string, unknown>} {
  if (!existsSync(filePath)) {
    return {status: 'missing', record: createDefaultSettingsRecord()};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      return {status: 'invalid', record: createDefaultSettingsRecord()};
    }

    const normalized = normalizeSettingsRecord(parsed);
    const changed = JSON.stringify(parsed) !== JSON.stringify(normalized);
    return {status: changed ? 'invalid' : 'valid', record: normalized};
  } catch {
    return {status: 'invalid', record: createDefaultSettingsRecord()};
  }
}

function normalizeSettingsRecord(root: Record<string, unknown>): Record<string, unknown> {
  const normalized = {...root};
  const permissions = isRecord(root.permissions) ? {...root.permissions} : {};
  const rules = isRecord(permissions.rules) ? {...permissions.rules} : {};

  rules.allow = normalizeStringArray(rules.allow);
  rules.ask = normalizeStringArray(rules.ask);
  rules.deny = normalizeStringArray(rules.deny);
  permissions.rules = rules;

  if (typeof permissions.defaultDecision === 'string') {
    const d = permissions.defaultDecision.trim();
    if (d === 'allow' || d === 'ask' || d === 'deny') {
      permissions.defaultDecision = d;
    } else {
      delete permissions.defaultDecision;
    }
  } else {
    delete permissions.defaultDecision;
  }

  normalized.permissions = permissions;
  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function buildBasicSourceList(options: PermissionPolicyOptions) {
  const list: {scope: string; path: string}[] = [];
  for (const f of options.policyFiles ?? []) {
    list.push({scope: 'explicit', path: path.resolve(f)});
  }
  const projectRoot = resolvePermissionProjectRoot(options);
  const userHome = options.userHome ?? os.homedir();
  list.push(
    {scope: 'codara_local', path: path.join(projectRoot, '.codara', 'settings.local.json')},
    {scope: 'codara_project', path: path.join(projectRoot, '.codara', 'settings.json')},
    {scope: 'codara_user', path: path.join(userHome, '.codara', 'settings.json')},
  );
  return list;
}
