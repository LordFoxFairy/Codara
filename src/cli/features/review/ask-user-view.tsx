import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../app/view-state';
import {AskUserQuestionStep} from './ask-user-question-step';
import {AskUserSubmitStep} from './ask-user-submit-step';
import {AskUserTabStrip} from './ask-user-tab-strip';

export function AskUserReviewBody(
  {review, terminalWidth}: {review: CliReviewState; terminalWidth?: number},
): React.JSX.Element {
  const form = review.form!;
  const activeTab = form.endStep ? undefined : form.tabs[form.activeTabIndex];
  const showSubmitStep = Boolean(form.endStep);
  const dividerWidth = Math.max(24, (terminalWidth ?? 80) - 4);

  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(dividerWidth)}</Text>
      {form.tabs.length > 0 && <AskUserTabStrip form={form} />}

      {showSubmitStep ? (
        <AskUserSubmitStep review={review} />
      ) : activeTab ? (
        <AskUserQuestionStep review={review} activeTab={activeTab} dividerWidth={dividerWidth} />
      ) : null}

      {review.busy && <Text color="cyan">Applying selection...</Text>}
    </Box>
  );
}
