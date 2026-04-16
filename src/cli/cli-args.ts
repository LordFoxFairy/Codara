/**
 * CLI argument parser.
 *
 * Supported flags:
 * - `--resume / -r <id>`   -- resume a specific session
 * - `-p / --prompt <text>` -- headless mode, execute and exit
 * - `--json`               -- JSON output format (with -p)
 * - `-c / --continue`      -- resume the most recent session (@future)
 * - `--fork-session`       -- fork the current session (@future)
 * - `--dangerously-skip-permissions` -- skip permission checks for CI (@future)
 *
 * Remaining arguments are joined into initialPrompt.
 *
 * @future flags are parsed but not yet wired into main.tsx.
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
