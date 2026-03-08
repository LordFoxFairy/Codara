import type {StructuredToolInterface} from '@langchain/core/tools';
import {createBuiltinTools, createRememberMemoryTool} from '@core/tools';
import type {CreateCodaraToolsOptions} from '@core/codara/types';

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
  const memoryTool = createRememberMemoryTool(resolveMemoryToolOptions(options));
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

function resolveMemoryToolOptions(options: Pick<CreateCodaraToolsOptions, 'cwd' | 'memory'>) {
  if (options.memory === false) {
    return {
      ...(options.cwd ? {cwd: options.cwd} : {}),
    };
  }

  return {
    ...(options.memory?.cwd ?? options.cwd ? {cwd: options.memory?.cwd ?? options.cwd} : {}),
    ...(options.memory?.userHome ? {userHome: options.memory.userHome} : {}),
    ...(options.memory?.projectRoot ? {projectRoot: options.memory.projectRoot} : {}),
    ...(typeof options.memory?.maxChars === 'number' ? {maxChars: options.memory.maxChars} : {}),
  };
}
