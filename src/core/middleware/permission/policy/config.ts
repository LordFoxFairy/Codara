/**
 * Permission config loading and rule flattening.
 *
 * Loads rules from settings files and converts hierarchical PermissionConfig
 * into flat PermissionRuleEntry[] lists. Sources are loaded in priority order:
 * explicit -> local -> project -> user.
 */
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {resolveWorkspaceRoot} from '@config/workspace';
import type {
  PermissionAction,
  PermissionConfig,
  PermissionPolicyOptions,
  PermissionRuleEntry,
  PermissionRuleSet,
  PermissionRuleSource,
  PermissionSourceInfo,
} from '../types';

const DEFAULT_ALLOWED_RULES: readonly string[] = [
  'Read(*)', 'Fetch(*)', 'Search(*)', 'Glob(*)', 'Grep(*)',
  'Bash(git status)', 'Bash(git diff *)', 'Bash(git show *)',
  'Bash(git log *)', 'Bash(git branch *)', 'Bash(git rev-parse *)',
  'Bash(git ls-files *)', 'Bash(ls *)', 'Bash(pwd)', 'Bash(cat *)',
  'Bash(head *)', 'Bash(tail *)', 'Bash(wc *)', 'Bash(stat *)',
  'Bash(file *)', 'Bash(find *)', 'Bash(rg *)', 'Bash(grep *)',
] as const;

// ── Rule Loading ────────────────────────────────────────────────────

export async function loadPermissionRules(
  options: PermissionPolicyOptions = {},
): Promise<{ rules: PermissionRuleEntry[]; defaultDecision: PermissionAction; sources: PermissionSourceInfo[] }> {
  const sourceList = buildSourceList(options);
  const loaded = await Promise.all(sourceList.map(loadSource));

  const allRules: PermissionRuleEntry[] = [];
  let defaultDecision: PermissionAction | null = null;

  for (const source of loaded) {
    if (!source.exists) continue;
    allRules.push(...source.rules);
    if (defaultDecision == null && source.defaultDecision != null) defaultDecision = source.defaultDecision;
  }

  return {
    rules: allRules,
    defaultDecision: defaultDecision ?? 'ask',
    sources: loaded.map(({scope, path: p, exists}) => ({scope, path: p, exists})),
  };
}

// ── Config Flattening ───────────────────────────────────────────────

export function flattenConfig(config: PermissionConfig, source: PermissionRuleSource): PermissionRuleEntry[] {
  const rules: PermissionRuleEntry[] = [];
  for (const [permission, value] of Object.entries(config)) {
    if (typeof value === 'string' && isValidAction(value)) {
      rules.push({permission, pattern: '*', action: value, source});
    } else if (isRecord(value)) {
      for (const [pattern, action] of Object.entries(value)) {
        if (typeof action === 'string' && isValidAction(action)) {
          rules.push({permission, pattern, action, source});
        }
      }
    }
  }
  return rules;
}

// ── Legacy Rules Format ─────────────────────────────────────────────

function parseLegacyRules(
  buckets: { allow?: string[]; ask?: string[]; deny?: string[] },
  source: PermissionRuleSource,
): PermissionRuleEntry[] {
  const rules: PermissionRuleEntry[] = [];
  for (const [bucket, entries] of Object.entries(buckets)) {
    if (!Array.isArray(entries)) continue;
    const action = bucket as PermissionAction;
    if (!isValidAction(action)) continue;
    for (const expr of entries) {
      if (typeof expr !== 'string') continue;
      const parsed = parseExpression(expr);
      if (parsed) rules.push({...parsed, action, source});
    }
  }
  return rules;
}

function parseExpression(expression: string): { permission: string; pattern: string } | undefined {
  const text = expression.trim();
  const open = text.indexOf('(');
  if (open < 0) return {permission: text, pattern: '*'};
  if (!text.endsWith(')')) return undefined;
  return {permission: text.slice(0, open).trim(), pattern: text.slice(open + 1, -1) || '*'};
}

// ── Unified Settings Support ────────────────────────────────────────

export function createPermissionRulesFromSettings(
  permissions: { defaultMode?: string; alwaysAllow?: string[]; alwaysDeny?: string[]; alwaysAsk?: string[] } | undefined,
): PermissionRuleSet {
  const source: PermissionRuleSource = {scope: 'settings', path: '<unified-settings>'};
  const rules: PermissionRuleEntry[] = [];

  for (const {entries, action} of [
    {entries: permissions?.alwaysAllow, action: 'allow' as const},
    {entries: permissions?.alwaysDeny, action: 'deny' as const},
    {entries: permissions?.alwaysAsk, action: 'ask' as const},
  ]) {
    if (!entries) continue;
    for (const expr of entries) {
      if (typeof expr !== 'string') continue;
      const parsed = parseExpression(expr);
      if (parsed) rules.push({...parsed, action, source});
    }
  }

  const mode = permissions?.defaultMode;
  const defaultDecision: PermissionAction = (mode === 'bypassPermissions' || mode === 'dontAsk') ? 'allow' : 'ask';
  return {rules, defaultDecision};
}

