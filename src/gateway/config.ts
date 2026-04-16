/**
 * @module gateway/config
 *
 * Loads the gateway configuration from `~/.codara/gateway.json`.
 * Returns an empty config if the file is missing or unparseable.
 */

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