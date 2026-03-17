/** LSP 诊断类型定义。 */

export enum DiagnosticSeverity {
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
  Hint = 'hint',
}

/** 单条诊断信息。 */
export interface Diagnostic {
  file: string;
  line: number;
  column: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
  source: string;
}

/** 单个 provider 的诊断结果。 */
export interface DiagnosticResult {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  source: string;
  success: boolean;
  error?: string;
}

/** 诊断 provider 接口。 */
export interface DiagnosticProvider {
  readonly name: string;
  isAvailable(cwd: string): Promise<boolean>;
  getDiagnostics(cwd: string, files?: string[]): Promise<DiagnosticResult>;
}
