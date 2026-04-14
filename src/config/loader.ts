import {readFile} from 'node:fs/promises';
import {codaraSettingsSchema, type CodaraSettings} from '@config/schema';
import {parseEnvSettings} from '@config/env';
import {mergeSettings} from '@config/merge';
import {resolveSettingsFilePaths, type ConfigPaths} from '@config/sources';

export interface LoadSettingsOptions extends ConfigPaths {
  skipEnv?: boolean;
}

export interface LoadedSettings {
  settings: CodaraSettings;
  perSource: Record<string, CodaraSettings>;
  loadedFiles: string[];
}

export async function loadCodaraSettings(options: LoadSettingsOptions): Promise<CodaraSettings> {
  const result = await loadCodaraSettingsFull(options);
  return result.settings;
}

export async function loadCodaraSettingsFull(options: LoadSettingsOptions): Promise<LoadedSettings> {
  const paths = resolveSettingsFilePaths(options);
  const perSource: Record<string, CodaraSettings> = {};
  const loadedFiles: string[] = [];

  perSource.defaults = {};

  perSource.userSettings = await readSettingsFile(paths.userSettings);
  if (Object.keys(perSource.userSettings).length > 0) loadedFiles.push(paths.userSettings);

  perSource.projectSettings = await readSettingsFile(paths.projectSettings);
  if (Object.keys(perSource.projectSettings).length > 0) loadedFiles.push(paths.projectSettings);

  perSource.localSettings = await readSettingsFile(paths.localSettings);
  if (Object.keys(perSource.localSettings).length > 0) loadedFiles.push(paths.localSettings);

  perSource.envSettings = options.skipEnv ? {} : parseEnvSettings();

  const merged = [
    perSource.defaults,
    perSource.userSettings,
    perSource.projectSettings,
    perSource.localSettings,
    perSource.envSettings,
  ].reduce(mergeSettings, {} as CodaraSettings);

  const validated = codaraSettingsSchema.safeParse(merged);
  const settings = validated.success ? validated.data : lenientParse(merged);

  return {settings, perSource, loadedFiles};
}

async function readSettingsFile(filePath: string): Promise<CodaraSettings> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as CodaraSettings;
  } catch {
    return {};
  }
}

function lenientParse(raw: unknown): CodaraSettings {
  if (typeof raw !== 'object' || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  if (typeof obj.model === 'string') result.model = obj.model;
  if (typeof obj.maxTurns === 'number') result.maxTurns = obj.maxTurns;
  if (typeof obj.defaultShell === 'string') result.defaultShell = obj.defaultShell;
  if (typeof obj.theme === 'string') result.theme = obj.theme;
  if (typeof obj.permissions === 'object' && obj.permissions !== null) result.permissions = obj.permissions;
  if (typeof obj.mcpServers === 'object' && obj.mcpServers !== null) result.mcpServers = obj.mcpServers;
  if (typeof obj.hooks === 'object' && obj.hooks !== null) result.hooks = obj.hooks;
  if (typeof obj.plugins === 'object' && obj.plugins !== null) result.plugins = obj.plugins;
  return result as CodaraSettings;
}
