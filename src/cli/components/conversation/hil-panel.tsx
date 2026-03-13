import React from 'react';
import {Box, Text} from 'ink';
import type {CliHilReviewState} from '../../app/view-state';

interface HilPanelProps {
  review: CliHilReviewState;
}

export function HilPanel({review}: HilPanelProps): React.JSX.Element {
  const model = describeHilPanel(review);

  return (
    <Box marginTop={1} marginBottom={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">{model.title}</Text>
      {model.lines.map((line, index) => (
        <Text key={`${index}-${line.color ?? 'default'}`} color={line.color} dimColor={line.dimColor} wrap={line.wrap}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}

export interface HilPanelLine {
  text: string;
  color?: 'yellow' | 'green' | 'gray' | 'cyan';
  dimColor?: boolean;
  wrap?: 'truncate-end';
}

export interface HilPanelModel {
  title: string;
  lines: HilPanelLine[];
}

export function describeHilPanel(review: CliHilReviewState): HilPanelModel {
  if (review.form) {
    return describeHilFormPanel(review);
  }

  const selectedAction = review.actions[review.selectedActionIndex];
  const inputTitle = selectedAction?.requiresToolEdit ? 'Edited tool args JSON' : 'Optional note';
  const codaraMetadata = readCodaraHilMetadata(review.request.metadata);
  const lines: HilPanelLine[] = [
    {text: review.request.description},
    {text: `Channel ${review.request.channel || 'default'} | Tab ${review.request.ui?.tab || 'Review'}${review.form ? ' | Form' : ''}`, dimColor: true},
  ];

  if (codaraMetadata) {
    lines.push({text: codaraMetadata, dimColor: true});
  }

  lines.push({
    text: `Tool ${describeHilAction(review)}`,
    dimColor: true,
    wrap: 'truncate-end',
  });

  for (const [index, action] of review.actions.entries()) {
    const selected = index === review.selectedActionIndex;
    const suffix = action.requiresToolEdit ? ' [edit]' : action.requiresConfirmation ? ' [confirm]' : '';
    lines.push({text: `${selected ? '>' : ' '} ${action.label}${suffix}`, color: selected ? 'green' : undefined});
    if (action.description) {
      lines.push({text: `  ${action.description}`, dimColor: true});
    }
  }

  lines.push({
    text: `${review.focus === 'input' ? '>' : ' '} ${inputTitle}`,
    color: review.focus === 'input' ? 'green' : 'gray',
  });
  lines.push({text: review.draft || '(empty)'});
  lines.push({
    text: 'Tab switch focus. Left/Right switch form tabs when present. Up/Down choose action. Enter submit. Shift+Enter inserts newline in the input box.',
    dimColor: true,
  });
  if (review.busy) {
    lines.push({text: 'Applying HIL decision...', color: 'cyan'});
  }

  return {
    title: 'HIL Review',
    lines,
  };
}

function describeHilAction(review: CliHilReviewState): string {
  if (review.request.action.toolName === 'AskUser' && review.form) {
    const count = review.form.tabs.length;
    return `AskUser(${count} prompt${count === 1 ? '' : 's'})`;
  }

  return `${review.request.action.toolName} ${JSON.stringify(review.request.action.toolArgs ?? {})}`;
}

function describeHilFormPanel(review: CliHilReviewState): HilPanelModel {
  const form = review.form;
  if (!form) {
    return {
      title: 'Need Your Input',
      lines: [{text: review.request.description}],
    };
  }
  const activeTab = form.tabs[form.activeTabIndex];
  const primaryAction = review.actions.find((action) => action.kind === 'primary') ?? review.actions[review.selectedActionIndex];
  const secondaryActions = review.actions.filter((action) => action.id !== primaryAction?.id);
  const lines: HilPanelLine[] = [];

  if (review.request.description && review.request.description !== form.summary) {
    lines.push({text: review.request.description});
  }
  if (form.summary) {
    lines.push({text: form.summary});
  }

  lines.push({
    text: [
      ...form.tabs.map((tab, index) => `${index === form.activeTabIndex ? '[' : ''}${tab.label}${index === form.activeTabIndex ? ']' : ''}`),
      ...(primaryAction ? [formatInlineAction(primaryAction)] : []),
    ].join('   '),
    color: 'yellow',
  });

  if (activeTab) {
    lines.push({text: activeTab.question});
    for (const [index, option] of activeTab.options.entries()) {
      lines.push({text: `${index + 1}. ${option.label}`});
      if (option.description) {
        lines.push({text: `   ${option.description}`, dimColor: true});
      }
    }

    if (activeTab.placeholder) {
      const inputIndex = activeTab.options.length + 1;
      lines.push({text: `${inputIndex}. ${activeTab.placeholder}`});
    }
  }

  for (const [index, action] of secondaryActions.entries()) {
    const quickIndex = (activeTab?.options.length ?? 0) + 1 + index + (activeTab?.placeholder ? 1 : 0);
    lines.push({text: `${quickIndex}. ${action.label}`});
  }

  if (review.focus === 'input' || review.draft.trim()) {
    lines.push({text: ''});
    lines.push({text: review.draft.trim() || '(empty)', color: review.focus === 'input' ? 'green' : 'gray'});
  }

  lines.push({
    text: 'Left/Right switch tabs. Number keys pick options. Enter submits. Shift+Enter inserts newline.',
    dimColor: true,
  });
  if (review.busy) {
    lines.push({text: 'Applying selection...', color: 'cyan'});
  }

  return {
    title: 'Need Your Input',
    lines,
  };
}

function formatInlineAction(action: CliHilReviewState['actions'][number]): string {
  const marker = action.kind === 'primary' ? '✓' : action.kind === 'danger' ? '!' : '•';
  return `${marker}${action.label}`;
}

function readCodaraHilMetadata(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }

  const codara = (metadata as Record<string, unknown>).codara;
  if (!codara || typeof codara !== 'object' || Array.isArray(codara)) {
    return undefined;
  }

  const parts: string[] = [];
  const actor = (codara as Record<string, unknown>).actor;
  if (actor && typeof actor === 'object' && !Array.isArray(actor)) {
    const agentType = (actor as Record<string, unknown>).agentType;
    if (typeof agentType === 'string' && agentType.trim()) {
      parts.push(`Actor ${agentType}`);
    }
  }

  const delegated = (codara as Record<string, unknown>).delegatedSubagent;
  if (delegated && typeof delegated === 'object' && !Array.isArray(delegated)) {
    const childSessionId = (delegated as Record<string, unknown>).childSessionId;
    if (typeof childSessionId === 'string' && childSessionId.trim()) {
      parts.push(`Delegate ${childSessionId}`);
    }
  }

  return parts.length > 0 ? parts.join(' | ') : undefined;
}
