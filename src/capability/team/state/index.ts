// src/capability/team/state/index.ts — SharedState factory & barrel

export type {SharedState, SharedStateEntry} from './shared-state.js';
export {MemorySharedState} from './memory-shared-state.js';
export {RedisSharedState} from './redis-shared-state.js';
export type {RedisSharedStateConfig} from './redis-shared-state.js';

import type {SharedState} from './shared-state.js';
import {MemorySharedState} from './memory-shared-state.js';
import {RedisSharedState} from './redis-shared-state.js';

export interface SharedStateConfig {
  backend: 'memory' | 'redis';
  redis?: {host: string; port: number; password?: string; db?: number};
}

export const DEFAULT_SHARED_STATE_CONFIG: SharedStateConfig = {
  backend: 'memory',
};

export function createSharedState(config?: SharedStateConfig): SharedState {
  const cfg = config ?? DEFAULT_SHARED_STATE_CONFIG;
  if (cfg.backend === 'redis' && cfg.redis) {
    return new RedisSharedState(cfg.redis);
  }
  return new MemorySharedState();
}
