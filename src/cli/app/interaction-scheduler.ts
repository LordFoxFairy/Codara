/**
 * Interaction scheduler -- serializes CLI interactions.
 *
 * Only one interaction (prompt submission or review response) can be
 * active at a time. Additional requests are queued and drained in FIFO
 * order once the current interaction completes.
 */
import type {ReviewResumePayload} from '@/index';
import type {CliInteractionKind} from './view-state';

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

export class CliInteractionScheduler {
  private running = false;
  private activeKind: CliInteractionKind | undefined;
  private readonly queuedInteractions: QueuedCliInteraction[] = [];

  readSnapshot(): CliInteractionSchedulerSnapshot {
    return {
      activeKind: this.activeKind,
      pendingCount: this.queuedInteractions.length,
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

  requeueInteraction(interaction: QueuedCliInteraction): void {
    this.queuedInteractions.unshift(interaction);
  }

  takeNextInteraction(): QueuedCliInteraction | undefined {
    return this.queuedInteractions.shift();
  }
}
