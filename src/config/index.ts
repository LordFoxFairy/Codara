// Workspace
export {resolveWorkspaceRoot, createWorkspaceKey, sanitizeSlug} from './workspace';

// Schema & types
export {
  codaraSettingsSchema,
  type CodaraSettings,
  type PermissionMode,
  type HookEventType,
} from './schema';

// Loader
export {
  loadCodaraSettings,
  loadCodaraSettingsFull,
  type LoadSettingsOptions,
  type LoadedSettings,
  type SettingsValidationError,
} from './loader';

// Merge
export {mergeSettings} from './merge';

// Env overlay
export {parseEnvSettings} from './env';

// Cache & watcher
export {SettingsCache} from './cache';
export {SettingsWatcher, type SettingsWatcherOptions} from './watcher';

// CODARA.md loader
export {loadCodaraMd, type CodaraMdResult, type CodaraMdInstruction} from './codara-md';

// File path resolution
export {resolveSettingsFilePaths, type ConfigPaths, SETTING_SOURCES, type SettingSource} from './sources';
