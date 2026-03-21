import type {ApprovalStore} from '@durability/approval-store';
import type {TaskRuntime} from '@capability/task/runtime';
import type {TaskRunStore, TaskStore} from '@capability/task/types';
import type {DelegatedAgentOptions} from '@capability/task/delegation';

export interface CreateTaskToolOptions extends DelegatedAgentOptions {
  description?: string;
  runStore?: TaskRunStore;
  approvalStore?: ApprovalStore;
  runtime?: TaskRuntime;
}

export interface CreateTaskMiddlewareOptions extends CreateTaskToolOptions {
  store?: TaskStore;
  name?: string;
}
