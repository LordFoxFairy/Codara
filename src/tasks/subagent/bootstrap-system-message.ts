/**
 * System-message sanitization for subagents.
 *
 * Subagents do not inherit the parent's Skills System — that context is
 * intentionally dropped both from the base instruction bundle and from the
 * per-run AgentPreparationContext.
 *
 * @module
 */

import type {AgentPreparationContext} from '@shared/agent-types';
import type {extendBaseSystemMessage} from '@context/system-message';

export function stripInheritedSkillsFromBaseSystemMessage(
  base: ReturnType<typeof extendBaseSystemMessage>,
): ReturnType<typeof extendBaseSystemMessage> {
  const systemMessage = base.systemMessage.filter((section) => !section.trimStart().startsWith('## Skills System'));
  const runtimeShared = base.runtimeShared ? {...base.runtimeShared} : undefined;

  if (runtimeShared && Object.prototype.hasOwnProperty.call(runtimeShared, 'skills')) {
    delete runtimeShared.skills;
  }

  return {
    systemMessage,
    ...(runtimeShared && Object.keys(runtimeShared).length > 0 ? {runtimeShared} : {}),
  };
}

export function stripSkillsFromPreparedInstructionContext(context: AgentPreparationContext): void {
  context.systemMessage = context.systemMessage.filter((section) => !section.trimStart().startsWith('## Skills System'));
  if (context.runtime.shared && Object.prototype.hasOwnProperty.call(context.runtime.shared, 'skills')) {
    const nextShared = {...context.runtime.shared};
    delete nextShared.skills;
    context.runtime.shared = Object.keys(nextShared).length > 0 ? nextShared : undefined;
  }
}
