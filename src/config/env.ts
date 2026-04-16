import type {CodaraSettings} from '@config/schema';
import {permissionModeSchema} from '@config/schema';

/**
 * Environment variable → settings overlay.
 *
 * Each entry maps a `CODARA_*` env var to a partial settings patch.
 * Invalid values are silently ignored (same as Claude Code's approach —
 * env vars are best-effort, never hard errors).
 *
 * This is NOT the same as the `env` field in settings.json (which injects
 * vars into child processes). This maps env vars INTO our own config.
 */
const ENV_MAPPINGS: ReadonlyArray<{
  envKey: string;
  apply: (value: string) => Partial<CodaraSettings>;
}> = [
  {envKey: 'CODARA_MODEL', apply: (v) => ({model: v})},
  {
    envKey: 'CODARA_MAX_TURNS',
    apply: (v) => {
      const n = Number.parseInt(v, 10);
      return Number.isNaN(n) || n <= 0 ? {} : {maxTurns: n};
    },
  },
  {
    envKey: 'CODARA_THEME',
    apply: (v) => {
      if (v === 'light' || v === 'dark' || v === 'auto') return {theme: v};
      return {};
    },
  },
  {
    envKey: 'CODARA_DEFAULT_SHELL',
    apply: (v) => {
      if (v === 'bash' || v === 'zsh' || v === 'powershell') return {defaultShell: v};
      return {};
    },
  },
  {
    envKey: 'CODARA_PERMISSION_MODE',
    apply: (v) => {
      const parsed = permissionModeSchema.safeParse(v);
      return parsed.success ? {permissions: {defaultMode: parsed.data}} : {};
    },
  },
  {
    envKey: 'CODARA_LANGUAGE',
    apply: (v) => (v ? {language: v} : {}),
  },
  {
    envKey: 'CODARA_OUTPUT_STYLE',
    apply: (v) => (v ? {outputStyle: v} : {}),
  },
];

export function parseEnvSettings(): CodaraSettings {
  const result: Record<string, unknown> = {};
  for (const {envKey, apply} of ENV_MAPPINGS) {
    const value = process.env[envKey];
    if (value !== undefined) {
      Object.assign(result, apply(value));
    }
  }
  return result as CodaraSettings;
}
