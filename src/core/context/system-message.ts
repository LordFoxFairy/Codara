import type {BaseMessage} from '@langchain/core/messages';
import type {GuidelinesSource} from '@core/context/instructions/guidelines';
import type {PromptSource} from '@core/context/instructions/prompt';
import type {AutoMemorySource} from '@core/context/memory/auto-memory';
import {
  formatSkillsList,
  formatSkillsLocations,
  SKILLS_SYSTEM_PROMPT,
  type SkillsRuntimeData,
  type SkillsSource,
} from '@core/skills';

const BASE_SYSTEM_MESSAGE_KEY = 'codaraSystemMessage';

export interface BaseSystemMessageBundle {
  systemMessage: string[];
  runtimeShared?: Record<string, unknown>;
}

export interface BaseSystemMessageRuntimeData {
  systemMessage: string[];
}

export interface PreparedInstructionContextTarget {
  systemMessage: string[];
  messages: BaseMessage[];
  runtime: {
    shared?: Record<string, unknown>;
  };
  state: {
    messages: BaseMessage[];
  };
}

export interface BuildBaseSystemMessageOptions {
  promptSource?: PromptSource;
  guidelinesSource?: GuidelinesSource;
  skillsSource?: SkillsSource;
  autoMemorySource?: AutoMemorySource;
  memoryRootDir?: string;
}

export async function buildBaseSystemMessage(
  promptSourceOrOptions?: PromptSource | BuildBaseSystemMessageOptions,
  guidelinesSource?: GuidelinesSource,
  skillsSource?: SkillsSource,
  autoMemorySource?: AutoMemorySource,
): Promise<BaseSystemMessageBundle> {
  // Support both old positional args and new options object
  let opts: BuildBaseSystemMessageOptions;
  if (promptSourceOrOptions && typeof promptSourceOrOptions === 'object' && 'promptSource' in promptSourceOrOptions) {
    opts = promptSourceOrOptions;
  } else {
    opts = {
      promptSource: promptSourceOrOptions as PromptSource | undefined,
      guidelinesSource,
      skillsSource,
      autoMemorySource,
    };
  }

  const promptMessage = await opts.promptSource?.getContent?.();
  const guidelinesMessage = await opts.guidelinesSource?.getContent?.();
  const skillsRuntime = await opts.skillsSource?.getRuntime?.();
  const autoMemoryContent = await opts.autoMemorySource?.getContent?.();
  const memorySection = createAutoMemorySystemMessage(autoMemoryContent, opts.memoryRootDir);
  const systemMessage = [
    promptMessage,
    guidelinesMessage,
    skillsRuntime ? createSkillsSystemMessage(skillsRuntime) : undefined,
    memorySection,
  ].filter((value): value is string => Boolean(value));
  const runtimeShared = {
    ...(skillsRuntime ? {skills: skillsRuntime} : {}),
    ...(systemMessage.length > 0 ? createBaseSystemMessageRuntimeShared(systemMessage) : {}),
  };

  return {
    systemMessage,
    ...(Object.keys(runtimeShared).length > 0 ? {runtimeShared} : {}),
  };
}

export function readBaseSystemMessage(shared: unknown): BaseSystemMessageRuntimeData | undefined {
  if (!shared || typeof shared !== 'object' || Array.isArray(shared)) {
    return undefined;
  }

  const value = (shared as Record<string, unknown>)[BASE_SYSTEM_MESSAGE_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const systemMessage = (value as Record<string, unknown>).systemMessage;
  if (!Array.isArray(systemMessage)) {
    return undefined;
  }

  const normalized = systemMessage.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return normalized.length > 0 ? {systemMessage: normalized} : undefined;
}

function createBaseSystemMessageRuntimeShared(systemMessage: string[]): Record<string, BaseSystemMessageRuntimeData> {
  return {
    [BASE_SYSTEM_MESSAGE_KEY]: {
      systemMessage: [...systemMessage],
    },
  };
}

export function applyPreparedInstructionContext(
  target: PreparedInstructionContextTarget,
  base: BaseSystemMessageBundle,
): void {
  target.systemMessage = [...base.systemMessage];
  target.runtime.shared = {
    ...(target.runtime.shared ?? {}),
    ...(base.runtimeShared ?? {}),
  };
  target.messages = target.state.messages;
}

function createSkillsSystemMessage(runtime: Pick<SkillsRuntimeData, 'sources' | 'discovered'>): string {
  return SKILLS_SYSTEM_PROMPT
    .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
    .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources));
}

function createAutoMemorySystemMessage(content: string | undefined, memoryRootDir: string | undefined): string | undefined {
  if (!memoryRootDir) {
    return content;
  }

  const lines = [
    '# auto memory',
    '',
    `You have a persistent, file-based memory system at \`${memoryRootDir}/\`.`,
    'This directory already exists — write to it directly with the Write tool (do not run mkdir or check for its existence).',
    '',
    '## Types of memory',
    '',
    '- **user**: User role, preferences, knowledge level',
    '- **feedback**: Corrections or guidance from the user',
    '- **project**: Ongoing work, decisions, deadlines',
    '- **reference**: Pointers to external resources (URLs, project trackers)',
    '',
    '## How to save memories',
    '',
    'Write a topic file with YAML frontmatter, then update `MEMORY.md` index:',
    '',
    '```markdown',
    '---',
    'name: memory-name',
    'description: one-line description',
    'type: user | feedback | project | reference',
    '---',
    'Memory content...',
    '```',
    '',
    '## When to save',
    '- User says "remember" or asks you to note something',
    '- User corrects your behavior → save as **feedback**',
    '- User shares role/preference → save as **user**',
    '- You learn project context → save as **project**',
    '- External resource mentioned → save as **reference**',
    '',
    '## Current memory',
    '',
    content ?? 'No memories recorded yet.',
  ];

  return lines.join('\n');
}
