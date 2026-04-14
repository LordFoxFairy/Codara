import {AIMessage, type BaseMessage, HumanMessage, SystemMessage} from '@langchain/core/messages';

export interface CompactOptions {
  keepRecentTurns: number;
}

/**
 * Compact messages by removing old turns while preserving:
 * - All SystemMessages
 * - Turn-aligned boundaries (never split AIMessage + ToolMessage pairs)
 * - Most recent N turns
 * Produces a structured summary of dropped content.
 */
export function compactMessages(
  messages: readonly BaseMessage[],
  options: CompactOptions = {keepRecentTurns: 3},
): BaseMessage[] {
  const systemMessages = messages.filter(m => m instanceof SystemMessage);
  const nonSystem = messages.filter(m => !(m instanceof SystemMessage));
  const turns = groupIntoTurns(nonSystem);

  if (turns.length <= options.keepRecentTurns) {
    return [...messages]; // Nothing to compact
  }

  const keepCount = Math.min(options.keepRecentTurns, turns.length);
  const keptTurns = turns.slice(-keepCount);
  const droppedTurns = turns.slice(0, turns.length - keepCount);
  const summary = buildCompactionSummary(droppedTurns.flat());

  return [
    ...systemMessages,
    ...(summary ? [summary] : []),
    ...keptTurns.flat(),
  ];
}

/**
 * Detect if an error represents context window exhaustion.
 */
export function isContextWindowExhausted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('context length exceeded')
    || msg.includes('maximum context length')
    || msg.includes('too many tokens')
    || msg.includes('prompt is too long')
    || msg.includes('context_length_exceeded');
}

/**
 * Group messages into turn-aligned units.
 * A turn starts with a HumanMessage and includes all subsequent
 * AI and Tool messages until the next HumanMessage.
 */
function groupIntoTurns(messages: BaseMessage[]): BaseMessage[][] {
  const turns: BaseMessage[][] = [];
  let current: BaseMessage[] = [];

  for (const msg of messages) {
    if (msg instanceof HumanMessage && current.length > 0) {
      turns.push(current);
      current = [];
    }
    current.push(msg);
  }
  if (current.length > 0) {
    turns.push(current);
  }

  return turns;
}

function buildCompactionSummary(dropped: BaseMessage[]): SystemMessage | undefined {
  if (dropped.length === 0) return undefined;

  const toolNames = new Set<string>();
  for (const msg of dropped) {
    if (msg instanceof AIMessage && msg.tool_calls?.length) {
      for (const tc of msg.tool_calls) toolNames.add(tc.name);
    }
  }

  const parts = [
    `[Conversation compacted] ${dropped.length} earlier messages were removed to free context space.`,
  ];
  if (toolNames.size > 0) {
    parts.push(`Tools used in compacted section: ${[...toolNames].sort().join(', ')}.`);
  }

  return new SystemMessage(parts.join(' '));
}
