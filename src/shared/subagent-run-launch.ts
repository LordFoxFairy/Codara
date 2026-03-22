import {z} from 'zod';

export const agentRunLaunchResultSchema = z.object({
  type: z.literal('subagent_run_started'),
  runId: z.string().min(1),
  batchId: z.string().min(1).optional(),
  batchExpectedCount: z.number().int().positive().optional(),
  parentSessionId: z.string().min(1),
  sessionId: z.string().min(1),
  agentName: z.string().min(1),
  label: z.string().min(1),
});

export type SubagentRunLaunchResult = {
  type: 'subagent_run_started';
  runId: string;
  batchId?: string;
  batchExpectedCount?: number;
  parentSessionId: string;
  sessionId: string;
  agentName: string;
  label: string;
};

export function readSubagentRunLaunchResult(value: unknown): SubagentRunLaunchResult | undefined {
  const record = agentRunLaunchResultSchema.safeParse(value);
  return record.success ? record.data : undefined;
}

export function formatSubagentRunLaunchResult(result: SubagentRunLaunchResult): string {
  return [
    'Subagent started in background.',
    `run_id: ${result.runId}`,
    ...(result.batchId ? [`batch_id: ${result.batchId}`] : []),
    ...(typeof result.batchExpectedCount === 'number' ? [`batch_expected_count: ${result.batchExpectedCount}`] : []),
    `agent: ${result.agentName}`,
    `label: ${result.label}`,
    `session_id: ${result.sessionId}`,
    `parent_session_id: ${result.parentSessionId}`,
  ].join('\n');
}
