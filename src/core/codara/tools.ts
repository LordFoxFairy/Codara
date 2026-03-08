import type {StructuredToolInterface} from '@langchain/core/tools';
import {createBuiltinTools} from '@core/tools';
import type {CreateCodaraToolsOptions} from '@core/codara/types';

/** 构建 Codara 默认工具集合。 */
export function createCodaraTools(options: CreateCodaraToolsOptions = {}): StructuredToolInterface[] {
  const extraTools = options.tools ?? [];
  if (options.builtinTools === false) {
    return [...extraTools];
  }

  const builtinTools = createBuiltinTools({cwd: options.cwd});
  const byName = new Map<string, StructuredToolInterface>();

  for (const tool of builtinTools) {
    byName.set(tool.name, tool);
  }

  for (const tool of extraTools) {
    byName.set(tool.name, tool);
  }

  return Array.from(byName.values());
}
