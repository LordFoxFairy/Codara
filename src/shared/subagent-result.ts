/**
 * Subagent result parsing — pure Zod parser, no layer dependencies.
 */

import {z} from 'zod';

const subagentResultSchema = z.object({
  type: z.literal('subagent_result'),
  sessionId: z.string(),
  turns: z.number(),
  reason: z.enum(['complete', 'error', 'max_turns', 'budget_exhausted', 'aborted']),
  runId: z.string().optional(),
  label: z.string().optional(),
  agentName: z.string().optional(),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  toolUseCount: z.number().optional(),
  totalTokens: z.number().optional(),
});

export type SubagentResult = z.infer<typeof subagentResultSchema>;

export function readSubagentResult(value: unknown): SubagentResult | undefined {
  const parsed = subagentResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
