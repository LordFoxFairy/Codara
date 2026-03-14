export interface NormalizedBashCommand {
  tokens: string[];
  commandName: string;
  args: string[];
  specifier: string;
  complex: boolean;
  hasRedirection: boolean;
}

export interface PreparedShellCommand {
  command: string;
  complex: boolean;
}

export interface ParsedHeredocMarker {
  before: string;
  after: string;
  delimiter: string;
  allowTabs: boolean;
}

export const SHELL_CONTEXT_COMMANDS = new Set([
  '.',
  'alias',
  'cd',
  'dirs',
  'eval',
  'exec',
  'export',
  'false',
  'hash',
  'popd',
  'printf',
  'pushd',
  'pwd',
  'set',
  'shift',
  'source',
  'test',
  'true',
  'type',
  'ulimit',
  'umask',
  'unalias',
  'unset',
  'wait',
]);

export const SHELL_LAUNCHER_COMMANDS = new Set(['bash', 'sh', 'zsh']);
export const SUBCOMMAND_SCOPED_COMMANDS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'python3']);
