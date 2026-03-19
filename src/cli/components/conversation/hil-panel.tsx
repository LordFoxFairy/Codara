import React from 'react';
import {Box, Text} from 'ink';
import type {CliHilReviewAction, CliHilReviewState} from '../../app/view-state';

interface HilPanelProps {
  review: CliHilReviewState;
}

// ── Public API ──────────────────────────────────────────────

export function HilPanel({review}: HilPanelProps): React.JSX.Element {
  const content = isPermissionReview(review)
    ? <PermissionView review={review} />
    : review.form
      ? <AskUserView review={review} />
      : <GenericReviewView review={review} />;

  return (
    <Box flexDirection="column" paddingX={1}>
      <ApprovalQueueBanner review={review} />
      {content}
    </Box>
  );
}

export function isPermissionReview(review: CliHilReviewState | undefined): boolean {
  if (!review) return false;
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
}

// ── Permission View (Claude Code style) ─────────────────────

function PermissionView({review}: {review: CliHilReviewState}): React.JSX.Element {
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

function AskUserView({review}: {review: CliHilReviewState}): React.JSX.Element {
  const form = review.form!;
  const activeTab = form.tabs[form.activeTabIndex];
  const hasMultipleTabs = form.tabs.length > 1;

  return (
    <Box flexDirection="column">
      {/* Tab navigation bar — always show */}
      {form.tabs.length > 0 && (
        <Box marginBottom={1}>
          <Text dimColor>← </Text>
          {form.tabs.map((tab, index) => {
            const isActive = index === form.activeTabIndex;
            const isDone = isAnswered(form.answers[tab.id]);
            return (
              <React.Fragment key={tab.id}>
                {index > 0 && <Text dimColor>  </Text>}
                {isActive ? (
                  <Text color="cyan" bold underline>{`□ ${tab.label}`}</Text>
                ) : isDone ? (
                  <Text color="green">{`✓ ${tab.label}`}</Text>
                ) : (
                  <Text dimColor>{`□ ${tab.label}`}</Text>
                )}
              </React.Fragment>
            );
          })}
          <Text dimColor>  </Text>
          <Text color="green">✓Submit</Text>
          <Text dimColor> →</Text>
        </Box>
      )}

      {/* Question title */}
      {activeTab?.question && (
        <Text bold>{activeTab.question}</Text>
      )}

      {/* Options list — vertical, ↑/↓ navigable */}
      {activeTab && (
        <Box flexDirection="column" marginTop={1}>
          {(activeTab.options ?? []).map((option, index) => {
            const answer = activeTab.id ? form.answers[activeTab.id] : undefined;
            const isSelected = isOptionSelected(option.label, answer);
            const isFocused = review.focus !== 'actions' && review.selectedActionIndex === index;
            const checkbox = isSelected ? '[✓]' : '[ ]';
            return (
              <Box key={index} flexDirection="column">
                <Text color={isFocused ? 'green' : isSelected ? 'cyan' : undefined}>
                  {isFocused ? '› ' : '  '}{checkbox} {index + 1}. {option.label}
                </Text>
                {option.description && (
                  <Text dimColor>{'        '}{option.description}</Text>
                )}
              </Box>
            );
          })}

          {/* Free text option — also navigable */}
          {activeTab.placeholder && (() => {
            const freeIdx = (activeTab.options?.length ?? 0);
            const isFocused = review.focus !== 'actions' && review.selectedActionIndex === freeIdx;
            return (
              <Text color={isFocused ? 'green' : undefined} dimColor={!isFocused}>
                {isFocused ? '› ' : '  '}{freeIdx + 1}. {activeTab.placeholder}
              </Text>
            );
          })()}

          {/* Actions as numbered items below a separator */}
          {review.actions.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              {review.actions.map((action, index) => {
                const actionIdx = (activeTab.options?.length ?? 0) + (activeTab.placeholder ? 1 : 0) + index;
                const isFocused = review.focus === 'actions' && index === review.selectedActionIndex;
                return (
                  <Text key={index} color={isFocused ? 'cyan' : undefined} dimColor={!isFocused}>
                    {isFocused ? '› ' : '  '}{actionIdx + 1}. {action.label}
                  </Text>
                );
              })}
            </Box>
          )}
        </Box>
      )}

      {/* Input line — visible when typing or focused */}
      {(review.focus === 'input' || review.draft.trim()) && (
        <Box marginTop={1}>
          <Text color={review.focus === 'input' ? 'cyan' : 'gray'}>
            Answer › {review.draft || '(empty)'}
          </Text>
        </Box>
      )}

      {/* Hint */}
      <Box marginTop={1}>
        <Text dimColor>
          {(() => {
            const isLastTab = form.activeTabIndex >= form.tabs.length - 1;
            const enterAction = isLastTab ? 'Enter submit' : 'Enter next';
            return hasMultipleTabs
              ? `↑/↓ select · 1-9 quick pick · ${enterAction} · ←/→ tabs · [ / ] approvals · Esc cancel`
              : `↑/↓ select · 1-9 quick pick · ${enterAction} · [ / ] approvals · Esc cancel`;
          })()}
        </Text>
      </Box>

      {review.busy && <Text color="cyan">Applying selection...</Text>}
      {review.validationMessage && <Text color="red">{review.validationMessage}</Text>}
    </Box>
  );
}

// ── Generic Review View ─────────────────────────────────────

function GenericReviewView({review}: {review: CliHilReviewState}): React.JSX.Element {
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
      <Text dimColor>Up/Down select · [ / ] approvals · Enter submit</Text>
      {review.busy && <Text color="cyan">Applying...</Text>}
    </Box>
  );
}

function ApprovalQueueBanner({review}: {review: CliHilReviewState}): React.JSX.Element | null {
  if (review.approvalIndex === undefined || review.approvalCount === undefined) {
    return null;
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="cyan" bold>{`Approval ${review.approvalIndex}/${review.approvalCount}`}</Text>
      <Text dimColor>Use [ and ] to switch approvals</Text>
    </Box>
  );
}

// ── Helpers ──────────────────────────────────────────────────

function formatPermissionShortcut(action: CliHilReviewAction): string {
  switch (action.label) {
    case 'Allow once': return '(y) Allow once';
    case 'Allow always': return '(a) Allow always';
    case 'Reject': return '(n) Reject';
    default: return action.label;
  }
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
  return Array.isArray(value) && value.some(e => e.trim().length > 0);
}
