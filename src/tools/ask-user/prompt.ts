/**
 * AskUserQuestion tool prompt -- context-sensitive instructions for the LLM.
 *
 * Aligned with Claude Code AskUserQuestionTool prompt pattern.
 */

export function getAskUserToolPrompt(): string {
  return [
    'Request structured user input before the agent continues.',
    'Use this when key requirements, scope, priorities, or constraints are missing',
    'and proceeding would force guesses, weak plans, or wasted work.',
    '',
    'Guidelines:',
    '- Ask at most 4 questions per call',
    '- Keep each tab/header label to 12 characters or fewer',
    '- Gather needed clarification in one questionnaire whenever possible',
    '- Set question input explicitly: select for one choice, multiselect for multiple, text for free-form',
    '- The CLI already allows users to type a custom answer, so use explicit options unless truly free-form',
    '- Call AskUserQuestion directly instead of saying you will ask questions',
    '- Once answered, continue the original task immediately without summarizing the questionnaire back',
  ].join('\n');
}
