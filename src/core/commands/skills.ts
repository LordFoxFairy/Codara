import {spawnSync} from 'node:child_process';
import {
  createSkillCommandInvocation,
  discoverSkillCommandsFromRuntime,
  type SkillCommandDefinition,
} from '@core/skills/commands';
import type {SkillsSource} from '@core/skills';
import type {CodaraCommandDefinition} from '@core/commands/types';
import {readLatestAssistantText} from '@core/shared/messages';
import {normalizeToolReferenceName} from '@core/tools';

export async function createSkillCodaraCommands(
  source: SkillsSource,
): Promise<readonly CodaraCommandDefinition[]> {
  const commands = discoverSkillCommandsFromRuntime(await source.getRuntime());
  return commands.map(bindSkillCommand);
}

function bindSkillCommand(command: SkillCommandDefinition): CodaraCommandDefinition {
  return {
    name: command.name,
    description: command.description,
    usage: command.usage,
    source: {
      type: 'skill',
      skillName: command.skill.name,
      skillPath: command.skill.path,
    },
    ...(command.aliases?.length ? {aliases: command.aliases} : {}),
    async execute({command: parsed, agent}) {
      if (!parsed.argsText.trim()) {
        return {
          ok: false,
          command: parsed.name,
          output: [
            `/${command.name}`,
            command.description,
            `Usage: ${command.usage}`,
            `Skill: ${command.skill.name}`,
            `Path: ${command.skill.path}`,
          ].join('\n'),
        };
      }

      const preflight = runSkillCommandPreflight(command, agent.getAvailableToolNames());
      if (!preflight.ok) {
        return {
          ok: false,
          command: parsed.name,
          output: formatSkillCommandPreflightFailure(command, preflight, agent.getAvailableToolNames()),
        };
      }

      const invocation = createSkillCommandInvocation(command, parsed.argsText);
      const result = await agent.invoke(invocation.prompt);
      return {
        ok: true,
        command: parsed.name,
        output: readLatestAssistantText(result.state.messages) ?? '(no output)',
        state: result.state,
      };
    },
  };
}

interface SkillCommandPreflightResult {
  ok: boolean;
  missingTools: string[];
  missingShellCommands: string[];
}

function runSkillCommandPreflight(
  command: SkillCommandDefinition,
  availableToolNames: readonly string[],
): SkillCommandPreflightResult {
  const normalizedAvailableTools = new Set(
    availableToolNames
      .map((name) => normalizeToolReferenceName(name))
      .filter(Boolean),
  );
  const missingTools = new Set<string>();
  const missingShellCommands = new Set<string>();

  for (const reference of command.skill.allowedTools ?? []) {
    const parsedReference = parseAllowedToolReference(reference);
    if (!parsedReference) {
      continue;
    }

    if (!normalizedAvailableTools.has(parsedReference.toolName)) {
      missingTools.add(parsedReference.toolName);
      continue;
    }

    if (parsedReference.toolName === 'bash' && parsedReference.shellCommand && !isShellCommandAvailable(parsedReference.shellCommand)) {
      missingShellCommands.add(parsedReference.shellCommand);
    }
  }

  return {
    ok: missingTools.size === 0 && missingShellCommands.size === 0,
    missingTools: [...missingTools],
    missingShellCommands: [...missingShellCommands],
  };
}

function formatSkillCommandPreflightFailure(
  command: SkillCommandDefinition,
  preflight: SkillCommandPreflightResult,
  availableToolNames: readonly string[],
): string {
  return [
    `Cannot run /${command.name} in this runtime.`,
    ...(preflight.missingTools.length > 0
      ? [`Missing tools: ${preflight.missingTools.join(', ')}`]
      : []),
    ...(preflight.missingShellCommands.length > 0
      ? [`Missing shell commands in PATH: ${preflight.missingShellCommands.join(', ')}`]
      : []),
    ...(command.skill.allowedTools?.length
      ? [`Skill allowed-tools: ${command.skill.allowedTools.join(', ')}`]
      : []),
    ...(availableToolNames.length > 0
      ? [`Available tools: ${availableToolNames.join(', ')}`]
      : []),
  ].join('\n');
}

function parseAllowedToolReference(
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

function extractShellCommandName(expression: string): string | undefined {
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
