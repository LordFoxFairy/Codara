/**
 * Settings source resolution.
 *
 * Defines the priority order of settings sources and resolves their
 * file paths. Later sources override earlier ones during merge.
 */

export const SETTING_SOURCES = [
  'defaults',
  'userSettings',
  'projectSettings',
  'localSettings',
  'envSettings',
] as const;

export type SettingSource = typeof SETTING_SOURCES[number];

export interface ConfigPaths {
  projectRoot: string;
  userHome: string;
}

/** Resolve the file path for each settings source. `null` = not file-backed. */
export function resolveSettingsFilePaths(paths: ConfigPaths) {
  const {projectRoot, userHome} = paths;
  return {
    defaults: null,
    userSettings: `${userHome}/.codara/settings.json`,
    projectSettings: `${projectRoot}/.codara/settings.json`,
    localSettings: `${projectRoot}/.codara/settings.local.json`,
    envSettings: null,
  };
}

/** Human-readable name for a settings source (for diagnostics / UI). */
export function getSettingSourceName(source: SettingSource): string {
  switch (source) {
    case 'defaults': return 'defaults';
    case 'userSettings': return 'user';
    case 'projectSettings': return 'project';
    case 'localSettings': return 'local (gitignored)';
    case 'envSettings': return 'environment';
  }
}
