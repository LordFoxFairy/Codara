import React from 'react';
import {Box, Text} from 'ink';
import type {CommandCompletionState} from '../../hooks/use-command-completion';
import {theme} from '../../utils/theme';

const VIEWPORT_SIZE = 10;
const NAME_COL_WIDTH = 26;

interface CompletionMenuProps {
  completion: CommandCompletionState;
}

function truncateLabel(value: string): string {
  return value.length > NAME_COL_WIDTH - 1
    ? `${value.slice(0, NAME_COL_WIDTH - 4)}...`
    : value;
}

function formatAliases(aliases: readonly string[]): string | undefined {
  if (aliases.length === 0) {
    return undefined;
  }

  return aliases.map((alias) => `/${alias}`).join(', ');
}

export function CompletionMenu({completion}: CompletionMenuProps): React.JSX.Element | null {
  if (!completion.visible && !completion.hint) {
    return null;
  }

  const {items, selectedIndex, title, hint} = completion;
  const total = items.length;

  let viewStart = 0;
  if (total > VIEWPORT_SIZE) {
    const centered = selectedIndex - Math.floor(VIEWPORT_SIZE / 2);
    viewStart = Math.max(0, Math.min(centered, total - VIEWPORT_SIZE));
  }
  const viewEnd = Math.min(total, viewStart + VIEWPORT_SIZE);
  const visibleItems = items.slice(viewStart, viewEnd);
  const hasMoreAbove = viewStart > 0;
  const hasMoreBelow = viewEnd < total;
  const hintAliases = hint ? formatAliases(hint.aliases) : undefined;

  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text color={theme.chrome.dimmed}>
          {completion.visible ? title.toLowerCase() : (hint?.title ?? 'Command').toLowerCase()}
        </Text>
        {completion.visible ? <Text dimColor>tab accept  esc close</Text> : null}
      </Box>

      {completion.visible && hasMoreAbove && <Text dimColor>^ {viewStart} more</Text>}
      {completion.visible && visibleItems.map((item, index) => {
        const realIndex = viewStart + index;
        const selected = realIndex === selectedIndex;
        const displayName = truncateLabel(item.label);
        const padded = displayName.padEnd(NAME_COL_WIDTH);
        const itemAliases = item.kind === 'command' ? formatAliases(item.aliases) : undefined;

        return (
          <Box key={`${item.kind}-${item.commandName}-${item.value}`} flexDirection="column">
            <Box>
              <Text color={selected ? theme.interactive.selection : undefined} bold={selected}>
                {selected ? '> ' : '  '}{padded}
              </Text>
              <Text color={selected ? theme.interactive.accent : theme.chrome.dimmed}>
                [{item.sourceLabel}]
              </Text>
            </Box>
            <Text color={theme.chrome.dimmed} wrap="truncate-end">
              {item.description}{itemAliases ? `  aliases ${itemAliases}` : ''}
            </Text>
          </Box>
        );
      })}
      {completion.visible && hasMoreBelow && <Text dimColor>v {total - viewEnd} more</Text>}

      {hint && (
        <Box marginTop={completion.visible ? 0 : 1} flexDirection="column">
          <Box>
            <Text bold color={theme.interactive.prompt}>{hint.label}</Text>
            <Text color={theme.chrome.dimmed}> [{hint.sourceLabel}]</Text>
          </Box>
          <Text color={theme.chrome.dimmed} wrap="wrap">{hint.description}</Text>
          <Box>
            <Text color={theme.interactive.accent}>usage </Text>
            <Text wrap="wrap">{hint.usage}</Text>
          </Box>
          {hintAliases && <Text dimColor>aliases {hintAliases}</Text>}
        </Box>
      )}
    </Box>
  );
}
