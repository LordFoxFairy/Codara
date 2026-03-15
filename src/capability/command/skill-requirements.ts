import {spawnSync} from 'node:child_process';
import {normalizeToolReferenceName} from '@capability/tool';

export interface SkillCommandRequirements {
  allowedTools: string[];
  runtimeTools: string[];
  requiredShellCommands: string[];
}

export interface SkillCommandPreflightResult {
  ok: boolean;
  missingRuntimeTools: string[];
  missingShellCommands: string[];
}

export function deriveSkillCommandRequirements(allowedTools: readonly string[] | undefined): SkillCommandRequirements {
  const normalized = allowedTools ?? [];
  const runtimeTools = new Set<string>();
  const requiredShellCommands = new Set<string>();

  for (const reference of normalized) {
    const parsed = parseAllowedToolReference(reference);
    if (!parsed) {
      continue;
    }

    runtimeTools.add(parsed.toolName);
    if (parsed.shellCommand) {
      requiredShellCommands.add(parsed.shellCommand);
    }
  }

  return {
    allowedTools: [...normalized],
    runtimeTools: [...runtimeTools],
    requiredShellCommands: [...requiredShellCommands],
  };
}

export function runSkillCommandPreflight(
  requirements: SkillCommandRequirements,
  availableToolNames: readonly string[],
): SkillCommandPreflightResult {
  const normalizedAvailableTools = new Set(
    availableToolNames
      .map((name) => normalizeToolReferenceName(name))
      .filter(Boolean),
  );
  const missingRuntimeTools = requirements.runtimeTools.filter((toolName) => !normalizedAvailableTools.has(toolName));
  const missingShellCommands = requirements.requiredShellCommands.filter((commandName) => !isShellCommandAvailable(commandName));

  return {
    ok: missingRuntimeTools.length === 0 && missingShellCommands.length === 0,
    missingRuntimeTools,
    missingShellCommands,
  };
}

export function parseAllowedToolReference(
  reference: string,
): {toolName: string; shellCommand?: string} | undefined {
  const trimmed = reference.trim();
  if (!trimmed) {
    return undefined;
  }

  const callMatch = trimmed.match(/^([A-Za-z0-9_-]+)\((.*)\)$/);
  if (!callMatch) {
    const normalized = normalizeToolReferenceName(trimmed);
    return normalized ? {toolName: normalized} : undefined;
  }

  const toolName = normalizeToolReferenceName(callMatch[1] ?? '');
  if (!toolName) {
    return undefined;
  }

  const body = callMatch[2]?.trim() ?? '';
  const shellCommand = toolName === 'bash' ? extractShellCommandName(body) : undefined;

  return {
    toolName,
    ...(shellCommand ? {shellCommand} : {}),
  };
}

export function extractShellCommandName(expression: string): string | undefined {
  const trimmed = expression.trim();
  if (!trimmed || trimmed === '*') {
    return undefined;
  }

  const firstSegment = trimmed.split(/[|&;]/, 1)[0]?.trim() ?? '';
  if (!firstSegment) {
    return undefined;
  }

  const parts = firstSegment.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return undefined;
  }

  while (parts.length > 0) {
    const current = parts[0] ?? '';
    if (current === 'sudo') {
      parts.shift();
      continue;
    }
    if (current === 'env') {
      parts.shift();
      while ((parts[0] ?? '').includes('=')) {
        parts.shift();
      }
      continue;
    }
    if (current.includes('=')) {
      parts.shift();
      continue;
    }
    break;
  }

  const candidate = (parts[0] ?? '').replace(/[:*].*$/, '');
  if (!candidate || candidate === '*' || SHELL_BUILTINS.has(candidate)) {
    return undefined;
  }

  return /^[A-Za-z0-9._-]+$/.test(candidate) ? candidate : undefined;
}

function isShellCommandAvailable(commandName: string): boolean {
  const shell = process.env.SHELL || '/bin/sh';
  const result = spawnSync(shell, ['-lc', `command -v -- ${escapeShellWord(commandName)}`], {
    stdio: 'ignore',
  });
  return result.status === 0;
}

function escapeShellWord(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const SHELL_BUILTINS = new Set([
  'alias',
  'bg',
  'builtin',
  'cd',
  'command',
  'echo',
  'eval',
  'exec',
  'exit',
  'export',
  'false',
  'fg',
  'jobs',
  'printf',
  'pwd',
  'readonly',
  'return',
  'set',
  'shift',
  'source',
  'test',
  'times',
  'trap',
  'true',
  'type',
  'ulimit',
  'umask',
  'unalias',
  'unset',
  'wait',
]);
