/** Unified settings initialization: cache + file watcher. */
import type {CodaraSettings} from '@config/schema';
import {SettingsCache} from '@config/cache';
import {resolveSettingsFilePaths} from '@config/sources';
import {SettingsWatcher} from '@config/watcher';

export interface SettingsInfrastructure {
  settings: CodaraSettings;
  settingsCache: SettingsCache;
  settingsWatcher: SettingsWatcher;
}

/** Load settings from all sources and start a file watcher for hot reload. */
export async function initSettings(projectRoot: string, userHome: string): Promise<SettingsInfrastructure> {
  const settingsCache = new SettingsCache({projectRoot, userHome, skipEnv: false});
  const settings = await settingsCache.get();

  const settingsFilePaths = resolveSettingsFilePaths({projectRoot, userHome});
  const settingsWatcher = new SettingsWatcher({
    watchPaths: Object.values(settingsFilePaths).filter((p): p is string => p !== null),
    onChange: () => void settingsCache.invalidate(),
  });
  settingsWatcher.start().catch(() => {/* ignore watch failures */});

  return {settings, settingsCache, settingsWatcher};
}
