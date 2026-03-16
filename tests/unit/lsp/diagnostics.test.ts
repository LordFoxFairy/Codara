import {describe, expect, it} from 'bun:test';
import path from 'node:path';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {
  DiagnosticSeverity,
  parseTscOutput,
  parseEslintJsonOutput,
  TypeScriptDiagnosticProvider,
  EslintDiagnosticProvider,
} from '@infra/lsp';

describe('parseTscOutput', () => {
  it('should parse standard tsc error output', () => {
    const output = `src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils.ts(3,1): error TS1005: ';' expected.`;

    const diagnostics = parseTscOutput(output);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toEqual({
      file: 'src/index.ts',
      line: 10,
      column: 5,
      severity: DiagnosticSeverity.Error,
      message: "Type 'string' is not assignable to type 'number'.",
      code: 'TS2322',
      source: 'tsc',
    });
    expect(diagnostics[1]).toEqual({
      file: 'src/utils.ts',
      line: 3,
      column: 1,
      severity: DiagnosticSeverity.Error,
      message: "';' expected.",
      code: 'TS1005',
      source: 'tsc',
    });
  });

  it('should handle warning severity', () => {
    const output = `src/foo.ts(1,1): warning TS6133: 'x' is declared but its value is never read.`;
    const diagnostics = parseTscOutput(output);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it('should return empty array for clean output', () => {
    expect(parseTscOutput('')).toEqual([]);
    expect(parseTscOutput('No errors found.')).toEqual([]);
  });

  it('should handle Windows-style paths', () => {
    const output = `C:\\Users\\dev\\src\\index.ts(5,10): error TS2345: Argument of type 'string' is not assignable.`;
    const diagnostics = parseTscOutput(output);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.file).toBe('C:\\Users\\dev\\src\\index.ts');
  });
});

describe('parseEslintJsonOutput', () => {
  it('should parse eslint JSON output', () => {
    const output = JSON.stringify([
      {
        filePath: '/project/src/index.ts',
        messages: [
          {line: 5, column: 3, severity: 2, message: 'Unexpected var', ruleId: 'no-var'},
          {line: 10, column: 1, severity: 1, message: 'Missing semicolon', ruleId: 'semi'},
        ],
      },
    ]);

    const diagnostics = parseEslintJsonOutput(output);

    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toEqual({
      file: '/project/src/index.ts',
      line: 5,
      column: 3,
      severity: DiagnosticSeverity.Error,
      message: 'Unexpected var',
      code: 'no-var',
      source: 'eslint',
    });
    expect(diagnostics[1]!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it('should return empty for invalid JSON', () => {
    expect(parseEslintJsonOutput('not json')).toEqual([]);
    expect(parseEslintJsonOutput('')).toEqual([]);
  });

  it('should return empty for non-array JSON', () => {
    expect(parseEslintJsonOutput('{}')).toEqual([]);
  });

  it('should handle null ruleId', () => {
    const output = JSON.stringify([
      {
        filePath: '/a.ts',
        messages: [{line: 1, column: 1, severity: 2, message: 'Parse error', ruleId: null}],
      },
    ]);

    const diagnostics = parseEslintJsonOutput(output);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBeUndefined();
  });
});

describe('TypeScriptDiagnosticProvider.isAvailable', () => {
  it('should return true when tsconfig.json exists', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-tsc-'));
    await writeFile(path.join(dir, 'tsconfig.json'), '{}', 'utf8');

    const provider = new TypeScriptDiagnosticProvider();
    expect(await provider.isAvailable(dir)).toBe(true);
  });

  it('should return false when tsconfig.json is missing', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-tsc-'));

    const provider = new TypeScriptDiagnosticProvider();
    expect(await provider.isAvailable(dir)).toBe(false);
  });
});

describe('EslintDiagnosticProvider.isAvailable', () => {
  it('should return true when eslint config exists', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-eslint-'));
    await writeFile(path.join(dir, 'eslint.config.js'), 'export default []', 'utf8');

    const provider = new EslintDiagnosticProvider();
    expect(await provider.isAvailable(dir)).toBe(true);
  });

  it('should return false when no eslint config exists', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-eslint-'));

    const provider = new EslintDiagnosticProvider();
    expect(await provider.isAvailable(dir)).toBe(false);
  });

  it('should detect legacy .eslintrc.json', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'codara-eslint-'));
    await writeFile(path.join(dir, '.eslintrc.json'), '{}', 'utf8');

    const provider = new EslintDiagnosticProvider();
    expect(await provider.isAvailable(dir)).toBe(true);
  });
});
