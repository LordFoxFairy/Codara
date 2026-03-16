import type {StructuredToolInterface} from '@langchain/core/tools';
import {BashTool, createBashTool} from '@capability/tool/builtin/bash';
import {createReadTool, ReadTool} from '@capability/tool/builtin/read';
import {createWriteTool, WriteTool} from '@capability/tool/builtin/write';
import {createEditTool, EditTool} from '@capability/tool/builtin/edit';
import {createGlobTool, GlobTool} from '@capability/tool/builtin/glob';
import {createGrepTool, GrepTool} from '@capability/tool/builtin/grep';
import {createFetchTool, FetchTool} from '@capability/tool/builtin/fetch';
import {createSearchTool, SearchTool} from '@capability/tool/builtin/search';

// 扩展工具 — 不在核心 createBuiltinTools() 中，需要显式引入
import {createDiagnosticsTool, DiagnosticsTool} from '@capability/tool/extended/diagnostics';
import {createNotebookReadTool, NotebookReadTool} from '@capability/tool/extended/notebook';

export {BashTool, createBashTool};
export {ReadTool, createReadTool};
export {WriteTool, createWriteTool};
export {EditTool, createEditTool};
export {GlobTool, createGlobTool};
export {GrepTool, createGrepTool};
export {FetchTool, createFetchTool};
export {SearchTool, createSearchTool};

// 扩展工具导出
export {DiagnosticsTool, createDiagnosticsTool};
export {NotebookReadTool, createNotebookReadTool};

/**
 * 内置工具配置选项。
 */
export interface BuiltinToolOptions {
  /** 默认工作目录，用于 Bash、Glob、Grep。 */
  cwd?: string;
  /** 是否包含扩展工具（diagnostics, notebook_read）。默认 false。 */
  extended?: boolean;
}

/** 创建核心内置工具列表。 */
export function createBuiltinTools(options: BuiltinToolOptions = {}): StructuredToolInterface[] {
  const cwd = options.cwd ?? process.cwd();

  const core: StructuredToolInterface[] = [
    createBashTool(cwd),
    createReadTool(),
    createWriteTool(),
    createEditTool(),
    createGlobTool(cwd),
    createGrepTool(cwd),
    createFetchTool(),
    createSearchTool(),
  ];

  if (options.extended) {
    core.push(
      createDiagnosticsTool(cwd),
      createNotebookReadTool(),
    );
  }

  return core;
}
