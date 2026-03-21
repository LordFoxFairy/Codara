import type {PauseRequest} from '@shared/contracts/agent-types';

export type CliHilInteractionKind = 'permission' | 'ask-user' | 'generic-review';

export function readCliHilInteractionKind(metadata: unknown): CliHilInteractionKind | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const codara = (metadata as Record<string, unknown>).codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const interaction = (codara as Record<string, unknown>).interaction;
  if (!interaction || typeof interaction !== 'object' || Array.isArray(interaction)) {
    return undefined;
  }

  const kind = (interaction as Record<string, unknown>).kind;
  return kind === 'permission' || kind === 'ask-user' || kind === 'generic-review'
    ? kind
    : undefined;
}

export function isPermissionPauseRequest(
  request: Pick<PauseRequest, 'metadata' | 'ui' | 'channel' | 'description'>,
): boolean {
  const interactionKind = readCliHilInteractionKind(request.metadata);
  if (interactionKind) {
    return interactionKind === 'permission';
  }

  return request.ui?.modal === 'permission-review'
    || request.channel === 'permission-center'
    || request.description.toLowerCase().includes('permission review');
}
