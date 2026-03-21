import type {Session} from '@durability/session';
import type {CodaraStreamRequest} from './types';
import type {CodaraReviewControl} from './review-control';

export function createCodaraInteractionStream(options: {
  session: Session;
  reviewControl: CodaraReviewControl;
}): (request: CodaraStreamRequest) => AsyncGenerator<import('@core/agent').AgentStreamOutput, void, void> {
  const {session, reviewControl} = options;

  return async function* streamInteraction(request: CodaraStreamRequest) {
    switch (request.kind) {
      case 'prompt':
        yield* session.stream(request.input, request.config);
        return;
      case 'continuation':
        yield* session.stream(undefined, {
          ...request.config,
          context: request.context,
        });
        return;
      case 'pause':
        yield* session.resumePauseStream(request.payload, request.config);
        return;
      case 'review':
        yield* reviewControl.streamReview(request.payload, request.config);
        return;
    }
  };
}
