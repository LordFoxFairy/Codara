import type {CodaraSettings} from '@config/schema';
import {permissionModeSchema} from '@config/schema';

const ENV_MAPPINGS: Record<string, (value: string) => Partial<CodaraSettings>> = {
  CODARA_MODEL: (v) => ({model: v}),
  CODARA_MAX_TURNS: (v) => {
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? {} : {maxTurns: n};
  },
  CODARA_THEME: (v) => {
    if (v === 'light' || v === 'dark' || v === 'auto') return {theme: v};
    return {};
  },
  CODARA_DEFAULT_SHELL: (v) => {
    if (v === 'bash' || v === 'zsh' || v === 'powershell') return {defaultShell: v};
    return {};
  },
  CODARA_PERMISSION_MODE: (v) => {
    const parsed = permissionModeSchema.safeParse(v);
    if (parsed.success) return {permissions: {defaultMode: parsed.data}};
    return {};
  },
};

export function parseEnvSettings(): CodaraSettings {
  const result: Record<string, unknown> = {};
  for (const [envKey, mapper] of Object.entries(ENV_MAPPINGS)) {
    const value = process.env[envKey];
    if (value !== undefined) {
      Object.assign(result, mapper(value));
    }
  }
  return result as CodaraSettings;
}
