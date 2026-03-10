import type {StructuredToolInterface} from '@langchain/core/tools';
import {BashTool, createBashTool} from '@core/tools/builtin/bash';
import {createReadTool, ReadTool} from '@core/tools/builtin/read';
import {createWriteTool, WriteTool} from '@core/tools/builtin/write';
import {createEditTool, EditTool} from '@core/tools/builtin/edit';
import {createGlobTool, GlobTool} from '@core/tools/builtin/glob';
import {createGrepTool, GrepTool} from '@core/tools/builtin/grep';
import {createFetchTool, FetchTool} from '@core/tools/builtin/fetch';
import {createSearchTool, SearchTool} from '@core/tools/builtin/search';
import {withToolExecutionPolicy} from '@core/tools/execution-policy';

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
  /** 默认工作目录，用于 Bash、Glob、Grep。 */
  cwd?: string;
}

/** 创建内置工具列表。 */
export function createBuiltinTools(options: BuiltinToolOptions = {}): StructuredToolInterface[] {
  const cwd = options.cwd ?? process.cwd();

  return [
    withToolExecutionPolicy(createBashTool(cwd), 'serial'),
    withToolExecutionPolicy(createReadTool(), 'parallel_safe'),
    withToolExecutionPolicy(createWriteTool(), 'serial'),
    withToolExecutionPolicy(createEditTool(), 'serial'),
    withToolExecutionPolicy(createGlobTool(cwd), 'parallel_safe'),
    withToolExecutionPolicy(createGrepTool(cwd), 'parallel_safe'),
    withToolExecutionPolicy(createFetchTool(), 'parallel_safe'),
    withToolExecutionPolicy(createSearchTool(), 'parallel_safe'),
  ];
}
