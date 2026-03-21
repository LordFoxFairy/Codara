import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewAction, CliReviewState} from '../../app/view-state';
import {theme} from '../../utils/theme';

interface ReviewPanelProps {
  review: CliReviewState;
  presentation?: 'inline' | 'floating';
}

// ── Public API ──────────────────────────────────────────────

export function ReviewPanel({review, presentation = 'inline'}: ReviewPanelProps): React.JSX.Element {
  const content = isPermissionReview(review)
    ? <PermissionView review={review} />
    : review.form
      ? <AskUserView review={review} />
      : <GenericReviewView review={review} />;

  if (presentation === 'floating') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
        <FloatingReviewHeader review={review} />
        <ReviewQueueBanner review={review} />
        {content}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
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

function AskUserView({review}: {review: CliReviewState}): React.JSX.Element {
  const form = review.form!;
  const activeTab = form.endStep ? undefined : form.tabs[form.activeTabIndex];
  const hasMultipleTabs = form.tabs.length > 1;
  const activeOptions = activeTab?.options ?? [];
  const showSubmitActions = form.endStep && review.focus === 'actions';
  const showNextFooter = !form.endStep;
  const helperLabel = describeAskUserInput(activeTab);

  return (
    <Box flexDirection="column">
      {form.tabs.length > 0 && (
        <AskUserTabStrip form={form} />
      )}

      {activeTab?.question && (
        <Text bold>{activeTab.question}</Text>
      )}

      {!showSubmitActions && helperLabel && (
        <Text dimColor>{helperLabel}</Text>
      )}

      {activeTab && (
        <Box flexDirection="column" marginTop={1}>
          {activeOptions.map((option, index) => {
            const answer = activeTab.id ? form.answers[activeTab.id] : undefined;
            const isSelected = isOptionSelected(option.label, answer);
            const isFocused = review.focus !== 'actions' && review.selectedActionIndex === index;
            const marker = activeTab.input === 'multiselect'
              ? isSelected ? '[x]' : '[ ]'
              : isSelected ? '(*)' : '( )';
            return (
              <Box key={index} flexDirection="column">
                <Text color={isFocused ? 'green' : isSelected ? 'cyan' : undefined}>
                  {isFocused ? '› ' : '  '}{marker} {index + 1}. {option.label}
                </Text>
                {option.description && (
                  <Text dimColor>{'        '}{option.description}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {!form.endStep && review.draft.trim() && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>Custom answer</Text>
          <Text color="cyan">{review.draft}</Text>
        </Box>
      )}

      {showNextFooter && (
        <Box marginTop={1} flexWrap="wrap">
          <Text color={review.focus === 'actions' ? 'green' : undefined} dimColor={review.focus !== 'actions'} bold={review.focus === 'actions'}>
            {review.focus === 'actions' ? '› ' : ''}[Next]
          </Text>
        </Box>
      )}

      {showSubmitActions && review.actions.length > 0 && (
        <Box marginTop={1} flexWrap="wrap">
            {review.actions.map((action, index) => {
              const isFocused = review.focus === 'actions' && index === review.selectedActionIndex;
              return (
                <React.Fragment key={action.id}>
                  {index > 0 && <Text dimColor>{'  '}</Text>}
                  <Text color={resolveActionColor(action, isFocused)} dimColor={!isFocused} bold={isFocused}>
                    {isFocused ? '› ' : ''}[{action.label}]
                  </Text>
                </React.Fragment>
              );
            })}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {(() => {
            if (form.endStep && review.focus === 'actions') {
              return '↑/↓ select · Enter submit · Tab back · [ / ] reviews · Esc cancel';
            }
            const selectVerb = activeTab?.input === 'multiselect' ? 'Space toggle' : 'Space select';
            return hasMultipleTabs
              ? `↑/↓ select · 1-9 quick pick · ${selectVerb} · Enter next · Tab next · ←/→ tabs · [ / ] reviews · Esc cancel`
              : `↑/↓ select · 1-9 quick pick · ${selectVerb} · Enter next · Tab next · [ / ] reviews · Esc cancel`;
          })()}
        </Text>
      </Box>

      {review.busy && <Text color="cyan">Applying selection...</Text>}
      {review.validationMessage && <Text color="red">{review.validationMessage}</Text>}
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

function ReviewQueueBanner({review}: {review: CliReviewState}): React.JSX.Element | null {
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
  const title = review.form ? 'Ask User' : isPermissionReview(review) ? 'Permission Review' : 'Review Required';
  const hints = review.form
    ? review.form.endStep && review.focus === 'actions'
      ? 'Enter submit  Esc cancel'
      : `${review.form.tabs[review.form.activeTabIndex]?.input === 'multiselect' ? 'Space toggle' : 'Space select'}  Enter next  Tab next  Esc cancel`
    : 'Enter apply  Esc cancel';

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
        const isDone = item.kind === 'submit'
          ? onEndStep
          : isAnswered(form.answers[form.tabs[index]?.id ?? '']);
        const prefix = item.kind === 'submit' ? '✔ ' : isDone ? '☑ ' : '☐ ';
        return (
          <React.Fragment key={`${item.kind}:${item.label}`}>
            {index > 0 && <Text dimColor>{'  '}</Text>}
            <Text color={isActive ? 'cyan' : isDone ? 'green' : undefined} bold={isActive}>
              {`${prefix}${truncateLabel(item.label, 14)}`}
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

function isOptionSelected(label: string, answer: string | string[] | undefined): boolean {
  if (!answer) return false;
  const selected = Array.isArray(answer) ? answer : [answer];
  return selected.includes(label);
}

function isAnswered(value: string | string[] | undefined): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  return Array.isArray(value) && value.some(e => e.trim().length > 0);
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(0, maxLength - 3))}...` : label;
}

function describeAskUserInput(
  tab: NonNullable<CliReviewState['form']>['tabs'][number] | undefined,
): string | undefined {
  if (!tab) {
    return undefined;
  }

  if (tab.input === 'multiselect') {
    return 'Choose one or more, or type your own answer.';
  }

  if (tab.input === 'mixed') {
    return 'Choose one or type your own answer.';
  }

  if (tab.input === 'text') {
    return 'Type your answer.';
  }

  return 'Choose one or type your own answer.';
}
