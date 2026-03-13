import React from 'react';
import {Box, Text} from 'ink';
import type {CliHilReviewAction, CliHilReviewState} from '../../app/view-state';

interface HilPanelProps {
  review: CliHilReviewState;
}

type HilPanelTone = 'yellow' | 'cyan' | 'magenta';

interface HilPanelOptionLine {
  label: string;
  description?: string;
}

interface HilPanelActionLine {
  label: string;
  description?: string;
  selected: boolean;
  kind: CliHilReviewAction['kind'];
}

interface HilPanelInputSection {
  label: string;
  value: string;
  focused: boolean;
  style?: 'box' | 'inline';
}

export interface HilPanelModel {
  title: string;
  badge: string;
  tone: HilPanelTone;
  summary: string[];
  meta?: string;
  tabsLine?: string;
  question?: string;
  options: HilPanelOptionLine[];
  actions: HilPanelActionLine[];
  compactActions?: boolean;
  input?: HilPanelInputSection;
  hint: string;
  status?: string;
}

export function HilPanel({review}: HilPanelProps): React.JSX.Element {
  const model = describeHilPanel(review);

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor={model.tone} paddingX={1}>
      <Box>
        <Text color={model.tone}>{model.title}</Text>
        <Text dimColor>{` · ${model.badge}`}</Text>
      </Box>

      {model.summary.map((line, index) => (
        <Text key={`summary-${index}`}>{line}</Text>
      ))}

      {model.meta ? <Text dimColor wrap="truncate-end">{model.meta}</Text> : null}

      {model.tabsLine ? <Text color={model.tone}>{model.tabsLine}</Text> : null}

      {model.question ? <Text>{model.question}</Text> : null}

      {model.options.length > 0 ? (
        <Box flexDirection="column">
          {model.options.map((option, index) => (
            <Box key={`option-${index}`} flexDirection="column">
              <Text>{`${index + 1}. ${option.label}`}</Text>
              {option.description ? <Text dimColor>{`   ${option.description}`}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {model.actions.length > 0 ? (
        model.compactActions ? (
          <Box marginTop={model.options.length > 0 ? 1 : 0}>
            <Text>
              {model.actions.map((action, index) => (
                <Text key={`action-${index}`} color={resolveActionColor(action)}>
                  {`${index > 0 ? '  ·  ' : ''}${action.selected ? `[${action.label}]` : action.label}`}
                </Text>
              ))}
            </Text>
          </Box>
        ) : (
          <Box marginTop={model.options.length > 0 ? 1 : 0} flexDirection="column">
            {model.actions.map((action, index) => (
              <Box key={`action-${index}`} flexDirection="column">
                <Text color={resolveActionColor(action)}>{`${action.selected ? '›' : ' '} ${action.label}`}</Text>
                {action.description ? <Text dimColor>{`  ${action.description}`}</Text> : null}
              </Box>
            ))}
          </Box>
        )
      ) : null}

      {model.input ? (
        <Box marginTop={1} flexDirection="column">
          {model.input.style === 'inline' ? (
            <Text color={model.input.focused ? model.tone : undefined}>
              {`${model.input.label} › ${model.input.value || '(empty)'}`}
            </Text>
          ) : (
            <>
              <Text dimColor>{model.input.label}</Text>
              <Box borderStyle="single" borderColor={model.input.focused ? model.tone : 'gray'} paddingX={1}>
                <Text color={model.input.focused ? 'green' : 'white'}>
                  {model.input.value || '(empty)'}
                </Text>
              </Box>
            </>
          )}
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <Text dimColor>{model.hint}</Text>
        {model.status ? <Text color={model.tone}>{model.status}</Text> : null}
      </Box>
    </Box>
  );
}

export function describeHilPanel(review: CliHilReviewState): HilPanelModel {
  if (review.form) {
    return describeHilFormPanel(review);
  }

  const selectedAction = review.actions[review.selectedActionIndex];
  const tone = isPermissionReview(review) ? 'yellow' : 'cyan';
  const title = isPermissionReview(review) ? 'Permission Review' : 'Review Required';
  const badge = isPermissionReview(review) ? 'permission' : (review.request.channel || 'interaction');

  return {
    title,
    badge,
    tone,
    summary: [review.request.description],
    ...(buildHilMeta(review) ? {meta: buildHilMeta(review)} : {}),
    options: [],
    actions: review.actions.map((action, index) => ({
      label: describeActionLabel(action),
      ...(action.description ? {description: action.description} : {}),
      selected: index === review.selectedActionIndex,
      kind: action.kind,
    })),
    input: {
      label: selectedAction?.requiresToolEdit ? 'Edited tool args JSON' : 'Note',
      value: review.draft,
      focused: review.focus === 'input',
      style: 'box',
    },
    hint: 'Tab focus · Up/Down select · Enter submit · Shift+Enter newline',
    ...(review.busy ? {status: 'Applying review decision...'} : {}),
  };
}

function describeHilFormPanel(review: CliHilReviewState): HilPanelModel {
  const form = review.form;
  if (!form) {
    return {
      title: 'Need Your Input',
      badge: review.request.channel || 'interaction',
      tone: 'cyan',
      summary: [review.request.description],
      options: [],
      actions: [],
      hint: 'Enter submits the current selection.',
    };
  }

  const activeTab = form.tabs[form.activeTabIndex];
  const options = [
    ...(activeTab?.options ?? []).map((option) => ({
      label: option.label,
      ...(option.description ? {description: option.description} : {}),
    })),
    ...(activeTab?.placeholder ? [{label: activeTab.placeholder}] : []),
  ];
  const quickActions = review.actions.map((action, index) => ({
    label: action.label,
    ...(action.description ? {description: action.description} : {}),
    selected: index === review.selectedActionIndex && review.focus === 'actions',
    kind: action.kind,
  }));

  return {
    title: 'Need Your Input',
    badge: review.request.channel || 'interaction',
    tone: 'cyan',
    summary: compactSummaryLines(review.request.description, form.summary),
    ...(buildHilMeta(review, {hideAskUser: true}) ? {meta: buildHilMeta(review, {hideAskUser: true})} : {}),
    ...(form.tabs.length > 0 ? {tabsLine: formatHilTabs(form)} : {}),
    ...(activeTab?.question ? {question: activeTab.question} : {}),
    options: decorateHilOptions(options, activeTab?.id ? form.answers[activeTab.id] : undefined),
    actions: quickActions,
    compactActions: true,
    input: {
      label: 'Answer',
      value: review.draft,
      focused: review.focus === 'input',
      style: 'inline',
    },
    hint: form.tabs.length > 1
      ? '1-9 choose · Left/Right move · Enter next · Tab actions'
      : '1-9 choose · Enter submit · Tab actions',
    ...(review.busy
      ? {status: 'Applying selection...'}
      : review.validationMessage
        ? {status: review.validationMessage}
        : {}),
  };
}

function compactSummaryLines(primary: string, secondary: string | undefined): string[] {
  const lines = [primary];
  if (secondary && secondary.trim() && secondary.trim() !== primary.trim()) {
    lines.push(secondary.trim());
  }
  return lines;
}

function isPermissionReview(review: CliHilReviewState): boolean {
  return review.request.ui?.modal === 'permission-review'
    || review.request.channel === 'permission-center'
    || review.request.description.toLowerCase().includes('permission review');
}

function buildHilMeta(
  review: CliHilReviewState,
  options: {hideAskUser?: boolean} = {},
): string | undefined {
  const parts: string[] = [];
  const toolText = describeTool(review, options);
  if (toolText) {
    parts.push(toolText);
  }
  const codaraMetadata = readCodaraHilMetadata(review.request.metadata);
  if (codaraMetadata) {
    parts.push(codaraMetadata);
  }
  return parts.length > 0 ? parts.join(' • ') : undefined;
}

function describeTool(review: CliHilReviewState, options: {hideAskUser?: boolean} = {}): string | undefined {
  const {toolName, toolArgs} = review.request.action;
  if (!toolName.trim()) {
    return undefined;
  }

  if (toolName === 'AskUser') {
    return options.hideAskUser ? undefined : 'Structured input requested';
  }

  const summary = summarizeToolArgs(toolName, toolArgs);
  return summary ? `${toolName} · ${summary}` : toolName;
}

function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }

  if (toolName.toLowerCase() === 'bash') {
    const command = typeof args.command === 'string' ? args.command.trim() : '';
    return command || undefined;
  }

  const entries = Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return entries.length > 0 ? entries.join(' · ') : undefined;
}

function describeActionLabel(action: CliHilReviewAction): string {
  const scope = action.scope?.trim();
  return scope ? `${action.label} (${scope})` : action.label;
}

function resolveActionColor(action: HilPanelActionLine): React.ComponentProps<typeof Text>['color'] {
  if (!action.selected) {
    return undefined;
  }

  if (action.kind === 'danger') {
    return 'red';
  }

  return action.kind === 'primary' ? 'green' : 'cyan';
}

function formatHilTabs(form: NonNullable<CliHilReviewState['form']>): string {
  return form.tabs.map((tab, index) => {
    const answered = isAnswered(form.answers[tab.id]) ? ' (done)' : '';
    return index === form.activeTabIndex ? `[${tab.label}]` : `${tab.label}${answered}`;
  }).join('   ');
}

function decorateHilOptions(
  options: HilPanelOptionLine[],
  answer: string | string[] | undefined,
): HilPanelOptionLine[] {
  const selected = Array.isArray(answer) ? answer : typeof answer === 'string' && answer.trim() ? [answer] : [];
  if (selected.length === 0) {
    return options;
  }

  return options.map((option) => (
    selected.includes(option.label)
      ? {...option, label: `${option.label} (selected)`}
      : option
  ));
}

function isAnswered(value: string | string[] | undefined): boolean {
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  return Array.isArray(value) && value.some((entry) => entry.trim().length > 0);
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
      parts.push(agentType);
    }
  }

  const delegated = (codara as Record<string, unknown>).delegatedSubagent;
  if (delegated && typeof delegated === 'object' && !Array.isArray(delegated)) {
    const childSessionId = (delegated as Record<string, unknown>).childSessionId;
    if (typeof childSessionId === 'string' && childSessionId.trim()) {
      parts.push(`delegate ${childSessionId}`);
    }
  }

  return parts.length > 0 ? parts.join(' • ') : undefined;
}
