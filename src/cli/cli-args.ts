/**
 * CLI 参数解析。
 *
 * 支持的标志：
 * - `--resume / -r <id>`   — 恢复指定 session
 * - `-p / --prompt <text>` — headless 模式，执行后直接退出
 * - `--json`               — 输出格式为 JSON（配合 -p）
 * - `-c / --continue`      — 恢复最近 session
 * - `--fork-session`       — fork 当前 session
 * - `--dangerously-skip-permissions` — 跳过权限检查（CI 用）
 *
 * 其余参数拼接为 initialPrompt。
 */

export type OutputFormat = 'json';

export interface ParsedCliArgs {
  initialPrompt: string;
  resumeSessionId?: string;
  headlessPrompt?: string;
  outputFormat?: OutputFormat;
  continueLatest: boolean;
  forkSession: boolean;
  dangerouslySkipPermissions: boolean;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const rest: string[] = [];
  let resumeSessionId: string | undefined;
  let headlessPrompt: string | undefined;
  let outputFormat: OutputFormat | undefined;
  let continueLatest = false;
  let forkSession = false;
  let dangerouslySkipPermissions = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    // --resume / -r
    if ((arg === '--resume' || arg === '-r') && i + 1 < argv.length) {
      resumeSessionId = argv[++i]!.trim();
    } else if (arg.startsWith('--resume=')) {
      resumeSessionId = arg.slice('--resume='.length).trim();

    // -p / --prompt
    } else if ((arg === '-p' || arg === '--prompt') && i + 1 < argv.length) {
      headlessPrompt = argv[++i]!;
    } else if (arg.startsWith('--prompt=')) {
      headlessPrompt = arg.slice('--prompt='.length);

    // --json
    } else if (arg === '--json') {
      outputFormat = 'json';

    // -c / --continue
    } else if (arg === '-c' || arg === '--continue') {
      continueLatest = true;

    // --fork-session
    } else if (arg === '--fork-session') {
      forkSession = true;

    // --dangerously-skip-permissions
    } else if (arg === '--dangerously-skip-permissions') {
      dangerouslySkipPermissions = true;

    } else {
      rest.push(arg);
    }
  }

  return {
    initialPrompt: rest.join(' ').trim(),
    resumeSessionId: resumeSessionId || undefined,
    headlessPrompt: headlessPrompt ?? undefined,
    outputFormat,
    continueLatest,
    forkSession,
    dangerouslySkipPermissions,
  };
}
