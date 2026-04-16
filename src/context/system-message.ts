/**
 * System message assembly — builds the complete system prompt from all instruction
 * sources (handbook, guidelines, skills, dynamic sections) and provides helpers
 * to apply/merge the result into agent runtime context.
 *
 * This is the central orchestrator that combines every context source into the
 * final system message array sent to the LLM.
 *
 * Consumed by: init-context.ts, assembly/context.ts, session-bootstrap.ts, subagent/bootstrap.ts.
 */
import type {BaseMessage} from '@langchain/core/messages';
import type {GuidelinesSource, PromptSource} from '@context/sources';
import {
  type SkillsSource,
} from '@capability/skill';
import {createSkillsRuntimeBundle} from '@context/skills-bundle';
import type {DynamicSectionRegistry} from '@context/dynamic-sections';

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
  dynamicSections?: DynamicSectionRegistry;
}

export async function buildBaseSystemMessage(
  options: BuildBaseSystemMessageOptions = {},
): Promise<BaseSystemMessageBundle> {
  const promptMessage = await options.promptSource?.getContent?.();
  const guidelinesMessage = await options.guidelinesSource?.getContent?.();
  const skillsRuntime = await options.skillsSource?.getRuntime();
  const skillsBundle = skillsRuntime ? createSkillsRuntimeBundle(skillsRuntime) : undefined;
  const dynamicParts = await options.dynamicSections?.resolve() ?? [];
  const systemMessage = [
    promptMessage,
    guidelinesMessage,
    skillsBundle?.systemMessage,
    ...dynamicParts,
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

