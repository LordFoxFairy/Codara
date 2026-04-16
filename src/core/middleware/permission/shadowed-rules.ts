/**
 * Shadowed rule detection — ported from Claude Code's shadowedRuleDetection.ts.
 *
 * Detects permission rules that are unreachable because a broader rule
 * takes precedence. For example, a tool-wide deny rule for "Bash" makes
 * any specific allow rule like "Bash(git *)" unreachable.
 */
import type {PermissionAction, PermissionRuleEntry} from '@core/middleware/permission/types';

export type ShadowType = 'ask' | 'deny';

export interface UnreachableRule {
  rule: PermissionRuleEntry;
  reason: string;
  shadowedBy: PermissionRuleEntry;
  shadowType: ShadowType;
  fix: string;
}

/**
 * Detect unreachable permission rules in a rule set.
 *
 * An allow rule with a specific pattern is unreachable when a tool-wide
 * deny or ask rule for the same tool exists — the broader rule fires first.
 */
export function detectUnreachableRules(rules: PermissionRuleEntry[]): UnreachableRule[] {
  const unreachable: UnreachableRule[] = [];

  const allowRules = rules.filter(r => r.action === 'allow');
  const denyRules = rules.filter(r => r.action === 'deny');
  const askRules = rules.filter(r => r.action === 'ask');

  for (const allowRule of allowRules) {
    // Only check content-specific allow rules (e.g. "Bash" + "git *")
    if (allowRule.pattern === '*') continue;

    // Check deny shadowing first (more severe — completely blocked)
    const shadowingDeny = findToolWideRule(allowRule.permission, denyRules);
    if (shadowingDeny) {
      unreachable.push({
        rule: allowRule,
        reason: `Blocked by "${shadowingDeny.permission}" deny rule (from ${shadowingDeny.source.scope})`,
        shadowedBy: shadowingDeny,
        shadowType: 'deny',
        fix: `Remove the "${shadowingDeny.permission}" deny rule from ${shadowingDeny.source.scope}, or remove the specific allow rule from ${allowRule.source.scope}`,
      });
      continue; // Don't also report ask-shadowing
    }

    // Check ask shadowing (will always prompt, never auto-allow)
    const shadowingAsk = findToolWideRule(allowRule.permission, askRules);
    if (shadowingAsk) {
      unreachable.push({
        rule: allowRule,
        reason: `Shadowed by "${shadowingAsk.permission}" ask rule (from ${shadowingAsk.source.scope})`,
        shadowedBy: shadowingAsk,
        shadowType: 'ask',
        fix: `Remove the "${shadowingAsk.permission}" ask rule from ${shadowingAsk.source.scope}, or remove the specific allow rule from ${allowRule.source.scope}`,
      });
    }
  }

  return unreachable;
}

/** Find a tool-wide rule (pattern = '*') matching the given permission name. */
function findToolWideRule(
  permission: string,
  rules: PermissionRuleEntry[],
): PermissionRuleEntry | undefined {
  const norm = permission.trim().toLowerCase();
  return rules.find(
    r => r.permission.trim().toLowerCase() === norm && r.pattern === '*',
  );
}
