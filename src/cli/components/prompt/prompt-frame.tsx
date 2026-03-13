import React from 'react';
import {Box, Text} from 'ink';
import {useBlinkingCursor} from '../../hooks/use-blinking-cursor';
import type {CliComposerState} from '../../composer/types';
import {buildComposerViewport} from './composer-view';

interface PromptFrameProps {
  terminalWidth: number;
  composer: CliComposerState;
  cursorActivityVersion: number;
  isRunning: boolean;
}

interface CursorRenderParts {
  beforeCursor: string;
  cursorCell: string;
  afterCursor: string;
  dimColor: boolean;
}

function createDividerWidth(terminalWidth: number): number {
  return Math.max(20, terminalWidth - 2);
}

function createDivider(terminalWidth: number): string {
  return '\u2500'.repeat(createDividerWidth(terminalWidth));
}

function createPromptPrefix(index: number): string {
  return index === 0 ? '\u203a ' : '  ';
}

function buildCursorRenderParts(
  beforeCursor: string,
  afterCursor: string,
  placeholder: string | undefined
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

export function PromptFrame({
  terminalWidth,
  composer,
  cursorActivityVersion,
  isRunning,
}: PromptFrameProps): React.JSX.Element {
  const divider = createDivider(terminalWidth);
  const showCursor = useBlinkingCursor(!isRunning, cursorActivityVersion);
  const viewport = buildComposerViewport(composer);

  return (
    <Box marginTop={1} flexDirection="column">
      <Text dimColor>{divider}</Text>
      {viewport.hasOverflowAbove ? <Text dimColor>  ...</Text> : null}
      {viewport.lines.map((line, index) => {
        const renderParts = buildCursorRenderParts(line.beforeCursor, line.afterCursor, line.placeholder);
        const plainText = `${line.beforeCursor}${line.afterCursor}${line.placeholder ?? ''}`;

        return (
          <Box key={`${index}-${line.beforeCursor.length}-${line.afterCursor.length}-${line.isCursorLine ? 1 : 0}`}>
            <Text color="greenBright">{createPromptPrefix(index)}</Text>
            <Box flexGrow={1} flexShrink={1}>
              {line.isCursorLine ? (
                <Text wrap="truncate-end" dimColor={renderParts.dimColor}>
                  {renderParts.beforeCursor}
                  {showCursor ? <Text inverse>{renderParts.cursorCell}</Text> : renderParts.cursorCell}
                  {renderParts.afterCursor}
                </Text>
              ) : (
                <Text wrap="truncate-end">{plainText}</Text>
              )}
            </Box>
          </Box>
        );
      })}
      {viewport.hasOverflowBelow ? <Text dimColor>  ...</Text> : null}
    </Box>
  );
}
