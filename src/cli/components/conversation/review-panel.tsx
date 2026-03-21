import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewAction, CliReviewAnswerValue, CliReviewState} from '../../app/view-state';
import {theme} from '../../utils/theme';

interface ReviewPanelProps {
  review: CliReviewState;
  terminalWidth?: number;
}

// ── Public API ──────────────────────────────────────────────

export function ReviewPanel({review, terminalWidth}: ReviewPanelProps): React.JSX.Element {
  const content = isPermissionReview(review)
    ? <PermissionView review={review} />
    : review.form
      ? <AskUserView review={review} terminalWidth={terminalWidth} />
      : <GenericReviewView review={review} />;

  if (review.form) {
    return (
      <Box flexDirection="column">
        <ReviewQueueBanner review={review} />
        {content}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
      <FloatingReviewHeader review={review} />
      <ReviewQueueBanner review={review} />
      {content}
    </Box>
  );
}

export function isPermissionReview(review: CliReviewState | undefined): boolean {
  if (!review) return false;
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
}

// ── Permission View (Claude Code style) ─────────────────────

function PermissionView({review}: {review: CliReviewState}): React.JSX.Element {
  const stage = review.permissionStage ?? 'prompt';

  // Stage 2: Always-confirm
  if (stage === 'always-confirm') {
    const patterns = review.permissionAlwaysPatterns ?? [];
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>Always allow</Text>
        {patterns.length > 0 && patterns[0] !== '*' ? (
          <Box flexDirection="column" paddingLeft={2}>
            {patterns.map((p, i) => <Text key={i} dimColor>- {p}</Text>)}
          </Box>
        ) : (
          <Text dimColor>This will allow the permission until Codara is restarted.</Text>
        )}
        <Box marginTop={1}>
          <Text color={review.selectedActionIndex === 0 ? 'green' : undefined}>
            {review.selectedActionIndex === 0 ? '❯ ' : '  '}Confirm
          </Text>
          <Text>{'  '}</Text>
          <Text color={review.selectedActionIndex === 1 ? 'cyan' : undefined}>
            {review.selectedActionIndex === 1 ? '❯ ' : '  '}Cancel
          </Text>
        </Box>
        <Text dimColor>Enter confirm · Esc cancel</Text>
        {review.busy && <Text color="cyan">Running...</Text>}
      </Box>
    );
  }

  // Stage 3: Reject feedback
  if (stage === 'reject-feedback') {
    return (
      <Box flexDirection="column">
        <Text color="red" bold>Rejection feedback (optional):</Text>
        <Text color={review.draft ? 'green' : 'gray'}>Reason › {review.draft || '(empty)'}</Text>
        <Text dimColor>Enter send · Esc reject silently</Text>
        {review.busy && <Text color="red">Running...</Text>}
      </Box>
    );
  }

  // Stage 1: Main prompt — inline, no bordered box
  return (
    <Box flexDirection="column">
      <Text color="yellow" bold>{review.request.description}</Text>
      {review.actions.map((action, index) => (
        <Text key={index} color={resolveActionColor(action, index === review.selectedActionIndex)}>
          {index === review.selectedActionIndex ? '❯ ' : '  '}{formatPermissionShortcut(action)}
        </Text>
      ))}
      <Text dimColor>y allow · a always · n reject</Text>
      {review.busy && <Text color="yellow">Running...</Text>}
    </Box>
  );
}

// ── AskUser View (Claude Code / ZCode style) ────────────────

function AskUserView(
  {review, terminalWidth}: {review: CliReviewState; terminalWidth?: number},
): React.JSX.Element {
  const form = review.form!;
  const activeTab = form.endStep ? undefined : form.tabs[form.activeTabIndex];
  const activeOptions = activeTab?.options ?? [];
  const showSubmitStep = Boolean(form.endStep);
  const footerFocusAction = review.focus === 'actions'
    ? resolveAskUserFooterAction(review, {
      showSubmitStep,
    })
    : undefined;
  const customOptionIndex = activeOptions.length + 1;
  const submitActions = review.actions.filter((action) => action.id === 'submit' || action.id === 'cancel');
  const firstIncompleteLabel = form.tabs.find((tab) => !isAnswered(form.answers[tab.id]))?.label;
  const dividerWidth = Math.max(24, (terminalWidth ?? 80) - 4);

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
      {form.tabs.length > 0 && <AskUserTabStrip form={form} />}

      {showSubmitStep ? (
        <Box flexDirection="column">
          <Text bold>Review your answers</Text>
          {(review.validationMessage || firstIncompleteLabel) && (
            <Box marginTop={1}>
              <Text color="yellow">{`⚠ ${review.validationMessage ?? 'You have not answered all questions'}`}</Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text dimColor>Ready to submit your answers?</Text>
          </Box>
          <Box marginTop={2} flexDirection="column">
            {submitActions.map((action, index) => {
              const isFocused = review.focus === 'actions' && review.selectedActionIndex === index;
              return (
                <Text key={action.id} color={resolveActionColor(action, isFocused)}>
                  {isFocused ? '› ' : '  '}{index + 1}. {action.id === 'submit' ? 'Submit answers' : action.label}
                </Text>
              );
            })}
          </Box>
        </Box>
      ) : activeTab ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{activeTab.question}</Text>
          <Box marginTop={1} flexDirection="column">
          {activeOptions.map((option, index) => {
            const answer = activeTab.id ? form.answers[activeTab.id] : undefined;
            const isSelected = isOptionSelected(option.label, answer);
            const isFocused = review.focus !== 'actions' && review.selectedActionIndex === index;
            const labelPrefix = activeTab.input === 'multiselect'
              ? `${index + 1}. ${isSelected ? '[x]' : '[ ]'} `
              : `${index + 1}. ${isSelected ? '◉' : '○'} `;
            return (
              <Box key={index} flexDirection="column">
                <Text color={isFocused ? 'green' : isSelected ? 'cyan' : undefined}>
                  {isFocused ? '› ' : '  '}{labelPrefix}{option.label}
                </Text>
                {option.description && (
                  <Text dimColor>{'        '}{option.description}</Text>
                )}
              </Box>
            );
          })}
          {supportsAskUserCustomOption(activeTab) && (
            <Text color={review.focus !== 'actions' && review.selectedActionIndex === activeOptions.length ? 'green' : undefined}>
              {review.focus !== 'actions' && review.selectedActionIndex === activeOptions.length ? '› ' : '  '}
              {renderAskUserCustomRow(review, activeTab, customOptionIndex)}
            </Text>
          )}
          </Box>
          <Box marginTop={1}>
            <Text color={footerFocusAction?.id === 'next' ? 'green' : undefined} bold={footerFocusAction?.id === 'next'}>
              {footerFocusAction?.id === 'next' ? '› ' : '  '}Next
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
          </Box>
        </Box>
      ) : null}

      {review.busy && <Text color="cyan">Applying selection...</Text>}
      {!showSubmitStep && review.validationMessage && <Text color="red">{review.validationMessage}</Text>}
    </Box>
  );
}

