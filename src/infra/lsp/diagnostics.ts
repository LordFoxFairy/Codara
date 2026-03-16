/** TypeScript + ESLint 诊断 provider — CLI fallback 实现。 */

import {access} from 'node:fs/promises';
import path from 'node:path';
import {type Diagnostic, type DiagnosticProvider, type DiagnosticResult, DiagnosticSeverity} from '@infra/lsp/types';

// ── tsc 解析 ────────────────────────────────────────────────────────────

/**
 * 解析 `tsc --noEmit` 的输出。
 * 格式：`file(line,col): error TSxxxx: message`
 */
export function parseTscOutput(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const pattern = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const [, file, line, column, severity, code, message] = match;
    diagnostics.push({
      file: file!,
      line: Number(line),
      column: Number(column),
      severity: severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
      message: message!,
      code: code!,
      source: 'tsc',
    });
  }

  return diagnostics;
}

/** TypeScript 诊断 provider。 */
export class TypeScriptDiagnosticProvider implements DiagnosticProvider {
  readonly name = 'tsc';

  async isAvailable(cwd: string): Promise<boolean> {
    try {
      await access(path.join(cwd, 'tsconfig.json'));
      return true;
    } catch {
      return false;
    }
  }

  async getDiagnostics(cwd: string, _files?: string[]): Promise<DiagnosticResult> {
    try {
      const proc = Bun.spawn(['npx', 'tsc', '--noEmit', '--pretty', 'false'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;

      const output = stdout + stderr;
      const diagnostics = parseTscOutput(output);
      const errorCount = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error).length;
      const warningCount = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Warning).length;

      return {diagnostics, errorCount, warningCount, source: this.name, success: true};
    } catch (error) {
      return {
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        source: this.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ── eslint 解析 ──────────────────────────────────────────────────────────

interface EslintJsonMessage {
  line: number;
  column: number;
  severity: number;
  message: string;
  ruleId?: string | null;
}

interface EslintJsonEntry {
  filePath: string;
  messages: EslintJsonMessage[];
}

/**
 * 解析 `eslint --format json` 的输出。
 */
export function parseEslintJsonOutput(output: string): Diagnostic[] {
  let entries: EslintJsonEntry[];
  try {
    entries = JSON.parse(output) as EslintJsonEntry[];
  } catch {
    return [];
  }

  if (!Array.isArray(entries)) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const entry of entries) {
    if (!entry.filePath || !Array.isArray(entry.messages)) continue;

    for (const msg of entry.messages) {
      const severity =
        msg.severity === 2
          ? DiagnosticSeverity.Error
          : msg.severity === 1
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Info;

      diagnostics.push({
        file: entry.filePath,
        line: msg.line,
        column: msg.column,
        severity,
        message: msg.message,
        code: msg.ruleId ?? undefined,
        source: 'eslint',
      });
    }
  }

  return diagnostics;
}

const ESLINT_CONFIG_FILES = [
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];

/** ESLint 诊断 provider。 */
export class EslintDiagnosticProvider implements DiagnosticProvider {
  readonly name = 'eslint';

  async isAvailable(cwd: string): Promise<boolean> {
    for (const configFile of ESLINT_CONFIG_FILES) {
      try {
        await access(path.join(cwd, configFile));
        return true;
      } catch {
        // continue
      }
    }
    return false;
  }

  async getDiagnostics(cwd: string, files?: string[]): Promise<DiagnosticResult> {
    try {
      const args = ['npx', 'eslint', '--format', 'json'];
      if (files && files.length > 0) {
        args.push(...files);
      } else {
        args.push('.');
      }

      const proc = Bun.spawn(args, {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const diagnostics = parseEslintJsonOutput(stdout);
      const errorCount = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error).length;
      const warningCount = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Warning).length;

      return {diagnostics, errorCount, warningCount, source: this.name, success: true};
    } catch (error) {
      return {
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        source: this.name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// ── 聚合 ────────────────────────────────────────────────────────────────

const DEFAULT_PROVIDERS: DiagnosticProvider[] = [
  new TypeScriptDiagnosticProvider(),
  new EslintDiagnosticProvider(),
];

export interface GetAllDiagnosticsOptions {
  cwd: string;
  files?: string[];
  providers?: DiagnosticProvider[];
}

/** 运行所有可用的诊断 provider 并聚合结果。 */
export async function getAllDiagnostics(options: GetAllDiagnosticsOptions): Promise<DiagnosticResult[]> {
  const {cwd, files, providers = DEFAULT_PROVIDERS} = options;

  const available = await Promise.all(
    providers.map(async (p) => ({provider: p, ok: await p.isAvailable(cwd)})),
  );

  const active = available.filter((a) => a.ok).map((a) => a.provider);

  if (active.length === 0) {
    return [];
  }

  return Promise.all(active.map((p) => p.getDiagnostics(cwd, files)));
}
