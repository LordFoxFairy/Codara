import type {StructuredToolInterface} from '@langchain/core/tools';
import {BashTool, createBashTool} from '@capability/tool/builtin/bash';
import {createReadTool, ReadTool} from '@capability/tool/builtin/read';
import {createWriteTool, WriteTool} from '@capability/tool/builtin/write';
import {createEditTool, EditTool} from '@capability/tool/builtin/edit';
import {createGlobTool, GlobTool} from '@capability/tool/builtin/glob';
import {createGrepTool, GrepTool} from '@capability/tool/builtin/grep';
import {createFetchTool, FetchTool} from '@capability/tool/builtin/fetch';
import {createSearchTool, SearchTool} from '@capability/tool/builtin/search';
import {createDiagnosticsTool, DiagnosticsTool} from '@capability/tool/builtin/diagnostics';
import {createMultiEditTool, MultiEditTool} from '@capability/tool/builtin/multi-edit';
import {createNotebookReadTool, NotebookReadTool} from '@capability/tool/builtin/notebook';

export {BashTool, createBashTool};
export {ReadTool, createReadTool};
export {WriteTool, createWriteTool};
export {EditTool, createEditTool};
export {GlobTool, createGlobTool};
export {GrepTool, createGrepTool};
export {FetchTool, createFetchTool};
export {SearchTool, createSearchTool};
export {DiagnosticsTool, createDiagnosticsTool};
export {NotebookReadTool, createNotebookReadTool};
export {MultiEditTool, createMultiEditTool};

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
    createBashTool(cwd),
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createFetchTool(),
    createSearchTool(),
    createDiagnosticsTool(cwd),
    createNotebookReadTool(),
    createMultiEditTool(),
  ];
}
