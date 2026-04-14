import type {NormalizedBashCommand} from '@core/middleware/permission/bash-parser';
import {
  isShellDescriptorTarget,
  isStandaloneShellWriteRedirection,
  readInlineShellWriteRedirectionTarget,
  stripLeadingShellEnvironment,
  tokenizeShellCommand,
  unwrapShellLauncherCommand,
} from '@core/middleware/permission/bash-parser';
import {
  normalizeBashCommandForMatching,
  normalizeCompoundBashCommands,
} from '@core/middleware/permission/bash-matcher';

const SHELL_CONTEXT_COMMANDS = new Set([
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

const SUBCOMMAND_SCOPED_COMMANDS = new Set(['git', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'python3']);

const WRITE_COMMANDS = new Set(['mkdir', 'touch', 'tee', 'install']);

export function formatBashToolScopeExpression(command: string): string {
  const normalized = normalizeBashCommandForMatching(command);
  if (normalized && !normalized.complex && normalized.tokens.length > 0) {
    return formatNormalizedBashToolScope(normalized);
  }

  const compoundCommands = normalizeCompoundBashCommands(command);
  if (compoundCommands.length === 0) {
    return 'Bash(*)';
  }

  const actionable = compoundCommands.filter((entry) => !SHELL_CONTEXT_COMMANDS.has(entry.commandName));
  const candidates = actionable.length > 0 ? actionable : compoundCommands;
  if (candidates.length === 1) {
    return formatNormalizedBashToolScope(candidates[0]);
  }

  const commandName = candidates[0]?.commandName;
  if (!commandName || !candidates.every((entry) => entry.commandName === commandName)) {
    return 'Bash(*)';
  }

  const scopedPrefixes = candidates
    .map((entry) => deriveBashCommandScopePrefix(entry))
    .filter((entry): entry is string => Boolean(entry));
  if (scopedPrefixes.length === candidates.length && new Set(scopedPrefixes).size === 1) {
    return `Bash(${scopedPrefixes[0]} *)`;
  }

  return `Bash(${commandName} *)`;
}

export function extractBashWritePathOperands(command: string): string[] {
  const tokenized = tokenizeShellCommand(command);
  if (tokenized.tokens.length === 0 || tokenized.complex) {
    return [];
  }

  const withoutEnv = stripLeadingShellEnvironment(tokenized.tokens);
  if (withoutEnv.length === 0) {
    return [];
  }

  const unwrapped = unwrapShellLauncherCommand(withoutEnv);
  if (unwrapped) {
    return extractBashWritePathOperands(unwrapped);
  }

  // Check for redirection targets
  const redirectionTargets = collectShellWriteRedirectionOperands(withoutEnv);
  if (redirectionTargets.length > 0) return redirectionTargets;

  // Check for write-creating commands (mkdir, touch, cp, mv, tee, etc.)
  return collectWriteCommandOperands(withoutEnv);
}

/**
 * BashArity: maps command prefixes to the number of tokens that define
 * the "human-understandable command". Used to generate "always" patterns.
 *
 * Ported from OpenCode's arity.ts.
 *
 * Example: `git checkout main` -> arity("git") = 2 -> prefix = ["git", "checkout"]
 *          -> always pattern = "git checkout *"
 */
const BASH_ARITY: Record<string, number> = {
  cat: 1, cd: 1, chmod: 1, chown: 1, cp: 1, echo: 1, env: 1,
  export: 1, grep: 1, kill: 1, killall: 1, ln: 1, ls: 1,
  mkdir: 1, mv: 1, ps: 1, pwd: 1, rm: 1, rmdir: 1, sleep: 1,
  source: 1, tail: 1, touch: 1, unset: 1, which: 1,
  aws: 3, az: 3, bazel: 2, brew: 2, bun: 2, 'bun run': 3, 'bun x': 3,
  cargo: 2, 'cargo add': 3, 'cargo run': 3, cdk: 2, cmake: 2,
  composer: 2, deno: 2, 'deno task': 3,
  docker: 2, 'docker compose': 3, 'docker container': 3,
  'docker image': 3, 'docker network': 3, 'docker volume': 3,
  firebase: 2, flyctl: 2, gcloud: 3,
  gh: 3, git: 2, 'git config': 3, 'git remote': 3, 'git stash': 3,
  go: 2, gradle: 2, helm: 2, heroku: 2,
  kubectl: 2, 'kubectl kustomize': 3, 'kubectl rollout': 3,
  make: 2, minikube: 2, mvn: 2, ng: 2,
  npm: 2, 'npm exec': 3, 'npm init': 3, 'npm run': 3, 'npm view': 3,
  nvm: 2, nx: 2,
  pip: 2, pipenv: 2, pnpm: 2, 'pnpm dlx': 3, 'pnpm exec': 3, 'pnpm run': 3,
  poetry: 2, podman: 2, psql: 2, pulumi: 2,
  pyenv: 2, python: 2, rake: 2, rbenv: 2,
  rustup: 2, serverless: 2, sst: 2, swift: 2,
  systemctl: 2, terraform: 2, 'terraform workspace': 3,
  turbo: 2, vault: 2, 'vault kv': 3, vercel: 2, volta: 2,
  yarn: 2, 'yarn dlx': 3, 'yarn run': 3,
};

/**
 * Generate "always allow" pattern suggestions for a bash command.
 * Returns patterns from most specific to most general.
 *
 * `npm install lodash` -> ["npm install *", "npm *", "*"]
 * `git checkout main` -> ["git checkout *", "git *", "*"]
 */
export function extractBashAlwaysPatterns(command: string): string[] {
  const normalized = normalizeBashCommandForMatching(command);
  if (!normalized || normalized.tokens.length === 0) {
    return ['*'];
  }

  const prefix = bashArityPrefix(normalized.tokens);
  const patterns: string[] = [];

  // Most specific: arity-based prefix + wildcard
  if (prefix.length > 0) {
    patterns.push(`${prefix.join(' ')} *`);
  }

  // Medium: just the command name + wildcard (if different from above)
  if (prefix.length > 1) {
    patterns.push(`${normalized.commandName} *`);
  }

  // Most general
  patterns.push('*');

  return patterns;
}

function formatNormalizedBashToolScope(normalized: NormalizedBashCommand): string {
  const scopedPrefix = deriveBashCommandScopePrefix(normalized);
  if (scopedPrefix) {
    return `Bash(${scopedPrefix} *)`;
  }

  return `Bash(${normalized.commandName} *)`;
}

function deriveBashCommandScopePrefix(normalized: NormalizedBashCommand): string | undefined {
  if (!SUBCOMMAND_SCOPED_COMMANDS.has(normalized.commandName)) {
    return undefined;
  }

  if (normalized.commandName === 'python' || normalized.commandName === 'python3') {
    if (normalized.args[0] === '-m' && normalized.args[1]) {
      return `${normalized.commandName} -m ${normalized.args[1]}`;
    }

    return undefined;
  }

  const firstNonFlag = normalized.args.find((token) => token && !token.startsWith('-'));
  if (!firstNonFlag) {
    return undefined;
  }

  return `${normalized.commandName} ${firstNonFlag}`;
}

/**
 * Extract the meaningful command prefix from tokens using BashArity.
 * Longest matching prefix wins.
 *
 * `["git", "checkout", "main"]` -> `["git", "checkout"]`
 * `["npm", "run", "dev"]` -> `["npm", "run", "dev"]`
 * `["unknown-cmd", "arg"]` -> `["unknown-cmd"]`
 */
function bashArityPrefix(tokens: string[]): string[] {
  for (let len = tokens.length; len > 0; len--) {
    const prefix = tokens.slice(0, len).join(' ');
    const arity = BASH_ARITY[prefix];
    if (arity !== undefined) {
      return tokens.slice(0, arity);
    }
  }
  if (tokens.length === 0) return [];
  return tokens.slice(0, 1);
}

function collectWriteCommandOperands(tokens: string[]): string[] {
  if (tokens.length < 2) return [];
  const cmd = tokens[0]?.trim();
  if (!cmd || !WRITE_COMMANDS.has(cmd)) return [];

  // Collect non-flag arguments as write targets
  const targets: string[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i]?.trim();
    if (!token || token.startsWith('-')) continue;
    // For these commands, the operand is the path being created/written
    targets.push(token);
  }
  return targets;
}

function collectShellWriteRedirectionOperands(tokens: string[]): string[] {
  const operands: string[] = [];
  let skipNext = false;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }

    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (isStandaloneShellWriteRedirection(token)) {
      const next = tokens[index + 1]?.trim();
      if (next && !isShellDescriptorTarget(next)) {
        operands.push(next);
      }
      skipNext = true;
      continue;
    }

    const inlineTarget = readInlineShellWriteRedirectionTarget(token);
    if (inlineTarget) {
      operands.push(inlineTarget);
    }
  }

  return operands;
}

