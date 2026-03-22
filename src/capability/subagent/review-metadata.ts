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

const delegatedReviewMetadataSchema = z.object({
  codara: z.object({
    delegatedSubagent: z.object({
      childSessionId: z.string().trim().min(1),
      parentToolName: z.string().trim().min(1),
      recovery: z.object({
        toolNames: z.array(z.string().trim().min(1)).optional(),
        systemMessages: z.array(z.string()).optional(),
        maxTurns: z.number().int().positive().optional(),
      }).optional(),
    }).optional(),
  }).loose().optional(),
}).loose();

const delegatedRuntimeContextSchema = z.object({
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

export interface DelegatedPauseRecoverySpec {
  toolNames?: string[];
  systemMessages?: string[];
  maxTurns?: number;
}

export interface DelegatedResumeState {
  childSessionId: string;
  payload: ReviewResumePayload;
}

export interface DelegatedParentRuntimeMetadata {
  parentExecution: ParentExecution;
  resume?: DelegatedResumeState;
}

export function readDelegatedParentRuntimeMetadata(
  configurable: unknown,
  toolName: string,
): DelegatedParentRuntimeMetadata {
  const record = delegatedRuntimeContextSchema.safeParse(readDelegatedRuntimeContext(configurable));
  const runtimeContext = record.success ? record.data : undefined;
  const resume = readDelegatedResumeState(runtimeContext, toolName);

  return {
    parentExecution: readParentExecution(
      configurable && typeof configurable === 'object' && 'execution' in configurable
        ? configurable.execution
        : undefined,
    ),
    ...(resume ? {resume} : {}),
  };
}

export function readDelegatedPauseMetadata(
  metadata: unknown,
  toolName: string,
): {
  childSessionId: string;
  parentToolName: string;
  recovery?: DelegatedPauseRecoverySpec;
} | undefined {
  const parsed = delegatedReviewMetadataSchema.safeParse(metadata);
  const delegated = parsed.success ? parsed.data.codara?.delegatedSubagent : undefined;
  const childSessionId = delegated?.childSessionId;
  const parentToolName = delegated?.parentToolName;

  if (!childSessionId || !parentToolName || parentToolName !== toolName) {
    return undefined;
  }

  return {
    childSessionId,
    parentToolName,
    ...(delegated?.recovery ? {recovery: delegated.recovery} : {}),
  };
}

export function mergeDelegatedPauseMetadata(
  metadata: Record<string, unknown> | undefined,
  delegated: {
    childSessionId: string;
    parentToolName: string;
    recovery?: DelegatedPauseRecoverySpec;
  },
): Record<string, unknown> {
  const parsed = delegatedReviewMetadataSchema.safeParse(metadata);
  const base = parsed.success ? parsed.data : {};
  const codara = base.codara ?? {};

  return {
    ...base,
    codara: {
      ...codara,
      delegatedSubagent: {
        childSessionId: delegated.childSessionId,
        parentToolName: delegated.parentToolName,
        ...(delegated.recovery ? {recovery: delegated.recovery} : {}),
      },
    },
  };
}

function readDelegatedRuntimeContext(configurable: unknown): unknown {
  if (!configurable || typeof configurable !== 'object') {
    return configurable;
  }

  const record = configurable as Record<string, unknown>;
  return record.context ?? record.runtimeContext ?? configurable;
}

function readDelegatedResumeState(
  runtimeContext: unknown,
  toolName: string,
): DelegatedResumeState | undefined {
  const parsed = delegatedRuntimeContextSchema.safeParse(runtimeContext);
  if (!parsed.success) {
    return undefined;
  }

  const review = parsed.data.review;
  const delegated = readDelegatedPauseMetadata(review?.currentPause?.metadata, toolName);
  if (!delegated) {
    return undefined;
  }

  const payload = review?.resume;
  if (payload === undefined) {
    return undefined;
  }

  return {
    childSessionId: delegated.childSessionId,
    payload,
  };
}

function readParentExecution(value: unknown): ExecutionContextMetadata & {
  toolIndex: number;
  toolCallId: string;
} {
  const parsed = parentExecutionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error('Delegation tools require execution metadata with toolCallId and toolIndex.');
  }

  return parsed.data;
}
