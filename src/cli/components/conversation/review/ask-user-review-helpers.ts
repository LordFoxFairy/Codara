import type {CliReviewAnswerValue, CliReviewState} from '../../../app/view-state';

export function supportsAskUserCustomOption(
  tab: NonNullable<CliReviewState['form']>['tabs'][number] | undefined,
): boolean {
  return Boolean(tab);
}

export function isOptionSelected(label: string, answer: string | string[] | undefined): boolean {
  if (!answer) return false;
  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.includes(label);
}

export function isAnswered(value: string | string[] | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.some((entry) => entry.trim().length > 0);
}

export function isCustomAnswerSelected(
  tab: NonNullable<CliReviewState['form']>['tabs'][number],
  answer: string | string[] | undefined,
): boolean {
  if (!answer) {
    return false;
  }

  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.some((entry) => entry.trim().length > 0 && tab.options.every((option) => option.label !== entry));
}

export function renderAskUserCustomRow(
  review: CliReviewState,
  activeTab: NonNullable<CliReviewState['form']>['tabs'][number],
  customOptionIndex: number,
): string {
  const isCustomFocused = review.focus !== 'actions' && review.selectedActionIndex === activeTab.options.length;
  const answer = review.form?.answers[activeTab.id];
  const isCustomSelected = isCustomAnswerSelected(activeTab, answer);
  const isEditingCustom = review.customInputActive && isCustomFocused;
  const isCustomChosen = isCustomSelected || review.customInputSelected === true;
  const marker = activeTab.input === 'multiselect'
    ? isCustomChosen ? '[x]' : '[ ]'
    : (isCustomChosen || isEditingCustom) ? '◉' : '○';
  const customValue = resolveAskUserCustomValue(activeTab, answer, isEditingCustom ? review.draft : undefined);
  const label = customValue.trim() ? customValue : 'Type something.';
  return `${customOptionIndex}. ${marker} ${label}`;
}

export function resolveAskUserCustomValue(
  activeTab: NonNullable<CliReviewState['form']>['tabs'][number],
  answer: CliReviewAnswerValue | undefined,
  draft: string | undefined,
): string {
  if (draft?.trim()) {
    return draft;
  }
  if (Array.isArray(answer)) {
    const customEntry = answer.find((entry) => activeTab.options.every((option) => option.label !== entry));
    return customEntry ?? '';
  }
  if (typeof answer === 'string' && activeTab.options.every((option) => option.label !== answer)) {
    return answer;
  }
  return '';
}
