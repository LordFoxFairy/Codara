import React from 'react';
import {Box, Text} from 'ink';
import {useBlinkingCursor} from '../../hooks/use-blinking-cursor';
import type {CliComposerState} from '../../composer/types';
import {buildComposerViewport} from './composer-view';

interface PromptFrameProps {
  composer: CliComposerState;
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
  composer,
  cursorActivityVersion,
  isRunning,
  placeholder,
  terminalWidth,
}: PromptFrameProps): React.JSX.Element {
  const showCursor = useBlinkingCursor(!isRunning, cursorActivityVersion);
  const viewport = buildComposerViewport(composer, undefined, placeholder, terminalWidth);
  const hasText = Boolean(composer.text.trim());
  const isMultiLine = composer.text.includes('\n') || viewport.lines.length > 1;

  return (
    <Box flexDirection="column">
      {viewport.hasOverflowAbove ? <Text dimColor>  ...</Text> : null}
      {viewport.lines.map((line, index) => {
        const renderParts = buildCursorRenderParts(line.beforeCursor, line.afterCursor, line.placeholder);
        const plainText = `${line.beforeCursor}${line.afterCursor}${line.placeholder ?? ''}`;

        return (
          <Box key={`prompt-line-${index}`}>
            <Text color="green" bold>{index === 0 ? '> ' : '  '}</Text>
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
      {viewport.hasOverflowBelow ? <Text dimColor>  ...</Text> : null}
      {!isRunning && hasText && !isMultiLine ? (
        <Box justifyContent="flex-end">
          <Text dimColor>Shift+Enter newline · Enter send</Text>
        </Box>
      ) : null}
    </Box>
  );
}
