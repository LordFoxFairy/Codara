import type {StructuredToolInterface} from '@langchain/core/tools';
import {createBuiltinTools} from '@engine/tool';
import type {CodaraOptions} from '../types';

export type CodaraToolsOptions = Pick<CodaraOptions, 'builtinTools' | 'cwd' | 'tools'>;

export function createCodaraTools(options: CodaraToolsOptions = {}): StructuredToolInterface[] {
  if (options.builtinTools === false) {
    return [...(options.tools ?? [])];
  }

  const byName = new Map<string, StructuredToolInterface>();
  for (const tool of createBuiltinTools({cwd: options.cwd, extended: true})) {
    byName.set(tool.name, tool);
  }
  for (const tool of options.tools ?? []) {
    byName.set(tool.name, tool);
  }
  return [...byName.values()];
}
