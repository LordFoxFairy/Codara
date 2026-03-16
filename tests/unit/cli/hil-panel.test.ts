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
          toolName: 'AskUserQuestion',
          toolArgs: {summary: 'A few structured inputs are missing before the agent can continue.'},
        },
        review: {
          actionName: 'AskUserQuestion',
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
    const actionText = model.actions.map((line) => line.label).join('\n');
    const optionText = model.options.map((line) => line.label).join('\n');

    expect(model.title).toBe('Need Your Input');
    expect(model.badge).toBe('clarification-center');
    expect(model.summary.join('\n')).toContain('A few structured inputs are missing before the agent can continue.');
    expect(model.tabsLine).toContain('[Product Domain]');
    expect(model.question).toContain('Which product domain should this work target?');
    expect(optionText).toContain('SaaS product');
    expect(optionText).toContain('Choose a domain or type your own answer.');
    expect(actionText).toContain('Submit');
    expect(actionText).toContain('Chat about this');
    expect(model.compactActions).toBe(true);
    expect(model.meta).toBeUndefined();
    expect(model.input?.style).toBe('inline');
  });

  it('should describe permission reviews matching Claude Code: Yes / Yes dont ask again / No', () => {
    const review: CliHilReviewState = {
      request: {
        id: 'pause-2',
        description: 'Codara wants to run Bash(touch guarded.txt)',
        action: {
          toolCallId: 'call_2',
          toolName: 'Bash',
          toolArgs: {command: 'touch guarded.txt'},
        },
        metadata: {
          permissionPolicy: {
            reason: 'Needs approval because no allow rule covers touch guarded.txt.',
          },
        },
        review: {
          actionName: 'Bash',
          allowedDecisions: ['approve', 'reject'],
        },
        runtime: {
          runId: 'run-2',
          turn: 1,
          requestId: 'request-2',
          toolIndex: 0,
        },
        channel: 'permission-center',
        ui: {
          modal: 'permission-review',
          actions: [
            {id: 'allow_once', label: 'Yes', kind: 'primary'},
            {id: 'dont_ask_again', label: "Yes, don't ask again", kind: 'secondary'},
            {id: 'deny', label: 'No', kind: 'danger'},
          ],
        },
      },
      actions: [
        {id: 'allow_once', label: 'Yes', kind: 'primary'},
        {id: 'dont_ask_again', label: "Yes, don't ask again", kind: 'secondary'},
        {id: 'deny', label: 'No', kind: 'danger'},
      ],
      selectedActionIndex: 0,
      focus: 'actions',
      draft: '',
      busy: false,
    };

    const model = describeHilPanel(review);

    expect(model.title).toBe('Codara wants to run Bash(touch guarded.txt)');
    expect(model.badge).toBe('permission');
    expect(model.tone).toBe('yellow');
    expect(model.actions).toHaveLength(3);
    expect(model.actions[0]?.label).toBe('Yes');
    expect(model.actions[1]?.label).toBe("Yes, don't ask again");
    expect(model.actions[2]?.label).toBe('No');
    expect(model.compactActions).toBeUndefined();
    expect(model.input).toBeUndefined();
  });
});
