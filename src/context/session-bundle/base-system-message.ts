import type {BaseMessage} from '@langchain/core/messages';
import type {GuidelinesSource} from '@context/instructions/guidelines';
import type {PromptSource} from '@context/prompts/prompt-source';
import {
  type SkillsSource,
} from '@capability/skill';
import {createSkillsRuntimeBundle} from '@context/skills/build';

const BASE_SYSTEM_MESSAGE_KEY = 'codaraSystemMessage';

export interface BaseSystemMessageBundle {
  systemMessage: string[];
  runtimeShared?: Record<string, unknown>;
}

export type BaseSystemMessageLoader = () => Promise<BaseSystemMessageBundle>;

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
}

export async function buildBaseSystemMessage(
  promptSourceOrOptions?: PromptSource | BuildBaseSystemMessageOptions,
  guidelinesSource?: GuidelinesSource,
  skillsSource?: SkillsSource,
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
    };
  }

  const promptMessage = await opts.promptSource?.getContent?.();
  const guidelinesMessage = await opts.guidelinesSource?.getContent?.();
  const skillsRuntime = await opts.skillsSource?.getRuntime();
  const skillsBundle = skillsRuntime ? createSkillsRuntimeBundle(skillsRuntime) : undefined;
  const systemMessage = [
    promptMessage,
    guidelinesMessage,
    skillsBundle?.systemMessage,
  ].filter((value): value is string => Boolean(value));
  const runtimeShared = {
    ...(skillsBundle?.runtimeShared ?? {}),
    ...(systemMessage.length > 0 ? createBaseSystemMessageRuntimeShared(systemMessage) : {}),
  };

  return {
    systemMessage,
    ...(Object.keys(runtimeShared).length > 0 ? {runtimeShared} : {}),
  };
}

export function createBaseSystemMessageLoader(
  options: BuildBaseSystemMessageOptions,
): BaseSystemMessageLoader {
  return () => buildBaseSystemMessage(options);
}

export function extendBaseSystemMessage(
  base: BaseSystemMessageBundle | undefined,
  additions: {
    systemMessages?: string[];
    prompts?: string[];
  } = {},
): BaseSystemMessageBundle {
  const extraSystemMessages = additions.systemMessages?.filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim()) ?? [];
  const extraPrompts = additions.prompts?.filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim()) ?? [];

  return {
    systemMessage: [
      ...(base?.systemMessage ?? []),
      ...extraSystemMessages,
      ...extraPrompts,
    ],
    ...(base?.runtimeShared ? {runtimeShared: {...base.runtimeShared}} : {}),
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

export function mergePreparedInstructionContext(
  target: PreparedInstructionContextTarget,
  base: BaseSystemMessageBundle,
): void {
  const existingSystemMessage = [...target.systemMessage];
  target.systemMessage = [...base.systemMessage, ...existingSystemMessage];
  target.runtime.shared = {
    ...(base.runtimeShared ?? {}),
    ...(target.runtime.shared ?? {}),
  };
  target.messages = target.state.messages;
}

