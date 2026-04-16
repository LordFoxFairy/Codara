/**
 * 内置工具注册中心 — 组装核心 + 扩展工具列表。
 */

import type {StructuredToolInterface} from '@langchain/core/tools';
import {BashTool, createBashTool} from '@tools/builtin/bash';
import {createReadTool, ReadTool} from '@tools/builtin/read';
import {createWriteTool, WriteTool} from '@tools/builtin/write';
import {createEditTool, EditTool} from '@tools/builtin/edit';
import {createGlobTool, GlobTool} from '@tools/builtin/glob';
import {createGrepTool, GrepTool} from '@tools/builtin/grep';
import {createFetchTool, FetchTool} from '@tools/builtin/fetch';
import {createSearchTool, SearchTool} from '@tools/builtin/search';

// 扩展工具 — 不在核心 createBuiltinTools() 中，需要显式引入
import {createNotebookReadTool, NotebookReadTool} from '@tools/extended/notebook';
import {
  createEnterWorktreeTool,
  createExitWorktreeTool,
  createListWorktreesTool,
  EnterWorktreeTool,
  ExitWorktreeTool,
  ListWorktreesTool,
} from '@tools/extended/worktree';

export {BashTool, createBashTool};
export {ReadTool, createReadTool};
export {WriteTool, createWriteTool};
export {EditTool, createEditTool};
export {GlobTool, createGlobTool};
export {GrepTool, createGrepTool};
export {FetchTool, createFetchTool};
export {SearchTool, createSearchTool};

// 扩展工具导出
export {NotebookReadTool, createNotebookReadTool};
export {EnterWorktreeTool, createEnterWorktreeTool};
export {ExitWorktreeTool, createExitWorktreeTool};
export {ListWorktreesTool, createListWorktreesTool};

/** 判断工具是否为只读（不会修改文件系统或外部状态）。 */
export {isToolReadOnly} from '@shared/tool-metadata';

/**
 * 内置工具配置选项。
 */
export interface BuiltinToolOptions {
  /** 默认工作目录，用于 Bash、Glob、Grep。 */
  cwd?: string;
  /** 是否包含扩展工具（notebook_read）。默认 false。 */
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
      createNotebookReadTool(),
      createEnterWorktreeTool(),
      createExitWorktreeTool(),
      createListWorktreesTool(),
    );
  }

  return core;
}
