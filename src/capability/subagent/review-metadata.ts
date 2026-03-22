import {z} from 'zod';
import type {ReviewResumePayload} from '@core/agent/models/agent';
import type {ExecutionContextMetadata} from '@core/pipeline/types';

const parentExecutionSchema = z.object({
  sessionId: z.string().trim().min(1),
  runId: z.string().trim().min(1),
  requestId: z.string().trim().min(1),
  toolCallId: z.string().trim().min(1),
  turn: z.number(),
  maxTurns: z.number(),
  toolIndex: z.number(),
});

const subagentReviewMetadataSchema = z.object({
  codara: z.object({
    subagentReview: z.object({
      childSessionId: z.string().trim().min(1),
      recovery: z.object({
        toolNames: z.array(z.string().trim().min(1)).optional(),
        systemMessages: z.array(z.string()).optional(),
        maxTurns: z.number().int().positive().optional(),
      }).optional(),
    }).optional(),
    subagentRun: z.object({
      childSessionId: z.string().trim().min(1),
      recovery: z.object({
        toolNames: z.array(z.string().trim().min(1)).optional(),
        systemMessages: z.array(z.string()).optional(),
        maxTurns: z.number().int().positive().optional(),
      }).optional(),
    }).optional(),
  }).loose().optional(),
}).loose();

const subagentRuntimeContextSchema = z.object({
  review: z.object({
    currentPause: z.object({
      metadata: z.unknown().optional(),
    }).loose().optional(),
    resume: z.unknown().optional(),
  }).loose().optional(),
}).loose();

interface ParentExecution {
  sessionId: string;
  runId: string;
  requestId: string;
  toolCallId: string;
  turn: number;
  maxTurns: number;
  toolIndex: number;
}

export interface SubagentPauseRecoverySpec {
  toolNames?: string[];
  systemMessages?: string[];
  maxTurns?: number;
}

export interface SubagentResumeState {
  childSessionId: string;
  payload: ReviewResumePayload;
}

export interface SubagentRunRecoveryMetadata {
  childSessionId: string;
  recovery?: SubagentPauseRecoverySpec;
}

export interface SubagentParentRuntimeMetadata {
  parentExecution: ParentExecution;
  resume?: SubagentResumeState;
}

export function readSubagentParentRuntimeMetadata(configurable: unknown): SubagentParentRuntimeMetadata {
  const record = subagentRuntimeContextSchema.safeParse(readSubagentRuntimeContext(configurable));
  const runtimeContext = record.success ? record.data : undefined;
  const resume = readSubagentResumeState(runtimeContext);

  return {
    parentExecution: readParentExecution(
      configurable && typeof configurable === 'object' && 'execution' in configurable
        ? configurable.execution
        : undefined,
    ),
    ...(resume ? {resume} : {}),
  };
}

export function readSubagentPauseMetadata(metadata: unknown): {
  childSessionId: string;
  recovery?: SubagentPauseRecoverySpec;
} | undefined {
  const parsed = subagentReviewMetadataSchema.safeParse(metadata);
  const review = parsed.success ? parsed.data.codara?.subagentReview : undefined;
  const childSessionId = review?.childSessionId;
  if (!childSessionId) {
    return undefined;
  }

  return {
    childSessionId,
    ...(review?.recovery ? {recovery: review.recovery} : {}),
  };
}

export function mergeSubagentPauseMetadata(
  metadata: Record<string, unknown> | undefined,
  review: {
    childSessionId: string;
    recovery?: SubagentPauseRecoverySpec;
  },
): Record<string, unknown> {
  const parsed = subagentReviewMetadataSchema.safeParse(metadata);
  const base = parsed.success ? parsed.data : {};
  const codara = base.codara ?? {};

  return {
    ...base,
    codara: {
      ...codara,
      subagentReview: {
        childSessionId: review.childSessionId,
        ...(review.recovery ? {recovery: review.recovery} : {}),
      },
    },
  };
}

export function readSubagentRunRecoveryMetadata(
  metadata: unknown,
): SubagentRunRecoveryMetadata | undefined {
  const parsed = subagentReviewMetadataSchema.safeParse(metadata);
  const run = parsed.success ? parsed.data.codara?.subagentRun : undefined;
  if (!run?.childSessionId) {
    return undefined;
  }

  return {
    childSessionId: run.childSessionId,
    ...(run.recovery ? {recovery: run.recovery} : {}),
  };
}

export function mergeSubagentRunRecoveryMetadata(
  metadata: Record<string, unknown> | undefined,
  subagentRun: SubagentRunRecoveryMetadata,
): Record<string, unknown> {
  const parsed = subagentReviewMetadataSchema.safeParse(metadata);
  const base = parsed.success ? parsed.data : {};
  const codara = base.codara ?? {};

  return {
    ...base,
    codara: {
      ...codara,
      subagentRun: {
        childSessionId: subagentRun.childSessionId,
        ...(subagentRun.recovery ? {recovery: subagentRun.recovery} : {}),
      },
    },
  };
}

function readSubagentRuntimeContext(configurable: unknown): unknown {
  if (!configurable || typeof configurable !== 'object') {
    return configurable;
  }

  const record = configurable as Record<string, unknown>;
  return record.context ?? record.runtimeContext ?? configurable;
}

function readSubagentResumeState(runtimeContext: unknown): SubagentResumeState | undefined {
  const parsed = subagentRuntimeContextSchema.safeParse(runtimeContext);
  if (!parsed.success) {
    return undefined;
  }

  const review = parsed.data.review;
  const subagentReview = readSubagentPauseMetadata(review?.currentPause?.metadata);
  if (!subagentReview) {
    return undefined;
  }

  const payload = review?.resume;
  if (payload === undefined) {
    return undefined;
  }

  return {
    childSessionId: subagentReview.childSessionId,
    payload,
  };
}

function readParentExecution(value: unknown): ExecutionContextMetadata & {
  toolIndex: number;
  toolCallId: string;
} {
  const parsed = parentExecutionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Subagent tool requires execution metadata with toolCallId and toolIndex.');
  }

  return parsed.data;
}
