import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {isAnswered} from './ask-user-helpers';
import {resolveActionColor} from './panel-helpers';

export function AskUserSubmitStep({review}: {review: CliReviewState}): React.JSX.Element {
  const form = review.form!;
  const submitActions = review.actions.filter((action) => action.id === 'submit' || action.id === 'cancel');
  const firstIncompleteLabel = form.tabs.find((tab) => !isAnswered(form.answers[tab.id]))?.label;

  return (
    <Box flexDirection="column">
      <Text bold>Review your answers</Text>
      {(review.validationMessage || firstIncompleteLabel) && (
        <Box marginTop={1}>
          <Text color="yellow">{`⚠ ${review.validationMessage ?? 'You have not answered all questions'}`}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Ready to submit your answers?</Text>
      </Box>
      <Box marginTop={2} flexDirection="column">
        {submitActions.map((action, index) => {
          const isFocused = review.focus === 'actions' && review.selectedActionIndex === index;
          return (
            <Text key={action.id} color={resolveActionColor(action, isFocused)}>
              {isFocused ? '› ' : '  '}{index + 1}. {action.id === 'submit' ? 'Submit answers' : action.label}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
