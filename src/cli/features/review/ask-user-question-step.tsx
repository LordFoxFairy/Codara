import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {
  isOptionSelected,
  renderAskUserCustomRow,
  supportsAskUserCustomOption,
} from './ask-user-helpers';

export function AskUserQuestionStep(
  {
    review,
    activeTab,
    dividerWidth,
  }: {
    review: CliReviewState;
    activeTab: NonNullable<NonNullable<CliReviewState['form']>['tabs'][number]>;
    dividerWidth: number;
  },
): React.JSX.Element {
  const activeOptions = activeTab.options;
  const customOptionIndex = activeOptions.length + 1;
  const nextFocused = review.focus === 'actions' && review.selectedActionIndex === 0;

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{activeTab.question}</Text>
      <Box marginTop={1} flexDirection="column">
        {activeOptions.map((option, index) => {
          const answer = review.form?.answers[activeTab.id];
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
        <Text color={nextFocused ? 'green' : undefined} bold={nextFocused}>
          {nextFocused ? '› ' : '  '}Next
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
      </Box>
      {review.validationMessage && <Text color="red">{review.validationMessage}</Text>}
    </Box>
  );
}
