/**
 * Hook system initialization: registry + pipeline.
 *
 * Reads hook definitions from unified settings (preferred) or falls back
 * to legacy per-file hooks.json sources.
 */
import path from 'node:path';
import type {CodaraSettings} from '@config/schema';
import {HookRegistryImpl, HookPipeline, createHookExecutor} from '@observability/hook';
import type {HookSource, HookRegistry} from '@observability/hook';

export interface HooksInfrastructure {
  hookRegistry: HookRegistry;
  hookPipeline: HookPipeline;
}

/** Load hook definitions and create the execution pipeline. */
export async function initHooks(
  settings: CodaraSettings,
  runtimeStatePath: string,
  userHome: string,
  codaraPath: string,
): Promise<HooksInfrastructure> {
  const hookRegistry = new HookRegistryImpl();

  if (settings.hooks && Object.keys(settings.hooks).length > 0) {
    // Filter out event types with undefined/empty hook arrays
    const defined: Record<string, Array<{matcher?: {toolName?: string | string[]; commandPattern?: string}; command?: string; prompt?: string; timeout?: number}>> = {};
    for (const [key, value] of Object.entries(settings.hooks)) {
      if (value && value.length > 0) defined[key] = value;
    }
    if (Object.keys(defined).length > 0) hookRegistry.loadFromSettings(defined);
  } else {
    const hookSources: HookSource[] = [{kind: 'project', path: path.join(runtimeStatePath, 'hooks.json')}];
    if (userHome) hookSources.push({kind: 'user', path: path.join(userHome, '.codara', 'hooks.json')});
    await hookRegistry.load(hookSources);
  }

  const hookPipeline = new HookPipeline(hookRegistry, {
    createStrategy: (hook) => createHookExecutor(hook, {projectRoot: codaraPath}),
  });

  return {hookRegistry, hookPipeline};
}
