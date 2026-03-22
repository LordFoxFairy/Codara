import {
  isInvalidSubagentCompletionResponse,
  shouldRetrySubagentCompletionResponse,
} from '@capability/subagent/completion';

export function isInvalidTaskCloseoutResponse(text: string | undefined): boolean {
  return isInvalidSubagentCompletionResponse(text);
}

export function shouldRetryTaskCloseoutResponse(input: {
  text: string | undefined;
  launchedTaskToolCall?: boolean;
  attempt: number;
  maxAttempts: number;
}): boolean {
  return shouldRetrySubagentCompletionResponse({
    text: input.text,
    launchedSubagentToolCall: input.launchedTaskToolCall,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
  });
}
