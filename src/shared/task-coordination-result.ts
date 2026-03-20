import {ToolMessage} from '@langchain/core/messages';

const SHARED_TASK_COORDINATION_KIND = 'shared_task_coordination';

export interface SharedTaskCoordinationArtifact {
  kind: typeof SHARED_TASK_COORDINATION_KIND;
  visibility: 'internal';
  content: string;
}

export function createInternalSharedTaskCoordinationMessage(
  content: string,
  toolCallId: string,
): ToolMessage {
  return new ToolMessage({
    content,
    tool_call_id: toolCallId,
    artifact: {
      kind: SHARED_TASK_COORDINATION_KIND,
      visibility: 'internal',
      content,
    } satisfies SharedTaskCoordinationArtifact,
  });
}

export function readSharedTaskCoordinationArtifact(value: unknown): SharedTaskCoordinationArtifact | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (record.kind !== SHARED_TASK_COORDINATION_KIND || record.visibility !== 'internal') {
    return undefined;
  }

  const content = typeof record.content === 'string' ? record.content : undefined;
  if (!content) {
    return undefined;
  }

  return {
    kind: SHARED_TASK_COORDINATION_KIND,
    visibility: 'internal',
    content,
  };
}
