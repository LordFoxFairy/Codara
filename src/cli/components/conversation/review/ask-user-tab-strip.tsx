import React from 'react';
import {Box, Text} from 'ink';
import type {CliReviewState} from '../../../app/view-state';
import {truncateLabel} from './review-panel-helpers';

export function AskUserTabStrip(
  {form}: {form: NonNullable<CliReviewState['form']>},
): React.JSX.Element {
  const onEndStep = Boolean(form.endStep);
  const currentStepIndex = onEndStep ? form.tabs.length : form.activeTabIndex;
  const labels = [
    ...form.tabs.map((tab) => ({kind: 'question' as const, label: tab.label})),
    {kind: 'submit' as const, label: 'Submit'},
  ];

  return (
    <Box marginBottom={1} flexWrap="nowrap">
      <Text dimColor>← </Text>
      {labels.map((item, index) => {
        const isActive = index === currentStepIndex;
        const prefix = item.kind === 'submit' ? '✔ ' : '☐ ';
        return (
          <React.Fragment key={`${item.kind}:${item.label}`}>
            {index > 0 && <Text dimColor>{'  '}</Text>}
            <Text
              backgroundColor={isActive ? 'blue' : undefined}
              color={isActive ? 'white' : undefined}
              bold={isActive}
            >
              {`${prefix}${truncateLabel(item.label, 12)}`}
            </Text>
          </React.Fragment>
        );
      })}
      <Text dimColor>{'  →'}</Text>
    </Box>
  );
}
