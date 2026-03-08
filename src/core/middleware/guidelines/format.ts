/** 将多个 AGENTS.md 规范源格式化为统一的系统消息片段。 */
export function formatGuidelines(
  guidelines: Array<{scope: 'global' | 'project'; path: string; content: string}>
): string {
  const lines = [
    'You must follow the AGENTS.md guidance loaded for this environment.',
    'Treat these guidelines as authoritative project guidance unless a higher-priority system instruction overrides them.',
  ];

  for (const guideline of guidelines) {
    const label = guideline.scope === 'global' ? 'Global AGENTS.md' : 'Project AGENTS.md';
    lines.push('', `## ${label}`, guideline.path, guideline.content);
  }

  return lines.join('\n');
}
