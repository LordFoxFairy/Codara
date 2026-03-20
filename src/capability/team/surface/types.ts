import type {TeamRegistry} from '@capability/team/coordination/team-registry';
import type {TeamTransport} from '@capability/team/local-transport';
import type {TeamBusEvent} from '@capability/team/coordination/events';

export interface TeamToolContext {
  teamId: string;
  memberId: string;
  registry: TeamRegistry;
  transport: TeamTransport;
  /** Emit a domain event — routed through TeamRuntime to the onTeamEvent callback. */
  emitEvent: (event: TeamBusEvent) => void;
  projectRoot: string;
  /** Runtime reference for spawning members. */
  runtime?: {
    spawnMember?: (teamId: string, name: string, role: 'worker' | 'leader', model?: string) => Promise<{memberId: string; name: string; role: string; status: string}>;
    assignJob?: (teamId: string, jobId: string, memberId: string) => Promise<void>;
    shutdownTeam?: (teamId: string) => Promise<void>;
  };
}
