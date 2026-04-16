import type {
  CliReviewAnswerValue,
  CliReviewFormState,
  CliReviewState,
} from './view-state';
import {
  getActiveReviewTab,
  isCustomSelectionIndex,
  supportsCustomReviewAnswer,
  resolveReviewInputSelectionIndex,
} from './review-form-tabs';

export function updateReviewFormAnswer(
  form: CliReviewFormState,
  answer: CliReviewAnswerValue,
): CliReviewFormState {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return form;
  }

  const normalizedAnswer = normalizeReviewAnswerValue(form, activeTab, answer);

  return {
    ...form,
    endStep: false,
    answers: {
      ...form.answers,
      [activeTab.id]: normalizedAnswer,
    },
  };
}

export function readReviewFormDraft(form: CliReviewFormState): string {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return '';
  }
  return formatReviewAnswerValue(form.answers[activeTab.id] ?? '');
}

export function readReviewCustomDraft(form: CliReviewFormState): string {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return '';
  }

  const answer = form.answers[activeTab.id];
  if (Array.isArray(answer)) {
    return answer.find((entry) => activeTab.options.every((option) => option.label !== entry)) ?? '';
  }
  if (typeof answer === 'string' && activeTab.options.every((option) => option.label !== answer)) {
    return answer;
  }
  return '';
}

export function hasCustomAnswerForActiveTab(form: CliReviewFormState): boolean {
  const activeTab = getActiveReviewTab(form);
  if (!activeTab) {
    return false;
  }

  return isCustomAnswerValue(activeTab, form.answers[activeTab.id]);
}

export function isCustomAnswerValue(
  tab: CliReviewFormState['tabs'][number],
  answer: CliReviewAnswerValue | undefined,
): boolean {
  if (!answer) {
    return false;
  }

  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.some((entry) => entry.trim().length > 0 && tab.options.every((option) => option.label !== entry));
}

export function toggleReviewFormSelection(form: CliReviewFormState, label: string): string[] {
  const activeTab = form.tabs[form.activeTabIndex];
  if (!activeTab) {
    return [label];
  }

  const current = form.answers[activeTab.id];
  const values = Array.isArray(current) ? [...current] : typeof current === 'string' && current.trim() ? [current] : [];
  const index = values.indexOf(label);
  if (index >= 0) {
    values.splice(index, 1);
    return values;
  }
  values.push(label);
  return values;
}

export function formatReviewAnswerValue(value: CliReviewAnswerValue): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

export function normalizeAnswerEntry(key: string, value: CliReviewAnswerValue): Array<[string, CliReviewAnswerValue]> {
  const normalizedKey = key.trim();
  if (!normalizedKey) {
    return [];
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? [[normalizedKey, value]] : [];
  }

  const normalized = value.filter((entry) => entry.trim().length > 0);
  return normalized.length > 0 ? [[normalizedKey, normalized]] : [];
}

export function applyCliReviewOptionSelection(
  current: CliReviewState,
  optionLabel: string | undefined,
): CliReviewState | undefined {
  if (!current.form || !optionLabel) {
    return undefined;
  }

  const activeTab = current.form.tabs[current.form.activeTabIndex];
  if (!activeTab) {
    return undefined;
  }

  const answer = activeTab.input === 'multiselect'
    ? toggleReviewFormSelection(current.form, optionLabel)
    : optionLabel;
  const selectedIndex = activeTab.options.findIndex((option) => option.label === optionLabel);
  return commitCliReviewAnswer(current, answer, selectedIndex >= 0 ? selectedIndex : current.selectedActionIndex);
}

export function commitCliReviewAnswer(
  current: CliReviewState,
  answer: CliReviewAnswerValue,
  selectedIndexOverride?: number,
): CliReviewState {
  if (!current.form) {
    return current;
  }

  const nextForm = updateReviewFormAnswer(current.form, answer);
  const nextSelectedIndex = selectedIndexOverride ?? resolveReviewInputSelectionIndex(nextForm, current.selectedActionIndex);
  return {
    ...clearCliReviewValidation(current),
    draft: readReviewFormDraft(nextForm),
    form: nextForm,
    focus: 'input',
    selectedActionIndex: nextSelectedIndex,
    customInputSelected: resolveCustomSelectionState(current, nextForm, nextSelectedIndex),
    customInputActive: isCustomSelectionIndex(nextForm, nextSelectedIndex) && hasCustomAnswerForActiveTab(nextForm),
  };
}

export function resolveCustomSelectionState(
  current: CliReviewState,
  nextForm: CliReviewFormState,
  nextSelectedIndex: number,
): boolean {
  const activeTab = getActiveReviewTab(nextForm);
  if (!activeTab) {
    return false;
  }

  if (activeTab.input !== 'multiselect') {
    return isCustomSelectionIndex(nextForm, nextSelectedIndex) && hasCustomAnswerForActiveTab(nextForm);
  }

  return current.customInputSelected === true
    || isCustomSelectionIndex(nextForm, nextSelectedIndex)
    || hasCustomAnswerForActiveTab(nextForm);
}

export function applyCliReviewAutoAnswers(
  review: CliReviewState,
  answers: Record<string, CliReviewAnswerValue> | undefined,
): CliReviewState {
  if (!review.form || !answers) {
    return review;
  }

  const nextAnswers = Object.fromEntries(
    Object.entries(answers)
      .flatMap(([key, value]) => normalizeAnswerEntry(key, value))
      .map(([key, value]) => [key, value]),
  );
  if (Object.keys(nextAnswers).length === 0) {
    return review;
  }

  const nextForm: CliReviewFormState = {
    ...review.form,
    answers: {
      ...review.form.answers,
      ...nextAnswers,
    },
  };

  return {
    ...clearCliReviewValidation(review),
    form: nextForm,
    draft: readReviewFormDraft(nextForm),
    customInputSelected: hasCustomAnswerForActiveTab(nextForm),
    customInputActive: hasCustomAnswerForActiveTab(nextForm),
  };
}

export function clearCliReviewValidation(current: CliReviewState): CliReviewState {
  if (!current.validationMessage) {
    return current;
  }

  return {
    ...current,
    validationMessage: undefined,
  };
}

function normalizeReviewAnswerValue(
  form: CliReviewFormState,
  activeTab: CliReviewFormState['tabs'][number],
  answer: CliReviewAnswerValue,
): CliReviewAnswerValue {
  if (activeTab.input !== 'multiselect' || Array.isArray(answer)) {
    return answer;
  }

  const current = form.answers[activeTab.id];
  const currentValues = Array.isArray(current)
    ? current
    : typeof current === 'string' && current.trim()
      ? [current]
      : [];
  const presetValues = currentValues.filter((entry) => activeTab.options.some((option) => option.label === entry));
  const customValue = answer.trim();

  return customValue ? [...presetValues, customValue] : presetValues;
}
