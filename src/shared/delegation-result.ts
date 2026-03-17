/**
 * Delegated agent result parsing — pure Zod parser, no layer dependencies.
 *
 * Extracted to shared so that engine/session can read delegation results
 * without importing from capability/task.
 */

import {z} from 'zod';

const delegatedAgentResultSchema = z.object({
  type: z.literal('delegated_agent_result'),
  sessionId: z.string(),
  turns: z.number(),
  reason: z.enum(['complete', 'error', 'max_turns']),
  summary: z.string().optional(),
  errorMessage: z.string().optional(),
  toolUseCount: z.number().optional(),
  totalTokens: z.number().optional(),
});

export interface DelegatedAgentResult {
  type: 'delegated_agent_result';
  sessionId: string;
  turns: number;
  reason: 'complete' | 'error' | 'max_turns';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

export function readDelegatedAgentResult(value: unknown): DelegatedAgentResult | undefined {
  const parsed = delegatedAgentResultSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
