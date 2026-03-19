import React from 'react';
import {Box, Text} from 'ink';
import {useBlinkingCursor} from '../../hooks/use-blinking-cursor';
import type {CliCollapsedPasteSummary} from '../../composer/collapsed-paste';
import type {CliComposerState} from '../../composer/types';
import {buildComposerViewport} from './composer-view';
import {theme} from '../../utils/theme';

interface PromptFrameProps {
  composer: CliComposerState;
  hasDraftContent: boolean;
  collapsedPasteSummary?: CliCollapsedPasteSummary;
  cursorActivityVersion: number;
  isRunning: boolean;
  placeholder?: string;
  terminalWidth?: number;
}

interface CursorRenderParts {
  beforeCursor: string;
  cursorCell: string;
  afterCursor: string;
  dimColor: boolean;
}

function buildCursorRenderParts(
  beforeCursor: string,
  afterCursor: string,
  placeholder: string | undefined,
): CursorRenderParts {
  const suffix = afterCursor || placeholder || ' ';
  const cursorCell = suffix[0] ?? ' ';
  const trailingText = suffix.slice(1);

  return {
    beforeCursor,
    cursorCell,
    afterCursor: trailingText,
    dimColor: Boolean(placeholder && !afterCursor),
  };
}

function describePromptHint(isRunning: boolean, isMultiLine: boolean): string {
  if (isRunning) {
    return isMultiLine
      ? 'Model responding | keep typing | enter waits'
      : 'Model responding | keep typing | shift+enter newline';
  }

  return isMultiLine
    ? 'Enter send | shift+enter newline'
    : 'Enter send | shift+enter newline';
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function describeCollapsedPasteBadge(summary: CliCollapsedPasteSummary): string {
  return summary.blockCount > 1 ? `${summary.blockCount} pastes` : 'paste';
}

export function PromptFrame({
  composer,
  hasDraftContent,
  collapsedPasteSummary,
  cursorActivityVersion,
  isRunning,
  placeholder,
  terminalWidth,
}: PromptFrameProps): React.JSX.Element {
  const blinkingCursor = useBlinkingCursor(!isRunning, cursorActivityVersion);
  const showCursor = isRunning ? true : blinkingCursor;
  const viewport = buildComposerViewport(composer, undefined, placeholder, terminalWidth);
  const hasText = hasDraftContent;
  const isMultiLine = composer.text.includes('\n') || viewport.lines.length > 1;
  const hint = describePromptHint(isRunning, isMultiLine);

  return (
    <Box flexDirection="column">
      {collapsedPasteSummary ? (
        <Box marginBottom={1}>
          <Text color={theme.chrome.dimmed}>  </Text>
          <Text color={theme.interactive.title} bold>[{describeCollapsedPasteBadge(collapsedPasteSummary)}]</Text>
          <Text color={theme.interactive.prompt} bold> {formatCount(collapsedPasteSummary.charCount)} chars</Text>
          {collapsedPasteSummary.lineCount > 1 ? (
            <Text color={theme.interactive.accent}> | {formatCount(collapsedPasteSummary.lineCount)} lines</Text>
          ) : null}
          <Text color={theme.chrome.dimmed}> | collapsed above prompt</Text>
        </Box>
      ) : null}
      {viewport.hasOverflowAbove ? <Text color={theme.chrome.dimmed}>  ...</Text> : null}
      {viewport.lines.map((line, index) => {
        const renderParts = buildCursorRenderParts(line.beforeCursor, line.afterCursor, line.placeholder);
        const plainText = `${line.beforeCursor}${line.afterCursor}${line.placeholder ?? ''}`;

        return (
          <Box key={`prompt-line-${index}`}>
            <Text color={theme.interactive.prompt} bold>{index === 0 ? '> ' : '  '}</Text>
            <Box flexGrow={1} flexShrink={1}>
              {line.isCursorLine ? (
                <Text dimColor={renderParts.dimColor}>
                  {renderParts.beforeCursor}
                  {showCursor ? <Text inverse>{renderParts.cursorCell}</Text> : renderParts.cursorCell}
                  {renderParts.afterCursor}
                </Text>
              ) : (
                <Text>{plainText}</Text>
              )}
            </Box>
          </Box>
        );
      })}
      {viewport.hasOverflowBelow ? <Text color={theme.chrome.dimmed}>  ...</Text> : null}
      {(hasText || isRunning) && (
        <Box justifyContent="flex-end">
          <Text color={theme.chrome.dimmed}>{hint}</Text>
        </Box>
      )}
    </Box>
  );
}
