// Legacy exports (preserved for backward compatibility)
export {
  readCodaraSettings,
  loadScopedCodaraSettings,
  resolvePluginInstallGlobal,
} from './settings';
export {resolveWorkspaceRoot} from './workspace';
export {createWorkspaceKey, sanitizeSlug} from './workspace-key';

// New unified config system (P1)
export {codaraSettingsSchema, type CodaraSettings, type PermissionMode, type HookEventType} from './schema';
export {loadCodaraSettings, loadCodaraSettingsFull, type LoadSettingsOptions, type LoadedSettings} from './loader';
export {mergeSettings} from './merge';
export {parseEnvSettings} from './env';
export {SettingsCache} from './cache';
export {SettingsWatcher, type SettingsWatcherOptions} from './watcher';
export {loadCodaraMd, type CodaraMdResult, type CodaraMdInstruction} from './codara-md';
export {resolveSettingsFilePaths, type ConfigPaths} from './sources';