// ── Source Loading ───────────────────────────────────────────────────

function buildSourceList(options: PermissionPolicyOptions) {
  const list: { scope: string; path: string }[] = [];
  for (const f of options.policyFiles ?? []) list.push({scope: 'explicit', path: path.resolve(f)});

  const root = resolvePermissionProjectRoot(options);
  const home = options.userHome ?? os.homedir();
  list.push(
    {scope: 'codara_local', path: path.join(root, '.codara', 'settings.local.json')},
    {scope: 'codara_project', path: path.join(root, '.codara', 'settings.json')},
    {scope: 'codara_user', path: path.join(home, '.codara', 'settings.json')},
  );

  const seen = new Set<string>();
  return list.filter(item => {
    const resolved = path.resolve(item.path);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    item.path = resolved;
    return true;
  });
}

interface LoadedSource {
  scope: string; path: string; exists: boolean;
  rules: PermissionRuleEntry[]; defaultDecision: PermissionAction | null;
}

async function loadSource(source: { scope: string; path: string }): Promise<LoadedSource> {
  if (!existsSync(source.path)) {
    return {scope: source.scope, path: source.path, exists: false, rules: [], defaultDecision: null};
  }

  try {
    const content = await readFile(source.path, 'utf8');
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed)) return {scope: source.scope, path: source.path, exists: true, rules: [], defaultDecision: null};
    return parseSourceData(parsed, {scope: source.scope, path: source.path});
  } catch {
    return {scope: source.scope, path: source.path, exists: true, rules: [], defaultDecision: null};
  }
}

function parseSourceData(root: Record<string, unknown>, source: PermissionRuleSource): LoadedSource {
  // New format: { permission: { "Read": "allow", "Bash": { "git *": "allow" } } }
  if (isRecord(root.permission)) {
    return {scope: source.scope, path: source.path, exists: true, rules: flattenConfig(root.permission as PermissionConfig, source), defaultDecision: null};
  }

  // Legacy format: { permissions: { rules: { allow: [...] }, defaultDecision: "ask" } }
  if (isRecord(root.permissions)) {
    const p = root.permissions as Record<string, unknown>;
    if (isRecord(p.rules)) {
      const r = p.rules as Record<string, unknown>;
      return {
        scope: source.scope, path: source.path, exists: true,
        rules: parseLegacyRules({allow: toStrArr(r.allow), ask: toStrArr(r.ask), deny: toStrArr(r.deny)}, source),
        defaultDecision: readAction(p.defaultDecision),
      };
    }
  }

  // Root-level legacy: { rules: { allow: [...] } }
  if (isRecord(root.rules)) {
    const r = root.rules as Record<string, unknown>;
    return {
      scope: source.scope, path: source.path, exists: true,
      rules: parseLegacyRules({allow: toStrArr(r.allow), ask: toStrArr(r.ask), deny: toStrArr(r.deny)}, source),
      defaultDecision: readAction(root.defaultDecision),
    };
  }

  // Root-level buckets: { allow: [...], deny: [...] }
  const allow = toStrArr(root.allow), ask = toStrArr(root.ask), deny = toStrArr(root.deny);
  if (allow.length || ask.length || deny.length) {
    return {
      scope: source.scope, path: source.path, exists: true,
      rules: parseLegacyRules({allow, ask, deny}, source),
      defaultDecision: readAction(root.defaultDecision),
    };
  }

  return {scope: source.scope, path: source.path, exists: true, rules: [], defaultDecision: null};
}

// ── Helpers ─────────────────────────────────────────────────────────

function isValidAction(v: string): v is PermissionAction { return v === 'allow' || v === 'ask' || v === 'deny'; }
function isRecord(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function toStrArr(v: unknown): string[] { return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; }
function readAction(v: unknown): PermissionAction | null {
  if (typeof v !== 'string') return null;
  return isValidAction(v.trim()) ? v.trim() as PermissionAction : null;
}

// ── Exports ─────────────────────────────────────────────────────────

export function resolvePermissionProjectRoot(options: PermissionPolicyOptions): string {
  return resolveWorkspaceRoot({cwd: options.cwd, projectRoot: options.projectRoot});
}

export function resolvePermissionSettingsFile(options: PermissionPolicyOptions): string {
  if (options.settingsFile?.trim()) return path.resolve(options.settingsFile);
  return path.join(resolvePermissionProjectRoot(options), '.codara', 'settings.local.json');
}

export function createDefaultSettingsRecord(): Record<string, unknown> {
  return {permissions: {rules: {allow: [...DEFAULT_ALLOWED_RULES], ask: [], deny: []}}};
}

export {DEFAULT_ALLOWED_RULES};
