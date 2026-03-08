import type {StructuredToolInterface} from '@langchain/core/tools';
import {createBuiltinTools} from '@core/tools';
import type {CreateCodaraToolsOptions} from '@core/codara/types';
import {createRememberMemoryTool} from '@core/codara/memory-tool';

/** 构建 Codara 默认工具集合。 */
export function createCodaraTools(options: CreateCodaraToolsOptions = {}): StructuredToolInterface[] {
  const extraTools = options.tools ?? [];
  if (options.builtinTools === false) {
    return [...extraTools];
  }

  const builtinTools = withCodaraBuiltinTools(createBuiltinTools({cwd: options.cwd}), options);
  const byName = new Map<string, StructuredToolInterface>();

  for (const tool of builtinTools) {
    byName.set(tool.name, tool);
  }

  for (const tool of extraTools) {
    byName.set(tool.name, tool);
  }

  return Array.from(byName.values());
}

function withCodaraBuiltinTools(
  builtinTools: StructuredToolInterface[],
  options: Pick<CreateCodaraToolsOptions, 'cwd' | 'memory'>
): StructuredToolInterface[] {
  const memoryTool = createRememberMemoryTool(options);
  const editIndex = builtinTools.findIndex((tool) => tool.name === 'edit_file');

  if (editIndex < 0) {
    return [...builtinTools, memoryTool];
  }

  return [
    ...builtinTools.slice(0, editIndex + 1),
    memoryTool,
    ...builtinTools.slice(editIndex + 1),
  ];
}
