import {z} from 'zod';

const taskRunLaunchResultSchema = z.object({
  type: z.literal('task_run_started'),
  runId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  agentName: z.string().trim().min(1),
  label: z.string().trim().min(1),
});

export interface TaskRunLaunchResult {
  type: 'task_run_started';
  runId: string;
  sessionId: string;
  agentName: string;
  label: string;
}

export function readTaskRunLaunchResult(value: unknown): TaskRunLaunchResult | undefined {
  const parsed = taskRunLaunchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function formatTaskRunLaunchResult(result: TaskRunLaunchResult): string {
  return [
    'Delegated task started in background.',
    `run_id: ${result.runId}`,
    `delegate_id: ${result.sessionId}`,
    `agent: ${result.agentName}`,
  ].join('\n');
}
