import type {StructuredToolInterface} from '@langchain/core/tools';
<<<<<<<< HEAD:src/engine/tool/builtin/index.ts
import {BashTool, createBashTool} from '@engine/tool/builtin/bash';
import {createReadTool, ReadTool} from '@engine/tool/builtin/read';
import {createWriteTool, WriteTool} from '@engine/tool/builtin/write';
import {createEditTool, EditTool} from '@engine/tool/builtin/edit';
import {createGlobTool, GlobTool} from '@engine/tool/builtin/glob';
import {createGrepTool, GrepTool} from '@engine/tool/builtin/grep';
import {createFetchTool, FetchTool} from '@engine/tool/builtin/fetch';
import {createSearchTool, SearchTool} from '@engine/tool/builtin/search';

// 扩展工具 — 不在核心 createBuiltinTools() 中，需要显式引入
import {createNotebookReadTool, NotebookReadTool} from '@engine/tool/extended/notebook';
========
import {BashTool, createBashTool} from '@integration/tool/builtin/bash';
import {createReadTool, ReadTool} from '@integration/tool/builtin/read';
import {createWriteTool, WriteTool} from '@integration/tool/builtin/write';
import {createEditTool, EditTool} from '@integration/tool/builtin/edit';
import {createGlobTool, GlobTool} from '@integration/tool/builtin/glob';
import {createGrepTool, GrepTool} from '@integration/tool/builtin/grep';
import {createFetchTool, FetchTool} from '@integration/tool/builtin/fetch';
import {createSearchTool, SearchTool} from '@integration/tool/builtin/search';

// 扩展工具 — 不在核心 createBuiltinTools() 中，需要显式引入
import {createNotebookReadTool, NotebookReadTool} from '@integration/tool/extended/notebook';
>>>>>>>> origin/main:src/integration/tool/builtin/index.ts
import {
  createEnterWorktreeTool,
  createExitWorktreeTool,
  createListWorktreesTool,
  EnterWorktreeTool,
  ExitWorktreeTool,
  ListWorktreesTool,
<<<<<<<< HEAD:src/engine/tool/builtin/index.ts
} from '@engine/tool/extended/worktree';
========
} from '@integration/tool/extended/worktree';
>>>>>>>> origin/main:src/integration/tool/builtin/index.ts

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
