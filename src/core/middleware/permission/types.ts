/**
 * Permission system type definitions
 *
 * Core types for the last-match-wins permission evaluation engine.
 */

/** Permission action that determines what happens with a tool call */
export type PermissionAction = 'allow' | 'ask' | 'deny';

/** A single permission rule: matches a tool+pattern pair to an action */
export interface PermissionRule {
  /** Tool name or glob pattern (e.g. 'Bash', 'Read', '*') */
  permission: string;
  /** Specifier pattern or '*' (e.g. 'git *', '/src/*', '*') */
  pattern: string;
  /** What to do when matched */
  action: PermissionAction;
}

/**
 * Configuration format for settings.json.
 * Supports both flat and nested formats:
 *
 * Flat:  { "Read": "allow", "Bash": "ask" }
 * Nested: { "Bash": { "*": "ask", "git *": "allow" } }
 */
export interface PermissionConfig {
  [permission: string]: PermissionAction | { [pattern: string]: PermissionAction };
}

/** Identifies where a rule was loaded from */
export interface PermissionRuleSource {
  scope: string;
  path: string;
}

/** A rule with its source information */
export interface PermissionRuleEntry extends PermissionRule {
  source: PermissionRuleSource;
}

/** Compact representation of a matched rule for metadata/UI consumption. */
export interface PermissionRuleMatch {
  bucket: PermissionAction;
  rule: string;
  scope: string;
  path: string;
}

/** Result of evaluating a permission expression */
export interface PermissionEvaluationResult {
  /** The expression that was evaluated (e.g. "Bash(git status)") */
  input: string;
  /** Final decision */
  decision: PermissionAction;
  /** The rule that matched, if any */
  matchedRule: PermissionRuleEntry | null;
  /** Compact representation of the matched rule — derived from matchedRule */
  matched: PermissionRuleMatch | null;
  /** Default decision when no rules match */
  defaultDecision: PermissionAction;
  /** All sources that were consulted */
  sources: PermissionSourceInfo[];
  /** Summary of rule counts */
  ruleSummary: {
    total: number;
  };
}

/** Info about a policy source file */
export interface PermissionSourceInfo {
  scope: string;
  path: string;
  exists: boolean;
}

/** Validation result for a settings file */
export interface PermissionValidationResult {
  scope: string;
  path: string;
  exists: boolean;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  errors: string[];
  ruleCount: number;
}

/** Options for policy evaluation */
export interface PermissionPolicyOptions {
  cwd?: string;
  projectRoot?: string;
  userHome?: string;
  policyFiles?: string[];
  settingsFile?: string;
  /** Active permission mode — transforms final decisions before returning */
  permissionMode?: import('@config/schema').PermissionMode;
}

/** A loaded set of permission rules with a default decision */
export interface PermissionRuleSet {
  rules: PermissionRuleEntry[];
  defaultDecision: PermissionAction;
}
