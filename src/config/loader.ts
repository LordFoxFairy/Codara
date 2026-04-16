import {readFile} from 'node:fs/promises';
import {codaraSettingsSchema, type CodaraSettings} from '@config/schema';
import {parseEnvSettings} from '@config/env';
import {mergeSettings} from '@config/merge';
import {resolveSettingsFilePaths, type ConfigPaths} from '@config/sources';
import type {ZodError} from 'zod';

export interface LoadSettingsOptions extends ConfigPaths {
  skipEnv?: boolean;
}

/** Structured validation error — mirrors Claude Code's ValidationError. */
export interface SettingsValidationError {
  file?: string;
  path: string;
  message: string;
}

export interface LoadedSettings {
  settings: CodaraSettings;
  perSource: Record<string, CodaraSettings>;
  loadedFiles: string[];
  /** Validation errors encountered during loading (non-fatal). */
  errors: SettingsValidationError[];
}

export async function loadCodaraSettings(options: LoadSettingsOptions): Promise<CodaraSettings> {
  const result = await loadCodaraSettingsFull(options);
  return result.settings;
}

export async function loadCodaraSettingsFull(options: LoadSettingsOptions): Promise<LoadedSettings> {
  const paths = resolveSettingsFilePaths(options);
  const perSource: Record<string, CodaraSettings> = {};
  const loadedFiles: string[] = [];
  const errors: SettingsValidationError[] = [];

  perSource.defaults = {};

  perSource.userSettings = await readSettingsFile(paths.userSettings, errors);
  if (Object.keys(perSource.userSettings).length > 0) loadedFiles.push(paths.userSettings);

  perSource.projectSettings = await readSettingsFile(paths.projectSettings, errors);
  if (Object.keys(perSource.projectSettings).length > 0) loadedFiles.push(paths.projectSettings);

  perSource.localSettings = await readSettingsFile(paths.localSettings, errors);
  if (Object.keys(perSource.localSettings).length > 0) loadedFiles.push(paths.localSettings);

  perSource.envSettings = options.skipEnv ? {} : parseEnvSettings();

  const merged = [
    perSource.defaults,
    perSource.userSettings,
    perSource.projectSettings,
    perSource.localSettings,
    perSource.envSettings,
  ].reduce(mergeSettings, {} as CodaraSettings);

  // Validate merged settings with .passthrough() — unknown fields are preserved,
  // invalid fields produce errors but don't reject the entire config.
  const validated = codaraSettingsSchema.safeParse(merged);
  let settings: CodaraSettings;
  if (validated.success) {
    settings = validated.data;
  } else {
    errors.push(...formatZodErrors(validated.error, 'merged settings'));
    // Use the raw merged object — passthrough schema means known-valid fields
    // coexist with unknown ones. Better than throwing away everything.
    settings = merged;
  }

  return {settings, perSource, loadedFiles, errors};
}

async function readSettingsFile(
  filePath: string,
  errors: SettingsValidationError[],
): Promise<CodaraSettings> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    errors.push({file: filePath, path: '', message: 'Invalid JSON syntax'});
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push({file: filePath, path: '', message: 'Settings file must be a JSON object'});
    return {};
  }

  // Validate individual file against schema for early error reporting.
  const result = codaraSettingsSchema.safeParse(parsed);
  if (!result.success) {
    errors.push(...formatZodErrors(result.error, filePath));
    // Return raw parsed data — passthrough schema preserves unknown fields,
    // and partial valid data is better than nothing.
    return parsed as CodaraSettings;
  }

  return result.data;
}

function formatZodErrors(error: ZodError, file: string): SettingsValidationError[] {
  return error.issues.map((issue) => ({
    file,
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}
