import type {SummaryRecord} from '@core/summary/types';

/** 将摘要格式化为系统消息片段。 */
export function formatSummaryRecord(record: SummaryRecord, maxChars = 6_000): string {
  const trimmed = record.content.trim();
  if (!trimmed) {
    return '';
  }

  const truncated = trimmed.length > maxChars;
  const content = truncated ? `${trimmed.slice(0, maxChars)}\n\n[truncated]` : trimmed;

  return [
    '# Conversation Summary',
    '',
    'The following summary captures earlier conversation context that has been compacted.',
    '',
    content,
  ].join('\n');
}
