/**
 * Subagent result parsing — pure Zod parser, no layer dependencies.
 */

import {z} from 'zod';

const subagentResultSchema = z.object({
  type: z.literal('subagent_result'),
  sessionId: z.string(),
  turns: z.number(),
  reason: z.enum(['complete', 'error', 'max_turns']),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  toolUseCount: z.number().optional(),
  totalTokens: z.number().optional(),
});

export interface SubagentResult {
  type: 'subagent_result';
  sessionId: string;
  turns: number;
  reason: 'complete' | 'error' | 'max_turns';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

export function readSubagentResult(value: unknown): SubagentResult | undefined {
  const parsed = subagentResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
