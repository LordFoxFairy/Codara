/**
 * Configuration loading and rule flattening.
 *
 * Loads permission config from settings files and converts the
 * hierarchical PermissionConfig format into a flat PermissionRule[] list.
 */
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveWorkspaceRoot} from '@core/config/workspace';
import type {
  PermissionAction,
  PermissionConfig,
  PermissionPolicyOptions,
  PermissionRuleEntry,
  PermissionRuleSource,
  PermissionSourceInfo,
} from '../types';

const DEFAULT_ALLOWED_RULES: readonly string[] = [
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

interface SourceRecord {
  scope: string;
  path: string;
}

interface LoadedSource {
  scope: string;
  path: string;
  exists: boolean;
  rules: PermissionRuleEntry[];
  defaultDecision: PermissionAction | null;
  errors: string[];
}

/**
 * Load all permission rules from config sources, flattened into order.
 * Sources are loaded in priority order: explicit → local → project → user.
 * Rules from earlier sources come first; within a source, rules preserve
 * their declaration order.
 */
export async function loadPermissionRules(
  options: PermissionPolicyOptions = {},
): Promise<{
  rules: PermissionRuleEntry[];
  defaultDecision: PermissionAction;
  sources: PermissionSourceInfo[];
}> {
  const sourceList = buildSourceList(options);
  const loaded = await Promise.all(sourceList.map(loadSource));

  const allRules: PermissionRuleEntry[] = [];
  let defaultDecision: PermissionAction | null = null;

  for (const source of loaded) {
    if (!source.exists) continue;
    allRules.push(...source.rules);
    if (defaultDecision == null && source.defaultDecision != null) {
      defaultDecision = source.defaultDecision;
    }
  }

  return {
    rules: allRules,
    defaultDecision: defaultDecision ?? 'ask',
    sources: loaded.map(({scope, path: p, exists}) => ({scope, path: p, exists})),
  };
}

/**
 * Flatten a PermissionConfig object into PermissionRuleEntry[].
 *
 * Supports two formats:
 * - Flat:   { "Read": "allow" }           → rule: { permission: "Read", pattern: "*", action: "allow" }
 * - Nested: { "Bash": { "git *": "allow" } } → rule: { permission: "Bash", pattern: "git *", action: "allow" }
 */
export function flattenConfig(
  config: PermissionConfig,
  source: PermissionRuleSource,
): PermissionRuleEntry[] {
  const rules: PermissionRuleEntry[] = [];

  for (const [permission, value] of Object.entries(config)) {
    if (typeof value === 'string' && isValidAction(value)) {
      rules.push({permission, pattern: '*', action: value, source});
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      for (const [pattern, action] of Object.entries(value)) {
        if (typeof action === 'string' && isValidAction(action)) {
          rules.push({permission, pattern, action, source});
        }
      }
    }
  }

  return rules;
}

/**
 * Parse legacy rules format (string[] in allow/ask/deny buckets)
 * into PermissionRuleEntry[].
 */
function parseLegacyRules(
  buckets: { allow?: string[]; ask?: string[]; deny?: string[] },
  source: PermissionRuleSource,
): PermissionRuleEntry[] {
  const rules: PermissionRuleEntry[] = [];

  for (const [bucket, entries] of Object.entries(buckets)) {
    if (!Array.isArray(entries)) continue;
    const action = bucket as PermissionAction;
    if (!isValidAction(action)) continue;

    for (const expression of entries) {
      if (typeof expression !== 'string') continue;
      const parsed = parseExpression(expression);
      if (parsed) {
        rules.push({...parsed, action, source});
      }
    }
  }

  return rules;
}

/**
 * Parse a tool expression like "Bash(git *)" into permission + pattern.
 */
function parseExpression(expression: string): { permission: string; pattern: string } | undefined {
  const text = expression.trim();
  const openIndex = text.indexOf('(');
  if (openIndex < 0) {
    return {permission: text, pattern: '*'};
  }
  if (!text.endsWith(')')) {
    return undefined;
  }
  return {
    permission: text.slice(0, openIndex).trim(),
    pattern: text.slice(openIndex + 1, -1) || '*',
  };
}

function isValidAction(value: string): value is PermissionAction {
  return value === 'allow' || value === 'ask' || value === 'deny';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function buildSourceList(options: PermissionPolicyOptions): SourceRecord[] {
  const list: SourceRecord[] = [];

  for (const policyFile of options.policyFiles ?? []) {
    list.push({scope: 'explicit', path: path.resolve(policyFile)});
  }

  const projectRoot = resolvePermissionProjectRoot(options);
  const userHome = resolveUserHome(options);
  list.push(
    {scope: 'codara_local', path: path.join(projectRoot, '.codara', 'settings.local.json')},
    {scope: 'codara_project', path: path.join(projectRoot, '.codara', 'settings.json')},
    {scope: 'codara_user', path: path.join(userHome, '.codara', 'settings.json')},
  );

  // Deduplicate by resolved path
  const seen = new Set<string>();
  return list.filter((item) => {
    const resolved = path.resolve(item.path);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    item.path = resolved;
    return true;
  });
}

async function loadSource(source: SourceRecord): Promise<LoadedSource> {
  if (!existsSync(source.path)) {
    return {scope: source.scope, path: source.path, exists: false, rules: [], defaultDecision: null, errors: []};
  }

  try {
    const content = await readFile(source.path, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) {
      return {scope: source.scope, path: source.path, exists: true, rules: [], defaultDecision: null, errors: ['invalid JSON root']};
    }

    return parseSourceData(parsed, {scope: source.scope, path: source.path});
  } catch (error) {
    return {
      scope: source.scope,
      path: source.path,
      exists: true,
      rules: [],
      defaultDecision: null,
      errors: [`parse error: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}

function parseSourceData(
  root: Record<string, unknown>,
  source: PermissionRuleSource,
): LoadedSource {
  const errors: string[] = [];
  let rules: PermissionRuleEntry[] = [];
  let defaultDecision: PermissionAction | null = null;

  // Try new format: { permission: { "Read": "allow", "Bash": { "git *": "allow" } } }
  const permissionBlock = isRecord(root.permission) ? root.permission : undefined;
  if (permissionBlock) {
    const config = permissionBlock as PermissionConfig;
    rules = flattenConfig(config, source);
    return {scope: source.scope, path: source.path, exists: true, rules, defaultDecision, errors};
  }

  // Try legacy format: { permissions: { rules: { allow: [...], deny: [...] }, defaultDecision: "ask" } }
  const permissions = isRecord(root.permissions) ? root.permissions : undefined;
  if (permissions) {
    const nestedRules = isRecord(permissions.rules) ? permissions.rules : undefined;
    if (nestedRules) {
      rules = parseLegacyRules(
        {
          allow: normalizeStringArray(nestedRules.allow),
          ask: normalizeStringArray(nestedRules.ask),
          deny: normalizeStringArray(nestedRules.deny),
        },
        source,
      );
      defaultDecision = readDefaultDecision(permissions.defaultDecision);
      return {scope: source.scope, path: source.path, exists: true, rules, defaultDecision, errors};
    }
  }

  // Try root-level legacy: { rules: { allow: [...] } }
  const rootRules = isRecord(root.rules) ? root.rules : undefined;
  if (rootRules) {
    rules = parseLegacyRules(
      {
        allow: normalizeStringArray(rootRules.allow),
        ask: normalizeStringArray(rootRules.ask),
        deny: normalizeStringArray(rootRules.deny),
      },
      source,
    );
    defaultDecision = readDefaultDecision(root.defaultDecision);
    return {scope: source.scope, path: source.path, exists: true, rules, defaultDecision, errors};
  }

  // Try root-level buckets: { allow: [...], deny: [...] }
  const rootAllow = normalizeStringArray(root.allow);
  const rootAsk = normalizeStringArray(root.ask);
  const rootDeny = normalizeStringArray(root.deny);
  if (rootAllow.length || rootAsk.length || rootDeny.length) {
    rules = parseLegacyRules({allow: rootAllow, ask: rootAsk, deny: rootDeny}, source);
    defaultDecision = readDefaultDecision(root.defaultDecision);
  }

  return {scope: source.scope, path: source.path, exists: true, rules, defaultDecision, errors};
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readDefaultDecision(value: unknown): PermissionAction | null {
  if (typeof value !== 'string') return null;
  return isValidAction(value.trim()) ? (value.trim() as PermissionAction) : null;
}

export function resolvePermissionProjectRoot(options: PermissionPolicyOptions): string {
  return resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});
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

/**
 * Create default settings record for a new settings file.
 */
export function createDefaultSettingsRecord(): Record<string, unknown> {
  return {
    permissions: {
      rules: {
        allow: [...DEFAULT_ALLOWED_RULES],
        ask: [],
        deny: [],
      },
    },
  };
}

export {DEFAULT_ALLOWED_RULES};
