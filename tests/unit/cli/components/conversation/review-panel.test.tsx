import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import {ReviewPanel} from '@/cli/components/conversation/review-panel';
import type {CliReviewState} from '@/cli/app/view-state';

describe('ReviewPanel review queue banner', () => {
  it('should show review position and queue-switch hint', () => {
    const review = {
      request: {
        id: 'pause-2',
        description: 'Permission review required for git push.',
        action: {
          toolCallId: 'call-2',
          toolName: 'bash',
          toolArgs: {command: 'git push'},
        },
        review: {
          actionName: 'bash',
          allowedDecisions: ['approve', 'reject'],
        },
        runtime: {
          runId: 'run-2',
          turn: 4,
          requestId: 'req-2',
          toolIndex: 0,
        },
        channel: 'permission-center',
        ui: {
          actions: [
            {id: 'allow_once', label: 'Allow once', kind: 'primary'},
            {id: 'deny', label: 'Deny', kind: 'danger'},
          ],
        },
      },
      actions: [
        {id: 'allow_once', label: 'Allow once', kind: 'primary'},
        {id: 'deny', label: 'Deny', kind: 'danger'},
      ],
      selectedActionIndex: 0,
      focus: 'actions',
      draft: '',
      busy: false,
      blockingScope: 'task',
      reviewIndex: 2,
      reviewCount: 5,
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);

    expect(lastFrame()).toContain('Review 2/5');
    expect(lastFrame()).toContain('Use [ and ] to switch reviews');
    expect(lastFrame()).toContain('Permission review required for git push.');
  });

  it('separates AskUser tabs from the final submit step while keeping question pages on a Next-only footer', () => {
    const review = {
      request: {
        id: 'pause-form',
        description: 'Collect requirements.',
        action: {
          toolCallId: 'call-form',
          toolName: 'AskUserQuestion',
          toolArgs: {},
        },
        review: {
          actionName: 'AskUserQuestion',
          allowedDecisions: ['approve'],
        },
        runtime: {
          runId: 'run-form',
          turn: 1,
          requestId: 'req-form',
          toolIndex: 0,
        },
        channel: 'interaction-center',
        ui: {
          actions: [
            {id: 'submit', label: 'Submit', kind: 'primary'},
            {id: 'cancel', label: 'Cancel', kind: 'secondary'},
          ],
          form: {
            tabs: [
              {
                id: 'spec_source',
                label: 'Spec Source',
                question: 'Where are the requirements?',
                options: [
                  {id: 'file', label: 'Existing spec file', description: 'I already have a spec document.'},
                  {id: 'describe', label: "I'll describe it", description: 'I will describe the work in chat.'},
                ],
              },
              {
                id: 'feature_name',
                label: 'Feature Name',
                question: 'What is the feature name?',
                options: [
                  {id: 'sync', label: 'Sync flow'},
                ],
              },
            ],
          },
        },
      },
      actions: [
        {id: 'submit', label: 'Submit', kind: 'primary'},
        {id: 'cancel', label: 'Cancel', kind: 'secondary'},
      ],
      selectedActionIndex: 0,
      focus: 'input',
      draft: '',
      busy: false,
      blockingScope: 'session',
      form: {
        tabs: [
          {
            id: 'spec_source',
            label: 'Spec Source',
            question: 'Where are the requirements?',
            options: [
              {id: 'file', label: 'Existing spec file', description: 'I already have a spec document.'},
              {id: 'describe', label: "I'll describe it", description: 'I will describe the work in chat.'},
            ],
          },
          {
            id: 'feature_name',
            label: 'Feature Name',
            question: 'What is the feature name?',
            options: [
              {id: 'sync', label: 'Sync flow'},
            ],
          },
        ],
        activeTabIndex: 0,
        answers: {},
      },
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Spec Source');
    expect(frame).toContain('☐ Spec Source');
    expect(frame).toContain('☐ Feature Name');
    expect(frame).toContain('✔ Submit');
    expect(frame).not.toContain('Review 1/1');
    expect(frame).not.toContain('Use [ and ] to switch reviews');
    expect(frame).not.toContain('✓Submit');
    expect(frame).not.toContain('3. Submit');
    expect(frame).toContain('Next');
    expect(frame).not.toContain('Chat about this');
    expect(frame).not.toContain('Actions');
    expect(frame).not.toContain('[Submit]');
    expect(frame).not.toContain('Answer');
    expect(frame).toContain('3. ○ Type something.');
  });

  it('keeps question steps on a plain Next footer even before the current answer is complete', () => {
    const review = {
      ...createAskUserReview(),
      focus: 'actions' as const,
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Next');
    expect(frame).not.toContain('Chat about this');
    expect(frame).not.toContain('[Submit]');
    expect(frame).not.toContain('Enter submit');
  });

  it('renders floating AskUser submit steps as a dedicated review page with numbered actions', () => {
    const review = {
      ...createAskUserReview(),
      focus: 'actions',
      form: {
        ...createAskUserReview().form!,
        endStep: true,
      },
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);
    const frame = lastFrame();

    expect(frame).toContain('Review your answers');
    expect(frame).not.toContain('Enter to select');
    expect(frame).not.toContain('Actions');
    expect(frame).toContain('✔ Submit');
    expect(frame).toContain('1. Submit answers');
    expect(frame).toContain('2. Cancel');
  });

  it('keeps AskUser question pages free of the older action-bar and help-hint copy', () => {
    const review = {
      request: {
        id: 'pause-form-hint',
        description: 'Collect requirements.',
        action: {
          toolCallId: 'call-form-hint',
          toolName: 'AskUserQuestion',
          toolArgs: {},
        },
        review: {
          actionName: 'AskUserQuestion',
          allowedDecisions: ['approve'],
        },
        runtime: {
          runId: 'run-form',
          turn: 1,
          requestId: 'req-form',
          toolIndex: 0,
        },
        channel: 'interaction-center',
        ui: {
          actions: [
            {id: 'submit', label: 'Submit', kind: 'primary'},
            {id: 'cancel', label: 'Cancel', kind: 'secondary'},
          ],
          form: {
            tabs: [{
              id: 'spec_source',
              label: 'Spec Source',
              question: 'Where are the requirements?',
              options: [{id: 'file', label: 'Existing spec file'}],
            }],
          },
        },
      },
      actions: [
        {id: 'submit', label: 'Submit', kind: 'primary'},
        {id: 'cancel', label: 'Cancel', kind: 'secondary'},
      ],
      selectedActionIndex: 0,
      focus: 'input',
      draft: '',
      busy: false,
      blockingScope: 'session',
      form: {
        tabs: [{
          id: 'spec_source',
          label: 'Spec Source',
          question: 'Where are the requirements?',
          options: [{id: 'file', label: 'Existing spec file'}],
        }],
        activeTabIndex: 0,
        answers: {},
      },
    } satisfies CliReviewState;

    const {lastFrame} = render(<ReviewPanel review={review} />);
    const frame = lastFrame();

    expect(frame).not.toContain('Enter to select');
    expect(frame).not.toContain('Tab/Arrow keys to navigate');
    expect(frame).not.toContain('Actions');
    expect(frame).not.toContain('Answer');
  });

  it('renders Claude Code style question steps with plain numbered rows, custom typing, and a standalone next footer', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      tabs: [{
        id: 'direction',
        label: '讨论方向',
        question: '你想探讨哪个维度的 AI 产品形态？',
        options: [
          {id: 'positioning', label: 'Codara 的产品定位', description: '讨论 Codara 本身作为 AI 产品的形态、定位和差异化'},
          {id: 'market', label: 'AI 产品通用形态分析', description: '探讨当前市场上 AI 产品的各种形态、模式和趋势'},
        ],
      }],
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('讨论方向');
    expect(frame).toContain('✔ Submit');
    expect(frame).toContain('› 1. ○ Codara 的产品定位');
    expect(frame).toContain('2. ○ AI 产品通用形态分析');
    expect(frame).toContain('3. ○ Type something.');
    expect(frame).toContain('Next');
    expect(frame).not.toContain('Chat about this');
    expect(frame).not.toContain('( )');
    expect(frame).not.toContain('[Next]');
    expect(frame).not.toContain('Choose one or type your own answer.');
    expect(frame).not.toContain('Custom answer');
  });

  it('renders Claude Code style multiselect rows with checkbox markers and a plain next row', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      input: 'multiselect',
      selectedActionIndex: 0,
      focus: 'actions',
      answers: {
        spec_source: ['个人开发者'],
      },
      tabs: [{
        id: 'spec_source',
        label: '目标用户',
        question: '你主要关注哪个用户群体？',
        options: [
          {id: 'solo', label: '个人开发者', description: '独立开发者、自由职业者'},
          {id: 'team', label: '团队/企业', description: '研发团队、中大型公司'},
          {id: 'non-tech', label: '非技术用户', description: '产品经理、设计师等非工程背景用户'},
        ],
      }],
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('1. [x] 个人开发者');
    expect(frame).toContain('2. [ ] 团队/企业');
    expect(frame).toContain('3. [ ] 非技术用户');
    expect(frame).toContain('4. [ ] Type something.');
    expect(frame).toContain('Next');
    expect(frame).not.toContain('[Next]');
    expect(frame).not.toContain('Space toggle');
    expect(frame).not.toContain('Chat about this');
  });

  it('keeps the multiselect custom row as a placeholder when only preset options are selected', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      input: 'multiselect',
      selectedActionIndex: 4,
      customInputActive: true,
      answers: {
        spec_source: ['独立开发者'],
      },
      tabs: [{
        id: 'spec_source',
        label: '目标用户',
        question: '你主要关注哪个用户群体？',
        options: [
          {id: 'solo', label: '独立开发者', description: '个人项目、快速原型开发'},
          {id: 'team', label: '开发团队', description: '协作开发、代码审查、知识共享'},
          {id: 'enterprise', label: '企业客户', description: '私有部署、权限管控、审计合规'},
          {id: 'non-tech', label: '非技术用户', description: '产品经理、设计师等非开发人员'},
        ],
      }],
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('1. [x] 独立开发者');
    expect(frame).toContain('5. [ ] Type something.');
    expect(frame).not.toContain('5. [x] 独立开发者');
  });

  it('shows the multiselect custom row as selected when it has been chosen even before text is entered', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      input: 'multiselect',
      selectedActionIndex: 4,
      customInputActive: true,
      customInputSelected: true,
      tabs: [{
        id: 'spec_source',
        label: '目标用户',
        question: '产品的目标用户群体是？（可多选）',
        options: [
          {id: 'dev', label: '开发者', description: '程序员、工程师、技术团队'},
          {id: 'enterprise', label: '企业用户', description: '公司、组织、团队协作场景'},
          {id: 'personal', label: '个人用户', description: '个人助理、学习、生活场景'},
          {id: 'expert', label: '领域专家', description: '特定行业的专业人士'},
        ],
      }],
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('5. [x] Type something.');
  });

  it('renders Claude Code style submit step with numbered submit/cancel rows instead of button chips', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      endStep: true,
      focus: 'actions',
      tabs: [
        {id: 'direction', label: '讨论方向', question: 'Q1', options: [{id: 'a', label: 'A'}]},
        {id: 'audience', label: '目标用户', question: 'Q2', options: [{id: 'b', label: 'B'}]},
        {id: 'problem', label: '核心问题', question: 'Q3', options: [{id: 'c', label: 'C'}]},
      ],
      answers: {
        direction: 'A',
      },
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('Review your answers');
    expect(frame).toContain('You have not answered all questions');
    expect(frame).toContain('1. Submit answers');
    expect(frame).toContain('2. Cancel');
    expect(frame).not.toContain('[Submit]');
    expect(frame).not.toContain('[Chat about this]');
  });

  it('collapses long AskUser tab headers into a compact step navigator', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      tabs: [
        {id: 'p1', label: '需求来源优先级', question: 'Q1', options: [{id: 'a', label: 'A'}]},
        {id: 'p2', label: '功能名称', question: 'Q2', options: [{id: 'b', label: 'B'}]},
        {id: 'p3', label: '功能描述', question: 'Q3', options: [{id: 'c', label: 'C'}]},
        {id: 'p4', label: '涉及范围', question: 'Q4', options: [{id: 'd', label: 'D'}]},
        {id: 'p5', label: '技术难度', question: 'Q5', options: [{id: 'e', label: 'E'}]},
      ],
      activeTabIndex: 2,
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('☐ 功能描述');
    expect(frame).toContain('功能描述');
    expect(frame).toContain('☐ 技术难度');
    expect(frame).toContain('✔ Submit');
  });

  it('keeps answered ask steps visually neutral instead of rendering completion checkmarks in the tab strip', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      tabs: [
        {id: 'p1', label: '讨论方向', question: 'Q1', options: [{id: 'a', label: 'A'}]},
        {id: 'p2', label: '目标用户', question: 'Q2', options: [{id: 'b', label: 'B'}]},
      ],
      activeTabIndex: 1,
      answers: {p1: 'A'},
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('☐ 讨论方向');
    expect(frame).not.toContain('☑ 讨论方向');
  });

  it('renders single-select AskUser rows with radio markers', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      answers: {spec_source: 'Existing spec file'},
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('1. ◉ Existing spec file');
    expect(frame).toContain('2. ○ Type something.');
  });

  it('replaces the Type something placeholder with the inline custom draft while editing', () => {
    const {lastFrame} = render(<ReviewPanel review={createAskUserReview({
      selectedActionIndex: 1,
      draft: '自定义方向',
      customInputActive: true,
      tabs: [{
        id: 'direction',
        label: '讨论方向',
        question: '你想探讨哪个维度的 AI 产品形态？',
        options: [{id: 'positioning', label: 'Codara 的产品定位'}],
      }],
    })} />);

    const frame = lastFrame();

    expect(frame).toContain('2. ◉ 自定义方向');
    expect(frame).not.toContain('Type something. 自定义方向');
  });
});

