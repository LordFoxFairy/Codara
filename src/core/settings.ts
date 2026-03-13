import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {resolveWorkspaceRoot, type WorkspaceRootOptions} from '@core/shared/workspace';

export interface CodaraSettingsRecord {
  plugins?: {
    installGlobal?: boolean;
  };
  memory?: {
    autoGlobal?: boolean;
  };
}

export interface CodaraSettingsEnvironment extends WorkspaceRootOptions {
  userHome?: string;
}

export interface ScopedCodaraSettings {
  projectRoot: string;
  userHome: string;
  projectPath: string;
  userPath: string;
  project: CodaraSettingsRecord;
  user: CodaraSettingsRecord;
}

export function readCodaraSettings(filePath: string): CodaraSettingsRecord {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }

    return {
      plugins: readPluginSettings(parsed.plugins),
      memory: readMemorySettings(parsed.memory),
    };
  } catch {
    return {};
  }
}

export function loadScopedCodaraSettings(environment: CodaraSettingsEnvironment): ScopedCodaraSettings {
  const projectRoot = resolveWorkspaceRoot({
    cwd: environment.cwd,
    projectRoot: environment.projectRoot,
  });
  const userHome = path.resolve(environment.userHome ?? homedir());
  const projectPath = path.join(projectRoot, '.codara', 'settings.json');
  const userPath = path.join(userHome, '.codara', 'settings.json');

  return {
    projectRoot,
    userHome,
    projectPath,
    userPath,
    project: readCodaraSettings(projectPath),
    user: readCodaraSettings(userPath),
  };
}

export function resolvePluginInstallGlobal(environment: CodaraSettingsEnvironment): boolean {
  const settings = loadScopedCodaraSettings(environment);
  if (typeof settings.project.plugins?.installGlobal === 'boolean') {
    return settings.project.plugins.installGlobal;
  }
  if (typeof settings.user.plugins?.installGlobal === 'boolean') {
    return settings.user.plugins.installGlobal;
  }
  return true;
}

export function resolveAutoMemoryGlobal(environment: CodaraSettingsEnvironment): boolean {
  const settings = loadScopedCodaraSettings(environment);
  if (typeof settings.project.memory?.autoGlobal === 'boolean') {
    return settings.project.memory.autoGlobal;
  }
  if (typeof settings.user.memory?.autoGlobal === 'boolean') {
    return settings.user.memory.autoGlobal;
  }
  return true;
}

function readPluginSettings(value: unknown): CodaraSettingsRecord['plugins'] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...(typeof value.installGlobal === 'boolean' ? {installGlobal: value.installGlobal} : {}),
  };
}

function readMemorySettings(value: unknown): CodaraSettingsRecord['memory'] {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ...(typeof value.autoGlobal === 'boolean' ? {autoGlobal: value.autoGlobal} : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
