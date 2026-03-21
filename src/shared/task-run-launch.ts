import {z} from 'zod';

const taskRunLaunchResultSchema = z.object({
  type: z.literal('task_run_started'),
  runId: z.string().trim().min(1),
  parentSessionId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1),
  agentName: z.string().trim().min(1),
  label: z.string().trim().min(1),
});

export interface TaskRunLaunchResult {
  type: 'task_run_started';
  runId: string;
  parentSessionId: string;
  sessionId: string;
  agentName: string;
  label: string;
}

export function readTaskRunLaunchResult(value: unknown): TaskRunLaunchResult | undefined {
  const parsed = taskRunLaunchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export function formatTaskRunLaunchResult(result: TaskRunLaunchResult): string {
  void result;
  return [
    'Delegated task started in background.',
    'Do not restate launch metadata or promise follow-up.',
    'Wait for runtime updates, review requests, or the delegated result.',
  ].join('\n');
}