// ── Generic Review View ─────────────────────────────────────

function GenericReviewView({review}: {review: CliReviewState}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>Review Required</Text>
      <Text>{review.request.description}</Text>
      {review.actions.map((action, index) => (
        <Text key={index} color={resolveActionColor(action, index === review.selectedActionIndex)}>
          {index === review.selectedActionIndex ? '❯ ' : '  '}{action.label}
        </Text>
      ))}
      {review.draft !== undefined && review.focus === 'input' && (
        <Text color="cyan">Note › {review.draft || '(empty)'}</Text>
      )}
      <Text dimColor>Up/Down select · [ / ] reviews · Enter submit</Text>
      {review.busy && <Text color="cyan">Applying...</Text>}
    </Box>
  );
}

function renderAskUserCustomRow(
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

function resolveAskUserCustomValue(
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

function ReviewQueueBanner({review}: {review: CliReviewState}): React.JSX.Element | null {
  if (review.form) {
    return null;
  }

  if (review.reviewIndex === undefined || review.reviewCount === undefined) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>{`Review ${review.reviewIndex}/${review.reviewCount}`}</Text>
      <Text dimColor>Use [ and ] to switch reviews</Text>
    </Box>
  );
}

function FloatingReviewHeader({review}: {review: CliReviewState}): React.JSX.Element {
  const title = isPermissionReview(review) ? 'Permission Review' : 'Review Required';
  const hints = 'Enter apply  Esc cancel';

  return (
    <Box justifyContent="space-between" marginBottom={1}>
      <Text bold color={theme.interactive.title}>{title}</Text>
      <Text dimColor>{hints}</Text>
    </Box>
  );
}

function AskUserTabStrip(
  {form}: {form: NonNullable<CliReviewState['form']>},
): React.JSX.Element {
  const onEndStep = Boolean(form.endStep);
  const currentStepIndex = onEndStep ? form.tabs.length : form.activeTabIndex;
  const labels = [
    ...form.tabs.map((tab) => ({kind: 'question' as const, label: tab.label})),
    {kind: 'submit' as const, label: 'Submit'},
  ];

  return (
    <Box marginBottom={1} flexWrap="nowrap">
      <Text dimColor>← </Text>
      {labels.map((item, index) => {
        const isActive = index === currentStepIndex;
        const prefix = item.kind === 'submit' ? '✔ ' : '☐ ';
        return (
          <React.Fragment key={`${item.kind}:${item.label}`}>
            {index > 0 && <Text dimColor>{'  '}</Text>}
            <Text
              backgroundColor={isActive ? 'blue' : undefined}
              color={isActive ? 'white' : undefined}
              bold={isActive}
            >
              {`${prefix}${truncateLabel(item.label, 12)}`}
            </Text>
          </React.Fragment>
        );
      })}
      <Text dimColor>{'  →'}</Text>
    </Box>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatPermissionShortcut(action: CliReviewAction): string {
  switch (action.label) {
    case 'Allow once': return '(y) Allow once';
    case 'Allow always': return '(a) Allow always';
    case 'Reject': return '(n) Reject';
    default: return action.label;
  }
}

function resolveActionColor(action: CliReviewAction, selected: boolean): string | undefined {
  if (!selected) return undefined;
  if (action.kind === 'danger') return 'red';
  return action.kind === 'primary' ? 'green' : 'cyan';
}

function supportsAskUserCustomOption(
  tab: NonNullable<CliReviewState['form']>['tabs'][number] | undefined,
): boolean {
  return Boolean(tab);
}

function resolveAskUserFooterAction(
  review: CliReviewState,
  input: {showSubmitStep: boolean},
): CliReviewAction | undefined {
  if (input.showSubmitStep) {
    return review.actions
      .filter((action) => action.id === 'submit' || action.id === 'cancel')
      [review.selectedActionIndex];
  }

  return {id: 'next', label: 'Next', kind: 'primary'};
}

function isOptionSelected(label: string, answer: string | string[] | undefined): boolean {
  if (!answer) return false;
  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.includes(label);
}

function isAnswered(value: string | string[] | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.some(e => e.trim().length > 0);
}

function isCustomAnswerSelected(
  tab: NonNullable<CliReviewState['form']>['tabs'][number],
  answer: string | string[] | undefined,
): boolean {
  if (!answer) {
    return false;
  }

  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.some((entry) => entry.trim().length > 0 && tab.options.every((option) => option.label !== entry));
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(0, maxLength - 3))}...` : label;
}
