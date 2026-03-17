import type {TeamRegistry} from '@capability/team/team-registry';
import type {TeamTransport} from '@capability/team/transport/types';
import type {TeamBusEvent} from '@capability/team/events';

export interface TeamToolContext {
  teamId: string;
  memberId: string;
  registry: TeamRegistry;
  transport: TeamTransport;
  /** Emit a domain event — routed through TeamRuntime to the onTeamEvent callback. */
  emitEvent: (event: TeamBusEvent) => void;
  projectRoot: string;
}
