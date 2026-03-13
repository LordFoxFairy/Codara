import {HumanMessage, type BaseMessage} from '@langchain/core/messages';
import type {GuidelinesSource} from '@core/instructions/guidelines';
import type {PromptSource} from '@core/instructions/prompt';
import type {AutoMemorySource} from '@core/memory/auto-memory';
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

const PROGRESSIVE_INSTRUCTION_PREFIX = 'Additional active instructions for the current workspace subtree:';

export async function buildBaseSystemMessage(
  promptSource?: PromptSource,
  guidelinesSource?: GuidelinesSource,
  skillsSource?: SkillsSource,
  autoMemorySource?: AutoMemorySource,
): Promise<BaseSystemMessageBundle> {
  const promptMessage = await promptSource?.getBootstrapContent?.();
  const guidelinesMessage = await guidelinesSource?.getBootstrapContent?.();
  const skillsRuntime = await skillsSource?.getRuntime?.();
  const autoMemoryMessage = await autoMemorySource?.getContent?.();
  const systemMessage = [
    promptMessage,
    guidelinesMessage,
    skillsRuntime ? createSkillsSystemMessage(skillsRuntime) : undefined,
    autoMemoryMessage,
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

export function createBaseSystemMessageRuntimeShared(systemMessage: string[]): Record<string, BaseSystemMessageRuntimeData> {
  return {
    [BASE_SYSTEM_MESSAGE_KEY]: {
      systemMessage: [...systemMessage],
    },
  };
}

export async function buildProgressiveInstructionMessages(
  promptSource?: PromptSource,
  guidelinesSource?: GuidelinesSource,
): Promise<BaseMessage[]> {
  const promptMessage = await promptSource?.getProgressiveContent?.();
  const guidelinesMessage = await guidelinesSource?.getProgressiveContent?.();
  return [
    promptMessage ? createProgressiveInstructionMessage(promptMessage) : undefined,
    guidelinesMessage ? createProgressiveInstructionMessage(guidelinesMessage) : undefined,
  ].filter((message): message is BaseMessage => Boolean(message));
}

function createSkillsSystemMessage(runtime: Pick<SkillsRuntimeData, 'sources' | 'discovered'>): string {
  return SKILLS_SYSTEM_PROMPT
    .replace('{skills_locations}', formatSkillsLocations(runtime.sources))
    .replace('{skills_list}', formatSkillsList(runtime.discovered, runtime.sources));
}

function createProgressiveInstructionMessage(content: string): BaseMessage {
  return new HumanMessage([PROGRESSIVE_INSTRUCTION_PREFIX, '', content].join('\n'));
}
