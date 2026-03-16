/** 代码诊断工具 — agent 可调用的 TypeScript/ESLint 诊断。 */

import {StructuredTool} from '@langchain/core/tools';
import {z} from 'zod';
import {type DiagnosticResult, DiagnosticSeverity, getAllDiagnostics} from '@infra/lsp';

const MAX_DIAGNOSTICS_PER_PROVIDER = 50;

const diagnosticsInputSchema = z.object({
  files: z.array(z.string()).optional().describe('Optional list of file paths to check. If omitted, checks the entire project.'),
});

type DiagnosticsInput = z.infer<typeof diagnosticsInputSchema>;

function formatDiagnosticResult(result: DiagnosticResult): string {
  const header = `── ${result.source} ──`;

  if (!result.success) {
    return `${header}\nError: ${result.error ?? 'unknown error'}`;
  }

  if (result.diagnostics.length === 0) {
    return `${header}\nNo issues found.`;
  }

  const limited = result.diagnostics.slice(0, MAX_DIAGNOSTICS_PER_PROVIDER);
  const lines = limited.map((d) => {
    const code = d.code ? ` ${d.code}` : '';
    return `${d.file}:${d.line}:${d.column} ${d.severity}${code}: ${d.message}`;
  });

  const summary = `${result.errorCount} error(s), ${result.warningCount} warning(s)`;
  const truncated =
    result.diagnostics.length > MAX_DIAGNOSTICS_PER_PROVIDER
      ? `\n(showing ${MAX_DIAGNOSTICS_PER_PROVIDER} of ${result.diagnostics.length})`
      : '';

  return `${header}\n${summary}${truncated}\n${lines.join('\n')}`;
}

/** 代码诊断工具。 */
export class DiagnosticsTool extends StructuredTool<typeof diagnosticsInputSchema> {
  name = 'get_diagnostics';
  description = `Runs code diagnostics (TypeScript type-checking, ESLint linting) on the project or specific files.
Use when: checking for type errors, linting issues, or verifying code correctness.
Returns: formatted diagnostic messages with file:line:col, severity, and error codes.`;
  schema = diagnosticsInputSchema;

  private readonly cwd: string;

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
  }

  async _call(input: DiagnosticsInput): Promise<string> {
    const results = await getAllDiagnostics({
      cwd: this.cwd,
      files: input.files,
    });

    if (results.length === 0) {
      return 'No diagnostic providers available (no tsconfig.json or eslint config found).';
    }

    const totalErrors = results.reduce((sum, r) => sum + r.errorCount, 0);
    const totalWarnings = results.reduce((sum, r) => sum + r.warningCount, 0);

    const sections = results.map(formatDiagnosticResult);
    const overallSummary = `Total: ${totalErrors} error(s), ${totalWarnings} warning(s)`;

    return `${sections.join('\n\n')}\n\n${overallSummary}`;
  }
}

/** 创建 DiagnosticsTool。 */
export function createDiagnosticsTool(cwd: string): DiagnosticsTool {
  return new DiagnosticsTool(cwd);
}
