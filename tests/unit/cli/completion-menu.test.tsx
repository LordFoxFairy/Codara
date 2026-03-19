import {describe, expect, it} from 'bun:test';
import {render} from 'ink-testing-library';
import React from 'react';
import {CompletionMenu} from '@/cli/components/prompt/completion-menu';
import type {CommandCompletionState} from '@/cli/hooks/use-command-completion';

describe('cli completion menu', () => {
  it('renders a command hint even when the suggestion list is not visible', () => {
    const completion: CommandCompletionState = {
      visible: false,
      items: [],
      selectedIndex: 0,
      prefix: 'team',
      title: 'Commands',
      hint: {
        title: 'Command',
        label: '/team',
        description: 'Manage teams',
        sourceLabel: 'builtin',
        usage: '/team <create|list|status|enter|leave|message>',
        aliases: ['t'],
      },
    };

    const {lastFrame} = render(<CompletionMenu completion={completion} />);
    const frame = lastFrame()!;
    expect(frame).toContain('/team');
    expect(frame).toContain('Manage teams');
    expect(frame).toContain('/team <create|list|status|enter|leave|message>');
    expect(frame).toContain('aliases /t');
    expect(frame).not.toContain('╭');
  });

  it('shows richer selected-item metadata when the list is visible', () => {
    const completion: CommandCompletionState = {
      visible: true,
      items: [
        {
          kind: 'command',
          value: 'team',
          label: '/team',
          description: 'Manage teams',
          sourceLabel: 'builtin',
          usage: '/team <create|list|status|enter|leave|message>',
          commandName: 'team',
          aliases: ['t'],
        },
      ],
      selectedIndex: 0,
      prefix: 'te',
      title: 'Commands',
      hint: {
        title: 'Command',
        label: '/team',
        description: 'Manage teams',
        sourceLabel: 'builtin',
        usage: '/team <create|list|status|enter|leave|message>',
        aliases: ['t'],
      },
    };

    const {lastFrame} = render(<CompletionMenu completion={completion} />);
    const frame = lastFrame()!;
    expect(frame).toContain('tab accept  esc close');
    expect(frame).toContain('commands');
    expect(frame).toContain('> /team');
    expect(frame).toContain('[builtin]');
    expect(frame).toContain('aliases /t');
    expect(frame).not.toContain('╭');
  });
});
