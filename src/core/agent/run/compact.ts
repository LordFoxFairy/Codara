import {AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage} from '@langchain/core/messages';

export interface CompactOptions {
  keepRecentTurns: number;
}

export interface CheapDrainResult {
  messages: BaseMessage[];
  freedCount: number;
}

// ── Message partitioning ────────────────────────────────────────────────────

/** Split messages into system + conversation turns. Shared by compact and drain. */
function partitionMessages(messages: readonly BaseMessage[], keepRecentTurns: number) {
  const system = messages.filter(m => m instanceof SystemMessage);
  const nonSystem = messages.filter(m => !(m instanceof SystemMessage));
  const turns = groupIntoTurns(nonSystem);
  const hasEnoughTurns = turns.length > keepRecentTurns;
  return {system, turns, hasEnoughTurns};
}

// ── Compact ─────────────────────────────────────────────────────────────────

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
  const {system, turns, hasEnoughTurns} = partitionMessages(messages, options.keepRecentTurns);
  if (!hasEnoughTurns) {
    return [...messages];
  }

  const keepCount = Math.min(options.keepRecentTurns, turns.length);
  const keptTurns = turns.slice(-keepCount);
  const droppedTurns = turns.slice(0, turns.length - keepCount);
  const summary = buildCompactionSummary(droppedTurns.flat());

  return [
    ...system,
    ...(summary ? [summary] : []),
    ...keptTurns.flat(),
  ];
}

// ── Cheap drain ─────────────────────────────────────────────────────────────

/** Minimum content length to consider a ToolMessage worth draining. */
const DRAIN_THRESHOLD_CHARS = 200;

/**
 * Strip tool result content from older messages to free context space
 * without a full LLM summary pass.
 *
 * Aligned with Claude Code's context collapse drain strategy — this is the
 * first recovery attempt before falling back to full compaction.
 */
export function cheapDrainMessages(
  messages: readonly BaseMessage[],
  keepRecentTurns = 3,
): CheapDrainResult {
  const {system, turns, hasEnoughTurns} = partitionMessages(messages, keepRecentTurns);
  if (!hasEnoughTurns) {
    return {messages: [...messages], freedCount: 0};
  }

  const protectedStart = turns.length - keepRecentTurns;
  let freedCount = 0;

  const result: BaseMessage[] = [...system];
  for (let i = 0; i < turns.length; i++) {
    for (const msg of turns[i]!) {
      if (i < protectedStart && isLargeToolMessage(msg)) {
        result.push(new ToolMessage({
          content: '[tool result removed to free context]',
          tool_call_id: msg.tool_call_id,
          name: msg.name,
        }));
        freedCount += 1;
        continue;
      }
      result.push(msg);
    }
  }

  return {messages: result, freedCount};
}

function isLargeToolMessage(msg: BaseMessage): msg is ToolMessage {
  if (!(msg instanceof ToolMessage)) return false;
  const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
  return content.length > DRAIN_THRESHOLD_CHARS;
}

// ── Context window detection ────────────────────────────────────────────────

/**
 * Detect if an error represents context window exhaustion.
 *
 * Checks structured fields first (HTTP status 413, error type), then falls
 * back to error message matching.
 */
export function isContextWindowExhausted(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const status =
      typeof record.status === 'number'
        ? record.status
        : typeof (record.response as Record<string, unknown> | undefined)?.status === 'number'
          ? (record.response as Record<string, unknown>).status as number
          : undefined;
    if (status === 413) return true;
  }

  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('context length exceeded')
    || msg.includes('maximum context length')
    || msg.includes('too many tokens')
    || msg.includes('prompt is too long')
    || msg.includes('context_length_exceeded');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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
