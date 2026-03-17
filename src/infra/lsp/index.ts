/** LSP 诊断模块导出入口。 */

export {
  type Diagnostic,
  type DiagnosticProvider,
  type DiagnosticResult,
  DiagnosticSeverity,
} from '@infra/lsp/types';

export {
  parseTscOutput,
  parseEslintJsonOutput,
  TypeScriptDiagnosticProvider,
  EslintDiagnosticProvider,
  getAllDiagnostics,
  type GetAllDiagnosticsOptions,
} from '@infra/lsp/diagnostics';
