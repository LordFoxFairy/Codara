/**
 * 将多个 AGENTS.md 规范源格式化为统一的系统消息片段。
 *
 * 对齐 Claude Code 格式：
 * Contents of /path/to/file (label):
 * [content]
 */
export function formatGuidelines(
  guidelines: Array<{scope: 'global' | 'project'; path: string; content: string}>
): string {
  if (guidelines.length === 0) {
    return '';
  }

  const sections: string[] = [];

  for (const guideline of guidelines) {
    const label = guideline.scope === 'global'
      ? 'user instructions'
      : 'project instructions, checked into the codebase';

    sections.push(
      `Contents of ${guideline.path} (${label}):`,
      '',
      guideline.content
    );
  }

  return sections.join('\n');
}
