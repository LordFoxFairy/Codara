import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const CODARA_PATH_ENV = 'CODARA_PATH';
const CONFIG_FILE_NAME = 'config.json';

function resolveHomeDirectory(): string {
  return process.env.HOME?.trim() || process.env.USERPROFILE?.trim() || homedir().trim();
}

export function resolveHomeCodaraPath(): string {
  return join(resolveHomeDirectory(), '.codara');
}

export function resolveRepoCodaraPath(cwd: string = process.cwd()): string {
  return join(cwd, '.codara');
}

export function hasCodaraConfig(path: string): boolean {
  return existsSync(join(path, CONFIG_FILE_NAME));
}

// 只在 CLI 入口做本地仓库兜底，不改 core 默认的全局配置语义。
export function ensureCliCodaraPath(cwd: string = process.cwd()): string | undefined {
  if (process.env[CODARA_PATH_ENV]?.trim()) {
    return process.env[CODARA_PATH_ENV];
  }

  const homeCodaraPath = resolveHomeCodaraPath();
  if (hasCodaraConfig(homeCodaraPath)) {
    return undefined;
  }

  const repoCodaraPath = resolveRepoCodaraPath(cwd);
  if (!hasCodaraConfig(repoCodaraPath)) {
    return undefined;
  }

  process.env[CODARA_PATH_ENV] = repoCodaraPath;
  return repoCodaraPath;
}
