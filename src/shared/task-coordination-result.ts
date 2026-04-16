/**
 * Shared task coordination artifact — internal ToolMessage payloads
 * used to pass coordination data between tasks without exposing it to users.
 */

import {ToolMessage} from '@langchain/core/messages';

const ARTIFACT_KIND = 'shared_task_coordination' as const;

export interface SharedTaskCoordinationArtifact {
  kind: typeof ARTIFACT_KIND;
  visibility: 'internal';
  content: string;
}

/** Create an internal-only ToolMessage carrying task coordination content. */
export function createInternalSharedTaskCoordinationMessage(
  content: string,
  toolCallId: string,
): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: toolCallId,
    artifact: {
      kind: ARTIFACT_KIND,
      visibility: 'internal',
      content,
    } satisfies SharedTaskCoordinationArtifact,
  });
}

/** Read a SharedTaskCoordinationArtifact from an unknown value, or undefined if invalid. */
export function readSharedTaskCoordinationArtifact(value: unknown): SharedTaskCoordinationArtifact | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (record.kind !== ARTIFACT_KIND || record.visibility !== 'internal') return undefined;
  if (typeof record.content !== 'string' || !record.content) return undefined;

  return {kind: ARTIFACT_KIND, visibility: 'internal', content: record.content};
}
