import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import type {GatewayConfig} from './types';

export async function loadGatewayConfig(configPath?: string): Promise<GatewayConfig> {
  const filePath = configPath ?? path.join(homedir(), '.codara', 'gateway.json');
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as GatewayConfig;
  } catch {
    return {channels: {}};
  }
}

export function expandEnvVars(value: string): string {
  return value.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? '');
}
