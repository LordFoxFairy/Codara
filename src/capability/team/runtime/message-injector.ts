import type { TeamMessage } from '@capability/team/types';

/**
 * Sort inbox messages: user messages first, then by timestamp ascending.
 */
export function sortInbox(messages: TeamMessage[]): TeamMessage[] {
  return [...messages].sort((a, b) => {
    if (a.from === 'user' && b.from !== 'user') return -1;
    if (b.from === 'user' && a.from !== 'user') return 1;
    return a.timestamp.localeCompare(b.timestamp);
  });
}

/**
 * Format a TeamMessage into a human-readable string for agent context.
 */
export function formatTeamMessage(msg: TeamMessage): string {
  switch (msg.type) {
    case 'job_assigned':
      return `You have been assigned a job: ${msg.content}`;
    case 'job_submitted':
      return `Job submitted for review: ${msg.content}`;
    case 'job_reviewed': {
      const meta = msg.metadata as { approved?: boolean; feedback?: string } | undefined;
      if (meta?.approved) return `Job approved: ${msg.content}`;
      return `Job rejected. Feedback: ${meta?.feedback ?? msg.content}`;
    }
    case 'job_completed':
      return `Job completed: ${msg.content}`;
    case 'question':
      return `Question from ${msg.from}: ${msg.content}`;
    case 'answer':
      return `Answer from ${msg.from}: ${msg.content}`;
    case 'shutdown_request':
      return 'Team is shutting down. Finish current work and stop.';
    case 'shutdown_response':
      return `${msg.from} acknowledged shutdown.`;
    case 'status_update':
      return `Status update from ${msg.from}: ${msg.content}`;
    case 'merge_conflict':
      return `Merge conflict: ${msg.content}`;
    case 'merge_request':
      return `Merge request: ${msg.content}`;
    case 'code_review':
      return `Code review from ${msg.from}: ${msg.content}`;
    case 'heartbeat':
      return `Heartbeat from ${msg.from}`;
    case 'message':
    default:
      return msg.content;
  }
}

/**
 * Convert TeamMessages into formatted system message strings
 * suitable for injection into an agent's context.
 */
export function prepareInboxInjection(messages: TeamMessage[]): string[] {
  const sorted = sortInbox(messages);
  return sorted.map(msg => {
    const formatted = formatTeamMessage(msg);
    return `[Team Message from ${msg.from}] (${msg.type})\n${formatted}`;
  });
}
