import path from 'node:path';
import type {
  CodaraCommandDefinition,
  CodaraCommandEnvironment,
  CodaraCommandExecutionMode,
  CodaraCommandHelpMetadata,
  CodaraCommandSource,
  CodaraCommandSpec,
} from '@core/commands/types';

const BUILTIN_SOURCE = {type: 'builtin'} as const;
const HELP_PAGE_SIZE = 8;

interface HelpEntry {
  command: CodaraCommandSpec;
  line: string;
}

interface HelpSection {
  title: string;
  entries: HelpEntry[];
}

interface HelpPage {
  sections: Array<{
    title: string;
    entries: HelpEntry[];
  }>;
}

export const helpCommand: CodaraCommandDefinition = {
  name: 'help',
  usage: '/help [command|page]',
  description: 'Show available Codara slash commands.',
  source: BUILTIN_SOURCE,
  help: {
    executionMode: 'runtime_command',
  },
  async execute({command, registry, environment}) {
    const targetArg = normalizeHelpTarget(command.args[0]);
    if (!targetArg) {
      return {
        ok: true,
        command: command.name,
        output: renderHelpIndex(registry, environment, 1),
      };
    }

    const requestedPage = parsePageNumber(targetArg);
    if (requestedPage) {
      return {
        ok: true,
        command: command.name,
        output: renderHelpIndex(registry, environment, requestedPage),
      };
    }

    const target = resolveCommand(registry, targetArg);
    if (!target) {
      return {ok: false, command: command.name, output: `Unknown command: /${targetArg}`};
    }

    return {
      ok: true,
      command: command.name,
      output: renderCommandDetails(target, environment),
    };
  },
};

function normalizeHelpTarget(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/^\//, '').toLowerCase();
  return normalized ? normalized : undefined;
}

