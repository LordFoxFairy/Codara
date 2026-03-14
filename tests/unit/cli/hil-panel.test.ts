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

  it('should describe permission reviews as a dedicated foreground panel', () => {
    const review: CliHilReviewState = {
      request: {
        id: 'pause-2',
        description: 'Permission review required for Bash(touch guarded.txt)',
        action: {
          toolCallId: 'call_2',
          toolName: 'Bash',
          toolArgs: {command: 'touch guarded.txt'},
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
            {id: 'approve', label: 'Approve once', kind: 'primary'},
            {id: 'always', label: 'Always allow', kind: 'secondary', scope: 'project'},
            {id: 'reject', label: 'Reject', kind: 'danger'},
          ],
        },
      },
      actions: [
        {id: 'approve', label: 'Approve once', kind: 'primary'},
        {id: 'always', label: 'Always allow', kind: 'secondary', scope: 'project'},
        {id: 'reject', label: 'Reject', kind: 'danger'},
      ],
      selectedActionIndex: 1,
      focus: 'actions',
      draft: '',
      busy: false,
    };

    const model = describeHilPanel(review);

    expect(model.title).toBe('Bash command');
    expect(model.badge).toBeUndefined();
    expect(model.chrome).toBe('plain');
    expect(model.summary).toContain('touch guarded.txt');
    expect(model.question).toBe('Do you want to proceed?');
    expect(model.actions[0]?.label).toBe('Yes');
    expect(model.actions[1]?.label).toBe('Yes, and always allow this action');
    expect(model.actionDetail).toBeUndefined();
    expect(model.input).toBeUndefined();
  });

  it('should describe file-edit permission reviews with file-specific wording', () => {
    const review: CliHilReviewState = {
      request: {
        id: 'pause-3',
        description: 'Permission review required for Write(tmp/demo2/PLAN.md)',
        action: {
          toolCallId: 'call_3',
          toolName: 'write_file',
          toolArgs: {file_path: 'tmp/demo2/PLAN.md'},
        },
        review: {
          actionName: 'write_file',
          allowedDecisions: ['approve', 'reject'],
        },
        runtime: {
          runId: 'run-3',
          turn: 1,
          requestId: 'request-3',
          toolIndex: 0,
        },
        channel: 'permission-center',
        ui: {
          modal: 'permission-review',
          actions: [
            {id: 'allow_once', label: 'Allow once', kind: 'primary'},
            {id: 'always', label: 'Always allow this action', kind: 'secondary'},
            {id: 'allow_tool', label: 'Allow this command type', kind: 'secondary'},
            {id: 'edit', label: 'Edit and continue', kind: 'secondary', requiresToolEdit: true},
            {id: 'deny', label: 'Deny', kind: 'danger'},
          ],
        },
      },
      actions: [
        {id: 'allow_once', label: 'Allow once', kind: 'primary'},
        {id: 'always', label: 'Always allow this action', kind: 'secondary'},
        {id: 'allow_tool', label: 'Allow this command type', kind: 'secondary'},
        {id: 'edit', label: 'Edit and continue', kind: 'secondary', requiresToolEdit: true},
        {id: 'deny', label: 'Deny', kind: 'danger'},
      ],
      selectedActionIndex: 0,
      focus: 'actions',
      draft: '',
      busy: false,
    };

    const model = describeHilPanel(review);

    expect(model.title).toBe('File edit');
    expect(model.summary).toEqual(['tmp/demo2/PLAN.md']);
    expect(model.question).toBe('Do you want to make this edit to PLAN.md?');
    expect(model.actions[0]?.label).toBe('Yes');
    expect(model.actions[1]?.label).toBe('Yes, and always allow this edit');
    expect(model.actions[2]?.label).toBe('Yes, and allow edits like this');
    expect(model.actions[3]?.label).toBe('Amend edit');
    expect(model.actions[4]?.label).toBe('No');
  });
});