function createAskUserReview(
  options: {
    input?: 'select' | 'multiselect';
    tabs?: Array<{id: string; label: string; question: string; input?: 'select' | 'multiselect'; options: Array<{id: string; label: string; description?: string}>}>;
    activeTabIndex?: number;
    endStep?: boolean;
    focus?: CliReviewState['focus'];
    selectedActionIndex?: number;
    answers?: Record<string, string | string[]>;
    draft?: string;
    customInputSelected?: boolean;
    customInputActive?: boolean;
  } = {},
): CliReviewState {
  const tabs = (options.tabs ?? [{
    id: 'spec_source',
    label: 'Spec Source',
    question: 'Where are the requirements?',
    options: [{id: 'file', label: 'Existing spec file'}],
    input: options.input ?? 'select',
  }]).map((tab) => ({
    ...tab,
    input: tab.input ?? options.input ?? 'select',
  }));

  return {
    request: {
      id: 'pause-form-hint',
      description: 'Collect requirements.',
      action: {
        toolCallId: 'call-form-hint',
        toolName: 'AskUserQuestion',
        toolArgs: {},
      },
      review: {
        actionName: 'AskUserQuestion',
        allowedDecisions: ['approve'],
      },
      runtime: {
        runId: 'run-form',
        turn: 1,
        requestId: 'req-form',
        toolIndex: 0,
      },
      channel: 'interaction-center',
      ui: {
        actions: [
          {id: 'submit', label: 'Submit', kind: 'primary'},
          {id: 'cancel', label: 'Cancel', kind: 'secondary'},
        ],
        form: {
          tabs,
        },
      },
    },
    actions: [
      {id: 'submit', label: 'Submit', kind: 'primary'},
      {id: 'cancel', label: 'Cancel', kind: 'secondary'},
    ],
    selectedActionIndex: options.selectedActionIndex ?? 0,
    focus: options.focus ?? 'input',
    draft: options.draft ?? '',
    customInputSelected: options.customInputSelected ?? false,
    customInputActive: options.customInputActive ?? false,
    busy: false,
    blockingScope: 'session',
    form: {
      tabs,
      activeTabIndex: options.activeTabIndex ?? 0,
      answers: options.answers ?? {},
      endStep: options.endStep ?? false,
    },
  };
}
