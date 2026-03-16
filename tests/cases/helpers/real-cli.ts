import {spawn} from 'node:child_process';
import path from 'node:path';

export interface RealCliCaseOptions {
  cwd: string;
  prompt: string;
  scenario: string;
  env?: Record<string, string | undefined>;
}

export interface RealCliCaseResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

export async function runRealCliCase(options: RealCliCaseOptions): Promise<RealCliCaseResult> {
  const runtimeFactory = path.join(process.cwd(), 'tests/cases/helpers/cli-runtime-factory.ts');

  return new Promise((resolve, reject) => {
    const child = spawn('script', ['-q', '/dev/null', 'bun', 'run', 'dev:once', options.prompt], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...options.env,
        CODARA_CLI_CWD: options.cwd,
        CODARA_CLI_RUNTIME_FACTORY: runtimeFactory,
        CODARA_CLI_CASE_SCENARIO: options.scenario,
        CODARA_CLI_REPO_ROOT: process.cwd(),
        CODARA_CLI_AUTO_EXIT_AFTER_INITIAL_PROMPT: '1',
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        CI: '1',
        COLUMNS: '200',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const output = normalizeCliOutput(`${stdout}\n${stderr}`);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        output,
      });
    });
  });
}

function normalizeCliOutput(value: string): string {
  // `script` injects EOT/backspace bytes around PTY teardown; strip them in case output snapshots.
  return stripAnsi(value)
    // eslint-disable-next-line no-control-regex
    .replace(/\u0008/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\u0004/g, '')
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function stripAnsi(value: string): string {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    '',
  );
}
