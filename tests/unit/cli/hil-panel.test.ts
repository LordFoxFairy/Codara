import {describe, expect, it} from 'bun:test';
import {describeHilPanel} from '../../../src/cli/components/conversation/hil-panel';
import type {CliHilReviewState} from '../../../src/cli/app/view-state';

describe('HIL panel model', () => {
  it('should describe the generic form UI through the shared HIL panel model', () => {
    const review: CliHilReviewState = {
      request: {
        id: 'pause-1',
        description: 'Collect the missing brief details before planning starts.',
        action: {
          toolCallId: 'call_1',
          toolName: 'AskUser',
          toolArgs: {summary: 'A few structured inputs are missing before the agent can continue.'},
        },
        review: {
          actionName: 'AskUser',
          allowedDecisions: ['approve'],
        },
        runtime: {
          runId: 'run-1',
          turn: 1,
          requestId: 'request-1',
          toolIndex: 0,
        },
        channel: 'clarification-center',
        ui: {
          tab: 'Brief Intake',
          actions: [
            {id: 'submit', label: 'Submit', kind: 'primary'},
            {id: 'chat', label: 'Chat about this', kind: 'secondary'},
          ],
          form: {
            summary: 'A few structured inputs are missing before the agent can continue.',
            tabs: [
              {
                id: 'domain',
                label: 'Product Domain',
                question: 'Which product domain should this work target?',
                input: 'multiselect',
                options: [
                  {id: 'saas', label: 'SaaS product', description: 'General software or platform work.'},
                ],
                placeholder: 'Choose a domain or type your own answer.',
              },
            ],
          },
        },
      },
      actions: [
        {id: 'submit', label: 'Submit', kind: 'primary'},
        {id: 'chat', label: 'Chat about this', kind: 'secondary'},
      ],
      selectedActionIndex: 0,
      focus: 'actions',
      draft: '',
      busy: false,
      form: {
        summary: 'A few structured inputs are missing before the agent can continue.',
        tabs: [
          {
            id: 'domain',
            label: 'Product Domain',
            question: 'Which product domain should this work target?',
            input: 'multiselect',
            options: [
              {id: 'saas', label: 'SaaS product', description: 'General software or platform work.'},
            ],
            placeholder: 'Choose a domain or type your own answer.',
          },
        ],
        activeTabIndex: 0,
        answers: {},
      },
    };

    const model = describeHilPanel(review);
    const text = model.lines.map((line) => line.text).join('\n');

    expect(model.title).toBe('HIL Review');
    expect(text).toContain('Channel clarification-center | Tab Brief Intake | Form');
    expect(text).toContain('Tool AskUser(1 prompt)');
    expect(text).toContain('[Product Domain]');
    expect(text).toContain('Which product domain should this work target? [multi-select]');
    expect(text).toContain('1. SaaS product');
    expect(text).toContain('Input: Choose a domain or type your own answer.');
    expect(text).toContain('> Submit');
    expect(text).toContain('Chat about this');
  });
});
