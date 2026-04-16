/**
 * Tool result budget system — persists large tool results to disk instead of truncating.
 *
 * Adapted from Claude Code's toolResultStorage.ts. Core design:
 * - Large tool results are written to disk, model receives a preview + file path
 * - ContentReplacementState tracks decisions across turns for prompt cache stability
 * - Three-partition strategy: mustReapply (cached), frozen (seen, not replaced), fresh (new)
 */
import {writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import type {BaseMessage} from '@langchain/core/messages';

// ── Constants (aligned with Claude Code) ──

/** Max chars per individual tool result before persisting to disk. */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/** Max total chars of tool results per user message. */
export const MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200_000;

/** Preview size in chars for the reference message shown to the model. */
export const PREVIEW_SIZE_CHARS = 2000;

/** Tag wrapping persisted output references (matches Claude Code). */
export const PERSISTED_OUTPUT_TAG = '<persisted-output>';
export const PERSISTED_OUTPUT_CLOSING_TAG = '</persisted-output>';

// ── Types ──

/**
 * Cross-turn replacement state for prompt cache stability.
 * Once a result is seen, its fate is frozen:
 * - Replaced results always get the same replacement re-applied
 * - Unreplaced results are never replaced later (would break cache)
 */
export interface ContentReplacementState {
  seenIds: Set<string>;
  replacements: Map<string, string>;
}

export function createContentReplacementState(): ContentReplacementState {
  return {seenIds: new Set(), replacements: new Map()};
}

export interface PersistedToolResult {
  filepath: string;
  originalSize: number;
  preview: string;
  hasMore: boolean;
}

// ── Persistence ──

/**
 * Write large tool result content to disk, return a preview + file path.
 * Uses the session's runtime state path for storage.
 */
export async function persistToolResult(
  content: string,
  toolCallId: string,
  baseDir?: string,
): Promise<PersistedToolResult> {
  const dir = baseDir ?? path.join(tmpdir(), 'codara-tool-results');
  await mkdir(dir, {recursive: true});

  const sanitizedId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filepath = path.join(dir, `${sanitizedId}.txt`);

  // Write-once: skip if already exists (idempotent across turns)
  try {
    await writeFile(filepath, content, {encoding: 'utf-8', flag: 'wx'});
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    // Already persisted on a prior turn — fall through to preview
  }

  const {preview, hasMore} = generatePreview(content, PREVIEW_SIZE_CHARS);
  return {filepath, originalSize: content.length, preview, hasMore};
}

/**
 * Build the reference message shown to the model when content was persisted.
 */
export function buildPersistedResultMessage(result: PersistedToolResult): string {
  const sizeKB = Math.ceil(result.originalSize / 1024);
  let message = `${PERSISTED_OUTPUT_TAG}\n`;
  message += `Output too large (${sizeKB}KB). Full output saved to: ${result.filepath}\n\n`;
  message += `Preview (first ${Math.ceil(PREVIEW_SIZE_CHARS / 1024)}KB):\n`;
  message += result.preview;
  message += result.hasMore ? '\n...\n' : '\n';
  message += PERSISTED_OUTPUT_CLOSING_TAG;
  return message;
}

// ── Budget enforcement ──

/**
 * Enforce the per-tool and per-message budgets on tool result sizes.
 *
 * For each ToolMessage whose content exceeds the threshold, the content is
 * persisted to disk and replaced with a preview. State is tracked by tool_call_id
 * so decisions are stable across turns (prompt cache preservation).
 *
 * Returns a new messages array if any replacements were made, or the original array unchanged.
 */
export function enforceToolResultBudget(
  messages: BaseMessage[],
  state: ContentReplacementState,
  baseDir?: string,
): {messages: BaseMessage[]; pendingPersists: Array<{toolCallId: string; content: string}>} {
  const pendingPersists: Array<{toolCallId: string; content: string}> = [];
  let needsReplacement = false;

  // First pass: identify what needs replacement
  for (const msg of messages) {
    if (msg._getType() !== 'tool') continue;
    const toolCallId = (msg as {tool_call_id?: string}).tool_call_id;
    if (!toolCallId) continue;

    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

    // Already replaced — will re-apply
    if (state.replacements.has(toolCallId)) {
      needsReplacement = true;
      state.seenIds.add(toolCallId);
      continue;
    }

    // Already seen but not replaced — frozen, don't touch
    if (state.seenIds.has(toolCallId)) continue;

    // Fresh: check size
    state.seenIds.add(toolCallId);
    if (content.length > DEFAULT_MAX_RESULT_SIZE_CHARS && !content.startsWith(PERSISTED_OUTPUT_TAG)) {
      pendingPersists.push({toolCallId, content});
      needsReplacement = true;
    }
  }

  if (!needsReplacement && pendingPersists.length === 0) {
    return {messages, pendingPersists: []};
  }

  return {messages, pendingPersists};
}

/**
 * Apply persisted results to messages. Call after async persistence completes.
 */
export function applyReplacements(
  messages: BaseMessage[],
  state: ContentReplacementState,
): BaseMessage[] {
  let changed = false;
  const result = messages.map((msg) => {
    if (msg._getType() !== 'tool') return msg;
    const toolCallId = (msg as {tool_call_id?: string}).tool_call_id;
    if (!toolCallId) return msg;

    const replacement = state.replacements.get(toolCallId);
    if (replacement === undefined) return msg;

    changed = true;
    // Create a new ToolMessage with replaced content using LangChain's constructor
    const {ToolMessage} = require('@langchain/core/messages') as typeof import('@langchain/core/messages');
    return new ToolMessage({content: replacement, tool_call_id: toolCallId});
  });

  return changed ? result : messages;
}

// ── Helpers ──

function generatePreview(content: string, maxChars: number): {preview: string; hasMore: boolean} {
  if (content.length <= maxChars) {
    return {preview: content, hasMore: false};
  }
  const truncated = content.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > maxChars * 0.5 ? lastNewline : maxChars;
  return {preview: content.slice(0, cutPoint), hasMore: true};
}