/**
 * Tools 导出入口 — 内置工具、扩展工具及共用工具函数。
 */

export {
  BashTool,
  createBashTool,
  EditTool,
  createEditTool,
  FetchTool,
  createFetchTool,
  GlobTool,
  createGlobTool,
  GrepTool,
  createGrepTool,
  ReadTool,
  createReadTool,
  SearchTool,
  createSearchTool,
  WriteTool,
  createWriteTool,
  NotebookReadTool,
  createNotebookReadTool,
  EnterWorktreeTool,
  createEnterWorktreeTool,
  ExitWorktreeTool,
  createExitWorktreeTool,
  ListWorktreesTool,
  createListWorktreesTool,
  createBuiltinTools,
  isToolReadOnly,
  type BuiltinToolOptions,
} from '@tools/builtin';
export {filterToolsByReferences, normalizeToolReferenceName} from '@tools/names';
export {
  registerTool,
  getToolEntry,
  getToolPrompt,
  getAllToolEntries,
  getToolsByCategory,
  type ToolCategory,
  type ToolRegistryEntry,
  type ValidationResult,
} from '@tools/registry';
export {
  getBashToolPrompt,
  getReadToolPrompt,
  getEditToolPrompt,
  getWriteToolPrompt,
  getGlobToolPrompt,
  getGrepToolPrompt,
  getFetchToolPrompt,
  getSearchToolPrompt,
} from '@tools/builtin';
export {
  countLines,
  countOccurrences,
  findActualString,
  formatError,
  formatNoResults,
  getErrorCode,
  getErrorMessage,
  isNodeError,
  normalizeQuotes,
  validatePath,
} from '@tools/utils';
