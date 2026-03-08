import type {MemoryLoadOptions} from '@core/memory/types';

const DEFAULT_MAX_MEMORY_CHARS = 12_000;

/** 将多个 MEMORY.md 记忆源格式化为统一的系统消息片段。 */
export function formatMemory(
  memories: Array<{scope: 'global' | 'project'; path: string; content: string}>,
  options: Pick<MemoryLoadOptions, 'maxChars'> = {}
): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_MEMORY_CHARS;
  const lines = [
    'Use the MEMORY.md content below as long-term project memory.',
    'Treat this memory as durable context that supplements project guidelines and current conversation state.',
  ];

  for (const memory of memories) {
    const label = memory.scope === 'global' ? 'Global MEMORY.md' : 'Project MEMORY.md';
    lines.push('', `## ${label}`, memory.path, limitMemoryContent(memory.content, maxChars));
  }

  return lines.join('\n');
}

function limitMemoryContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars).trimEnd()}\n\n[truncated]`;
}
