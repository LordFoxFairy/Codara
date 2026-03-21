import React from 'react';
import {Box, Text} from 'ink';
import type {CliHilReviewAction, CliHilReviewState} from '../../app/view-state';
import {isPermissionPauseRequest} from '../../app/hil-kind';
import {theme} from '../../utils/theme';

interface HilPanelProps {
  review: CliHilReviewState;
  presentation?: 'inline' | 'floating';
}

export function HilPanel({review, presentation = 'inline'}: HilPanelProps): React.JSX.Element {
  const permissionReview = isPermissionReview(review);
  const content = permissionReview
    ? <PermissionView review={review} />
    : review.form
      ? <AskUserView review={review} />
      : <GenericReviewView review={review} />;

  if (permissionReview) {
    return (
      <Box flexDirection="column">
        <ApprovalQueueBanner review={review} />
        {content}
      </Box>
    );
  }

  if (presentation === 'floating') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={theme.chrome.border} paddingX={1}>
        <FloatingHilHeader review={review} />
        <ApprovalQueueBanner review={review} />
        {content}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <ApprovalQueueBanner review={review} />
      {content}
    </Box>
  );
}

export function isPermissionReview(review: CliHilReviewState | undefined): boolean {
  if (!review) return false;
  return isPermissionPauseRequest(review.request);
}

function PermissionView({review}: {review: CliHilReviewState}): React.JSX.Element {
  const bodyLines = readPermissionBodyLines(review);

  return (
    <Box flexDirection="column">
      <Text bold>{describePermissionTitle(review)}</Text>

      {bodyLines.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {bodyLines.map((line, index) => (
            <Text key={`${line}-${index}`}>{`    ${line}`}</Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text>Do you want to proceed?</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {review.actions.map((action, index) => {
          const selected = index === review.selectedActionIndex;
          const marker = selected ? '❯' : ' ';
          return (
            <Text key={action.id} color={selected ? theme.interactive.secondaryButton : undefined} bold={selected}>
              {`${marker} ${index + 1}. ${formatPermissionActionLabel(review, action)}`}
            </Text>
          );
        })}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{describePermissionFooter(review)}</Text>
      </Box>

      {review.busy && (
        <Box marginTop={1}>
          <Text dimColor>Running...</Text>
        </Box>
      )}
    </Box>
  );
}

function AskUserView({review}: {review: CliHilReviewState}): React.JSX.Element {
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
                  {isFocused ? '>' : ' '} {marker} {index + 1}. {option.label}
                </Text>
                {option.description && (
                  <Text dimColor>{`        ${option.description}`}</Text>
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
          <Text
            color={review.focus === 'actions' ? 'green' : undefined}
            dimColor={review.focus !== 'actions'}
            bold={review.focus === 'actions'}
          >
            {review.focus === 'actions' ? '>' : ''}[Next]
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
                  {isFocused ? '>' : ''}[{action.label}]
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
              return 'Up/Down select · Enter submit · Tab back · [ / ] approvals · Esc cancel';
            }
            const selectVerb = activeTab?.input === 'multiselect' ? 'Space toggle' : 'Space select';
            return hasMultipleTabs
              ? `Up/Down select · 1-9 quick pick · ${selectVerb} · Enter next · Tab next · Left/Right tabs · [ / ] approvals · Esc cancel`
              : `Up/Down select · 1-9 quick pick · ${selectVerb} · Enter next · Tab next · [ / ] approvals · Esc cancel`;
          })()}
        </Text>
      </Box>

      {review.busy && <Text color="cyan">Applying selection...</Text>}
      {review.validationMessage && <Text color="red">{review.validationMessage}</Text>}
    </Box>
  );
}

function GenericReviewView({review}: {review: CliHilReviewState}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>Review Required</Text>
      <Text>{review.request.description}</Text>
      {review.actions.map((action, index) => (
        <Text key={action.id} color={resolveActionColor(action, index === review.selectedActionIndex)}>
          {index === review.selectedActionIndex ? '>' : ' '} {action.label}
        </Text>
      ))}
      {review.draft !== undefined && review.focus === 'input' && (
        <Text color="cyan">Note - {review.draft || '(empty)'}</Text>
      )}
      <Text dimColor>Up/Down select · [ / ] approvals · Enter submit</Text>
      {review.busy && <Text color="cyan">Applying...</Text>}
    </Box>
  );
}

function ApprovalQueueBanner({review}: {review: CliHilReviewState}): React.JSX.Element | null {
  if (review.approvalIndex === undefined || review.approvalCount === undefined || review.approvalCount <= 1) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>{`Approval ${review.approvalIndex}/${review.approvalCount}`}</Text>
      <Text dimColor>Use [ and ] to switch approvals</Text>
    </Box>
  );
}

function FloatingHilHeader({review}: {review: CliHilReviewState}): React.JSX.Element {
  const title = review.form ? 'Ask User' : 'Review Required';
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
  {form}: {form: NonNullable<CliHilReviewState['form']>},
): React.JSX.Element {
  const onEndStep = Boolean(form.endStep);
  const currentStepIndex = onEndStep ? form.tabs.length : form.activeTabIndex;
  const labels = [
    ...form.tabs.map((tab) => ({kind: 'question' as const, label: tab.label})),
    {kind: 'submit' as const, label: 'Submit'},
  ];

  return (
    <Box marginBottom={1} flexWrap="nowrap">
      <Text dimColor>{'<'}</Text>
      {labels.map((item, index) => {
        const isActive = index === currentStepIndex;
        const isDone = item.kind === 'submit'
          ? onEndStep
          : isAnswered(form.answers[form.tabs[index]?.id ?? '']);
        const prefix = item.kind === 'submit' ? '[S]' : isDone ? '[x]' : '[ ]';
        return (
          <React.Fragment key={`${item.kind}:${item.label}`}>
            {index > 0 && <Text dimColor>{'  '}</Text>}
            <Text color={isActive ? 'cyan' : isDone ? 'green' : undefined} bold={isActive}>
              {`${prefix}${truncateLabel(item.label, 14)}`}
            </Text>
          </React.Fragment>
        );
      })}
      <Text dimColor>{'  >'}</Text>
    </Box>
  );
}

