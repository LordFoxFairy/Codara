export const SETTING_SOURCES = ['defaults', 'userSettings', 'projectSettings', 'localSettings', 'envSettings'] as const;
export type SettingSource = typeof SETTING_SOURCES[number];

export interface ConfigPaths {
  projectRoot: string;
  userHome: string;
}

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
