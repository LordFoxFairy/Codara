import type {BaseMessage} from '@langchain/core/messages';
import type {AgentRuntimeContext} from '@core/agents';
import type {SummaryRecord} from '@core/summary/types';

const CODARA_KEY = 'codara';
const SUMMARY_KEY = 'summary';

/** 读取当前运行时中的摘要记录。 */
export function readSummaryRecord(context: AgentRuntimeContext): SummaryRecord | undefined {
  const codara = asRecord(context[CODARA_KEY]);
  const summary = asRecord(codara[SUMMARY_KEY]);
  const content = typeof summary.content === 'string' ? summary.content.trim() : '';
  if (!content) {
    return undefined;
  }

  return {
    content,
    updatedAt: typeof summary.updatedAt === 'string' ? summary.updatedAt : new Date().toISOString(),
    summarizedMessages: typeof summary.summarizedMessages === 'number' ? summary.summarizedMessages : 0,
  };
}

/** 将摘要记录写回运行时上下文。 */
export function writeSummaryRecord(context: AgentRuntimeContext, record: SummaryRecord): void {
  const codara = asRecord(context[CODARA_KEY]);
  context[CODARA_KEY] = {
    ...codara,
    [SUMMARY_KEY]: {
      content: record.content,
      updatedAt: record.updatedAt,
      summarizedMessages: record.summarizedMessages,
    },
  };
}

/** 从消息历史中切出需要压缩的前半段，并保留最近消息。 */
export function splitMessagesForSummary(messages: BaseMessage[], keepLastMessages: number): BaseMessage[] {
  if (messages.length <= keepLastMessages) {
    return [];
  }
  return messages.slice(0, Math.max(0, messages.length - keepLastMessages));
}

/** 原地裁剪消息，只保留最近消息，保持数组引用稳定。 */
export function trimMessagesInPlace(messages: BaseMessage[], keepLastMessages: number): void {
  if (messages.length <= keepLastMessages) {
    return;
  }
  const removeCount = Math.max(0, messages.length - keepLastMessages);
  messages.splice(0, removeCount);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? {...(value as Record<string, unknown>)} : {};
}

/** 选择摘要应写入的持久上下文。 */
export function resolveSummaryContext(
  agentContext: AgentRuntimeContext | undefined,
  runtimeContext: AgentRuntimeContext
): AgentRuntimeContext {
  return agentContext ?? runtimeContext;
}
