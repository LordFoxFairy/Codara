/**
 * Subagent run launch result — parsing and formatting.
 */

import {z} from 'zod';

const subagentRunLaunchResultSchema = z.object({
  type: z.literal('subagent_run_started'),
  runId: z.string().min(1),
  batchId: z.string().min(1).optional(),
  batchExpectedCount: z.number().int().positive().optional(),
  parentSessionId: z.string().min(1),
  sessionId: z.string().min(1),
  agentName: z.string().min(1),
  label: z.string().min(1),
});

export type SubagentRunLaunchResult = z.infer<typeof subagentRunLaunchResultSchema>;

export function readSubagentRunLaunchResult(value: unknown): SubagentRunLaunchResult | undefined {
  const parsed = subagentRunLaunchResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Format a launch result into a human-readable multi-line string. */
export function formatSubagentRunLaunchResult(result: SubagentRunLaunchResult): string {
  const lines = [
    'Subagent started in background.',
    `run_id: ${result.runId}`,
  ];
  if (result.batchId) lines.push(`batch_id: ${result.batchId}`);
  if (typeof result.batchExpectedCount === 'number') lines.push(`batch_expected_count: ${result.batchExpectedCount}`);
  lines.push(
    `agent: ${result.agentName}`,
    `label: ${result.label}`,
    `session_id: ${result.sessionId}`,
    `parent_session_id: ${result.parentSessionId}`,
  );
  return lines.join('\n');
}
