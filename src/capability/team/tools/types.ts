import type {TeamRegistry} from '@capability/team/team-registry';
import type {TeamTransport} from '@capability/team/transport/types';
import type {TeamEventEmitter} from '@capability/team/events';

export interface TeamToolContext {
  teamId: string;
  memberId: string;
  registry: TeamRegistry;
  transport: TeamTransport;
  emitter: TeamEventEmitter;
  projectRoot: string;
}