function formatPermissionActionLabel(review: CliHilReviewState, action: CliHilReviewAction): string {
  const normalized = action.id.trim().toLowerCase();

  if (normalized === 'allow_once' || normalized === 'allow' || normalized === 'approve') {
    return 'Yes';
  }

  if (normalized === 'dont_ask_again' || normalized === 'always') {
    return describeAlwaysAllowLabel(review, action);
  }

  if (normalized === 'deny' || normalized === 'reject') {
    return 'No';
  }

  return action.label;
}

function describePermissionTitle(review: CliHilReviewState): string {
  const toolName = review.request.action.toolName.trim().toLowerCase();

  if (toolName === 'bash') {
    return 'Bash command';
  }
  if (toolName === 'edit' || toolName === 'write') {
    return 'File change';
  }
  if (toolName === 'read') {
    return 'File access';
  }

  return `${review.request.action.toolName} request`;
}

function describeAlwaysAllowLabel(review: CliHilReviewState, action: CliHilReviewAction): string {
  if (/^yes\b/i.test(action.label.trim())) {
    return action.label.trim();
  }

  const reason = readPermissionReason(review);
  const writeMatch = reason.match(/^Writes to (.+)$/i);
  if (writeMatch?.[1]) {
    return `Yes, and always allow access to ${writeMatch[1].trim()} from this project`;
  }

  const pattern = readPermissionAlwaysPatterns(review)[0];
  if (pattern) {
    const scope = describePermissionPattern(pattern);
    if (scope) {
      return `Yes, and always allow ${scope} from this project`;
    }
  }

  return 'Yes, and always allow this from this project';
}

function readPermissionBodyLines(review: CliHilReviewState): string[] {
  const lines: string[] = [];
  const toolArgs = readPermissionToolArgs(review);
  const command = typeof toolArgs.command === 'string' ? toolArgs.command.trim() : '';

  if (command) {
    lines.push(...command.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean));
  }

  const description = typeof toolArgs.description === 'string' ? toolArgs.description.trim() : '';
  if (description && !lines.includes(description)) {
    lines.push(description);
  }

  const reason = readPermissionReason(review);
  if (reason && !lines.includes(reason)) {
    lines.push(reason);
  }

  if (lines.length === 0) {
    const expression = readPermissionExpression(review);
    if (expression) {
      lines.push(expression);
    }
  }

  if (lines.length === 0) {
    const descriptionText = review.request.description.trim();
    if (!isGenericPermissionDescription(descriptionText)) {
      lines.push(descriptionText);
    }
  }

  return lines;
}

function describePermissionFooter(review: CliHilReviewState): string {
  const count = review.actions.length;
  const selectionHint = count > 1 ? `1-${count} choose` : 'Enter confirm';
  const queueHint = review.approvalCount && review.approvalCount > 1 ? ' · [ / ] approvals' : '';
  return `Esc cancel · ${selectionHint}${queueHint}`;
}

function readPermissionToolArgs(review: CliHilReviewState): Record<string, unknown> {
  const toolArgs = review.request.action.toolArgs;
  if (!toolArgs || typeof toolArgs !== 'object' || Array.isArray(toolArgs)) {
    return {};
  }
  return toolArgs as Record<string, unknown>;
}

function readPermissionExpression(review: CliHilReviewState): string {
  const policy = readPermissionPolicy(review.request.metadata);
  const expression = policy.expression;
  return typeof expression === 'string' ? expression.trim() : '';
}

function readPermissionReason(review: CliHilReviewState): string {
  const policy = readPermissionPolicy(review.request.metadata);
  const reason = policy.reason;
  return typeof reason === 'string' ? reason.trim() : '';
}

function readPermissionAlwaysPatterns(review: CliHilReviewState): string[] {
  const policy = readPermissionPolicy(review.request.metadata);
  const patterns = policy.alwaysPatterns;
  return Array.isArray(patterns)
    ? patterns.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
}

function readPermissionPolicy(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {};
  }

  const policy = (metadata as Record<string, unknown>).permissionPolicy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return {};
  }

  return policy as Record<string, unknown>;
}

function describePermissionPattern(pattern: string): string | undefined {
  const trimmed = pattern.trim();
  const match = trimmed.match(/^[^(]+\((.*)\)$/);
  const specifier = (match?.[1] ?? trimmed).trim();

  if (!specifier || specifier === '*') {
    return undefined;
  }

  if (specifier.endsWith('/*')) {
    return `access to ${specifier.slice(0, -1)}`;
  }

  if (specifier.endsWith(' *')) {
    return `${specifier.slice(0, -2)} commands`;
  }

  return specifier;
}

function isGenericPermissionDescription(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('wants to run') || normalized.includes('permission review required');
}

function resolveActionColor(action: CliHilReviewAction, selected: boolean): string | undefined {
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
  return Array.isArray(value) && value.some((entry) => entry.trim().length > 0);
}

function truncateLabel(label: string, maxLength: number): string {
  return label.length > maxLength ? `${label.slice(0, Math.max(0, maxLength - 3))}...` : label;
}

function describeAskUserInput(
  tab: NonNullable<CliHilReviewState['form']>['tabs'][number] | undefined,
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
