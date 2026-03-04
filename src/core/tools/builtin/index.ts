import type {StructuredToolInterface} from '@langchain/core/tools';
import {BashTool, createBashTool} from '@core/tools/builtin/bash';
import {createReadTool, ReadTool} from '@core/tools/builtin/read';
import {createWriteTool, WriteTool} from '@core/tools/builtin/write';
import {createEditTool, EditTool} from '@core/tools/builtin/edit';
import {createGlobTool, GlobTool} from '@core/tools/builtin/glob';
import {createGrepTool, GrepTool} from '@core/tools/builtin/grep';
import {createFetchTool, FetchTool} from '@core/tools/builtin/fetch';
import {createSearchTool, SearchTool} from '@core/tools/builtin/search';

export {BashTool, createBashTool};
export {ReadTool, createReadTool};
export {WriteTool, createWriteTool};
export {EditTool, createEditTool};
export {GlobTool, createGlobTool};
export {GrepTool, createGrepTool};
export {FetchTool, createFetchTool};
export {SearchTool, createSearchTool};

/**
 * 内置工具配置选项。
 */
export interface BuiltinToolOptions {
  /** 默认工作目录，用于 Bash、Glob、Grep 工具 */
  cwd?: string;
}

/**
 * 创建所有内置工具的数组。
 *
 * @param options - 配置选项
 * @returns 内置工具数组
 *
 * @example
 * ```typescript
 * const tools = createBuiltinTools({ cwd: '/project/root' });
 * const agent = createReactAgent({ llm: model, tools });
 * ```
 */
export function createBuiltinTools(options: BuiltinToolOptions = {}): StructuredToolInterface[] {
  const cwd = options.cwd ?? process.cwd();

  return [
    createBashTool(cwd),
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createFetchTool(),
    createSearchTool(),
  ];
}
