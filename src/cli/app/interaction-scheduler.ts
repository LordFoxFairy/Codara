import type {ReviewResumePayload} from '@core/agent';
import type {CliInteractionKind} from './view-state';

export interface SubagentCompletionHandoff {
  runId: string;
  label: string;
  agentName: string;
  status: 'completed' | 'failed';
  summary?: string;
  errorMessage?: string;
  toolUseCount?: number;
  totalTokens?: number;
}

export interface SubagentCompletionContinuation {
  parentSessionId: string;
  runs: SubagentCompletionHandoff[];
}

export interface QueuedSessionPromptInteraction {
  kind: 'session_prompt';
  prompt: string;
}

export interface QueuedReviewResponseInteraction {
  kind: 'review_response';
  reviewId: string;
  payload: ReviewResumePayload;
}

export type QueuedCliInteraction = QueuedSessionPromptInteraction | QueuedReviewResponseInteraction;

export interface CliInteractionSchedulerSnapshot {
  activeKind?: CliInteractionKind;
  pendingCount: number;
}

export class CliInteractionScheduler<TContinuation = SubagentCompletionContinuation> {
  private running = false;
  private activeKind: CliInteractionKind | undefined;
  private readonly queuedInteractions: QueuedCliInteraction[] = [];
  private pendingContinuation: TContinuation | undefined;

  readSnapshot(): CliInteractionSchedulerSnapshot {
    return {
      activeKind: this.activeKind,
      pendingCount: this.queuedInteractions.length + (this.pendingContinuation ? 1 : 0),
    };
  }

  isRunning(): boolean {
    return this.running;
  }

  begin(kind: CliInteractionKind): void {
    this.running = true;
    this.activeKind = kind;
  }

  end(): void {
    this.running = false;
    this.activeKind = undefined;
  }

  enqueueSessionPrompt(prompt: string): void {
    this.queuedInteractions.push({kind: 'session_prompt', prompt});
  }

  enqueueReviewResponse(interaction: Omit<QueuedReviewResponseInteraction, 'kind'>): void {
    this.queuedInteractions.push({
      kind: 'review_response',
      ...interaction,
    });
  }

  takeNextInteraction(): QueuedCliInteraction | undefined {
    return this.queuedInteractions.shift();
  }

  setPendingContinuation(continuation: TContinuation): void {
    this.pendingContinuation = continuation;
  }

  takePendingContinuation(): TContinuation | undefined {
    const continuation = this.pendingContinuation;
    this.pendingContinuation = undefined;
    return continuation;
  }
}