function parsePageNumber(value: string): number | undefined {
  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function resolveCommand(
  registry: readonly CodaraCommandDefinition[],
  name: string,
): CodaraCommandDefinition | undefined {
  const normalized = name.toLowerCase();
  return registry.find((command) =>
    command.name === normalized || command.aliases?.some((alias) => alias.toLowerCase() === normalized),
  );
}

function renderHelpIndex(
  registry: readonly CodaraCommandDefinition[],
  environment: CodaraCommandEnvironment,
  requestedPage: number,
): string {
  const pages = paginateHelpSections(buildHelpSections(registry, environment));
  const pageCount = Math.max(1, pages.length);
  const pageIndex = clampPageIndex(requestedPage, pageCount);
  const page = pages[pageIndex - 1] ?? {sections: []};

  return [
    `Codara commands (page ${pageIndex}/${pageCount})`,
    'Run /help <command> for details.',
    'Skill commands run through the agent and may require runtime tools.',
    ...(pageCount > 1
      ? [
          pageIndex < pageCount
            ? `Run /help ${pageIndex + 1} for more commands.`
            : `Run /help ${pageIndex - 1} to go back.`,
        ]
      : []),
    '',
    ...page.sections.flatMap((section) => [
      `${section.title}:`,
      ...section.entries.map((entry) => entry.line),
      '',
    ]),
  ].join('\n').trimEnd();
}

function renderCommandDetails(command: CodaraCommandSpec, environment: CodaraCommandEnvironment): string {
  const executionMode = formatExecutionMode(resolveCommandHelpMetadata(command).executionMode);
  const detailLines = [
    `/${command.name}`,
    command.description,
    `Usage: ${command.usage}`,
    `Type: ${formatCommandType(command.source)}`,
    `Execution: ${executionMode}`,
  ];

  const scope = formatCommandScope(command.source, environment);
  if (scope) {
    detailLines.push(`Scope: ${scope}`);
  }

  const help = resolveCommandHelpMetadata(command);
  if (help.allowedTools?.length) {
    detailLines.push(`Allowed tools: ${help.allowedTools.join(', ')}`);
  }
  if (help.requiredShellCommands?.length) {
    detailLines.push(`Required shell commands: ${help.requiredShellCommands.join(', ')}`);
  }

  if (command.source.type === 'skill') {
    detailLines.push(`Skill: ${command.source.skillName}`);
    detailLines.push(`Path: ${command.source.skillPath}`);
    detailLines.push('Runtime requirement: run this command in a Codara runtime that exposes the listed tools.');
  }

  if (command.aliases?.length) {
    detailLines.push(`Aliases: ${command.aliases.map((alias) => `/${alias}`).join(', ')}`);
  }

  return detailLines.join('\n');
}

function buildHelpSections(
  registry: readonly CodaraCommandDefinition[],
  environment: CodaraCommandEnvironment,
): HelpSection[] {
  const builtIns = registry.filter((item) => item.source.type === 'builtin');
  const skillCommands = registry.filter((item) => item.source.type === 'skill');

  return [
    {
      title: 'Built-in commands',
      entries: formatHelpEntries(builtIns, environment),
    },
    ...(skillCommands.length > 0
      ? [{
          title: 'Skill commands',
          entries: formatHelpEntries(skillCommands, environment),
        }]
      : []),
  ];
}

function formatHelpEntries(
  commands: readonly CodaraCommandSpec[],
  environment: CodaraCommandEnvironment,
): HelpEntry[] {
  const labels = commands.map((command) => summarizeUsage(command.usage));
  const labelWidth = labels.reduce((max, label) => Math.max(max, label.length), 0);

  return commands.map((command, index) => {
    const label = labels[index] ?? `/${command.name}`;
    const scope = formatCommandScope(command.source, environment);
    const suffix = command.source.type === 'skill'
      ? ` [${scope ?? 'skill'}: ${command.source.skillName}]`
      : '';

    return {
      command,
      line: `  ${label.padEnd(labelWidth)}  ${command.description}${suffix}`,
    };
  });
}

function paginateHelpSections(sections: readonly HelpSection[]): HelpPage[] {
  const pages: HelpPage[] = [];
  let currentPage = createEmptyPage();
  let remainingSlots = HELP_PAGE_SIZE;

  const pushCurrentPage = () => {
    if (currentPage.sections.length > 0) {
      pages.push(currentPage);
      currentPage = createEmptyPage();
      remainingSlots = HELP_PAGE_SIZE;
    }
  };

  for (const section of sections) {
    if (section.entries.length === 0) {
      continue;
    }

    let entryIndex = 0;
    let sectionPart = 0;
    while (entryIndex < section.entries.length) {
      if (remainingSlots === 0) {
        pushCurrentPage();
      }

      const isContinuation = sectionPart > 0;
      const minimumSlotsForNewSection = 2;
      if (!isContinuation && currentPage.sections.length > 0 && remainingSlots < minimumSlotsForNewSection) {
        pushCurrentPage();
      }

      const maxEntriesForPage = Math.max(1, remainingSlots - 1);
      const pageEntries = section.entries.slice(entryIndex, entryIndex + maxEntriesForPage);

      currentPage.sections.push({
        title: isContinuation ? `${section.title} (continued)` : section.title,
        entries: pageEntries,
      });

      entryIndex += pageEntries.length;
      sectionPart += 1;
      remainingSlots -= pageEntries.length + 1;

      if (entryIndex < section.entries.length) {
        pushCurrentPage();
      }
    }
  }

  pushCurrentPage();

  return pages.length > 0 ? pages : [createEmptyPage()];
}

function createEmptyPage(): HelpPage {
  return {sections: []};
}

function clampPageIndex(requestedPage: number, pageCount: number): number {
  if (requestedPage < 1) {
    return 1;
  }
  if (requestedPage > pageCount) {
    return pageCount;
  }
  return requestedPage;
}

function summarizeUsage(usage: string): string {
  const match = usage.trim().match(/^\/\S+/);
  return match?.[0] ?? usage.trim();
}

function resolveCommandHelpMetadata(command: CodaraCommandSpec): CodaraCommandHelpMetadata {
  if (command.help) {
    return command.help;
  }

  return {
    executionMode: command.source.type === 'skill' ? 'agent_workflow' : 'runtime_command',
  };
}

function formatExecutionMode(mode: CodaraCommandExecutionMode): string {
  switch (mode) {
    case 'agent_workflow':
      return 'agent workflow';
    case 'host_action':
      return 'host action';
    case 'runtime_command':
      return 'runtime command';
    default:
      return mode;
  }
}

function formatCommandType(source: CodaraCommandSource): string {
  return source.type === 'builtin' ? 'built-in command' : 'skill command';
}

function formatCommandScope(
  source: CodaraCommandSource,
  environment: CodaraCommandEnvironment,
): string | undefined {
  if (source.type !== 'skill') {
    return undefined;
  }

  const projectRoot = environment.projectRoot ?? environment.cwd;
  const userHome = environment.userHome;

  if (projectRoot && isPathInside(path.join(projectRoot, '.codara', 'skills'), source.skillPath)) {
    return 'project';
  }

  if (userHome && isPathInside(path.join(userHome, '.codara', 'skills'), source.skillPath)) {
    return 'global';
  }

  return 'external';
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
