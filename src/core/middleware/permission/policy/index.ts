/**
 * Permission policy module.
 *
 * Re-exports all public API from sub-modules.
 */

// Config loading
export {
  loadPermissionRules,
  flattenConfig,
  resolvePermissionProjectRoot,
  resolvePermissionSettingsFile,
  createDefaultSettingsRecord,
  createPermissionRulesFromSettings,
} from './config';

// Evaluation (last-match-wins) with 3-layer resolution
export {
  evaluatePermissionToolCall,
  evaluatePermissionExpression,
  formatPermissionExpression,
  parseExpression,
  applyPermissionMode,
  resolvePermissionDecision,
  getDefaultToolDecision,
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
