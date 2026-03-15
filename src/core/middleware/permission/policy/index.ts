/**
 * Permission policy module — replaces the monolithic policy.ts.
 *
 * Re-exports all public API from sub-modules for backwards compatibility.
 */

// Wildcard matching
export {match as wildcardMatch, matchTool, globToRegExp} from './wildcard';

// Config loading
export {
  loadPermissionRules,
  flattenConfig,
  resolvePermissionProjectRoot,
  resolvePermissionSettingsFile,
  createDefaultSettingsRecord,
} from './config';

// Evaluation (last-match-wins)
export {
  evaluatePermissionToolCall,
  evaluatePermissionExpression,
  evaluatePermission,
  formatPermissionExpression,
  parseExpression,
} from './evaluate';

// Persistence
export {
  persistPermissionRule,
  persistAllowedPermission,
  persistPermissionScope,
  ensurePermissionSettingsFile,
  validatePermissionSettings,
  formatPermissionPathScopeExpression,
} from './persist';
