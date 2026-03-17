// src/capability/team/state/index.ts — SharedState factory & barrel

export type {SharedState, SharedStateEntry} from './shared-state.js';
export {MemorySharedState} from './memory-shared-state.js';

import type {SharedState} from './shared-state.js';
import {MemorySharedState} from './memory-shared-state.js';

export interface SharedStateConfig {
  backend: 'memory';
}

export const DEFAULT_SHARED_STATE_CONFIG: SharedStateConfig = {
  backend: 'memory',
};

export function createSharedState(_config?: SharedStateConfig): SharedState {
  return new MemorySharedState();
}
