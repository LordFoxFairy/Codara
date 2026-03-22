import type {ApprovalStore} from '@durability/approval-store';
import type {AgentRuntime} from '@capability/subagent/runtime';
import type {AgentRunStore} from '@capability/subagent/types';
import type {DelegatedAgentOptions} from '@capability/subagent/agent';

export interface CreateAgentToolOptions extends DelegatedAgentOptions {
  description?: string;
  runStore?: AgentRunStore;
  approvalStore?: ApprovalStore;
  runtime?: AgentRuntime;
}

export interface CreateAgentMiddlewareOptions extends CreateAgentToolOptions {
  name?: string;
}
