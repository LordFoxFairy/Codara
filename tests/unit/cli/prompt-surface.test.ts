import {describe, expect, it} from 'bun:test';
import {resolveCliPromptSurfaceState} from '@/cli/hooks/use-cli-prompt-surface';

describe('CLI prompt surface state', () => {
  it('shows the prompt frame when no overlay is active', () => {
    expect(resolveCliPromptSurfaceState({
      hasHilReview: false,
      sessionPickerVisible: false,
      autoExitOnSettledPrompt: false,
      hasInitialPrompt: false,
      hasCommandOutput: false,
      hasConversation: false,
      runStatus: 'idle',
      hasActiveTeams: false,
    })).toEqual({
      interactive: true,
      disabled: false,
      showCommandOutput: false,
      showPromptFrame: true,
      showSelectedMember: false,
      promptPlaceholder: 'Ask Codara...',
    });
  });

  it('keeps the prompt frame visible when completion is open and keeps the reply placeholder', () => {
    expect(resolveCliPromptSurfaceState({
      hasHilReview: false,
      sessionPickerVisible: false,
      autoExitOnSettledPrompt: false,
      hasInitialPrompt: false,
      hasCommandOutput: false,
      hasConversation: true,
      runStatus: 'idle',
      hasActiveTeams: true,
      selectedMemberName: 'worker-1',
    })).toEqual({
      interactive: true,
      disabled: false,
      showCommandOutput: false,
      showPromptFrame: true,
      showSelectedMember: true,
      promptPlaceholder: 'Reply to Codara...',
    });
  });

  it('disables prompt input during HIL and exposes command output when present', () => {
    expect(resolveCliPromptSurfaceState({
      hasHilReview: true,
      sessionPickerVisible: false,
      autoExitOnSettledPrompt: false,
      hasInitialPrompt: false,
      hasCommandOutput: true,
      hasConversation: true,
      runStatus: 'running',
      hasActiveTeams: true,
      selectedMemberName: 'worker-1',
    })).toEqual({
      interactive: false,
      disabled: true,
      showCommandOutput: true,
      showPromptFrame: false,
      showSelectedMember: false,
      promptPlaceholder: 'Reply to Codara...',
    });
  });

  it('keeps the prompt frame visible while command output is open', () => {
    expect(resolveCliPromptSurfaceState({
      hasHilReview: false,
      sessionPickerVisible: false,
      autoExitOnSettledPrompt: false,
      hasInitialPrompt: false,
      hasCommandOutput: true,
      hasConversation: true,
      runStatus: 'done',
      hasActiveTeams: true,
      selectedMemberName: 'worker-1',
    })).toEqual({
      interactive: true,
      disabled: false,
      showCommandOutput: true,
      showPromptFrame: true,
      showSelectedMember: true,
      promptPlaceholder: 'Reply to Codara...',
    });
  });

  it('stops accepting prompt input when auto-exit mode is waiting to close', () => {
    expect(resolveCliPromptSurfaceState({
      hasHilReview: false,
      sessionPickerVisible: false,
      autoExitOnSettledPrompt: true,
      hasInitialPrompt: true,
      hasCommandOutput: false,
      hasConversation: true,
      runStatus: 'done',
      hasActiveTeams: true,
      selectedMemberName: 'worker-1',
    })).toEqual({
      interactive: false,
      disabled: false,
      showCommandOutput: false,
      showPromptFrame: true,
      showSelectedMember: true,
      promptPlaceholder: 'Reply to Codara...',
    });
  });

  it('keeps prompt editing active while the model is still running', () => {
    expect(resolveCliPromptSurfaceState({
      hasHilReview: false,
      sessionPickerVisible: false,
      autoExitOnSettledPrompt: false,
      hasInitialPrompt: false,
      hasCommandOutput: false,
      hasConversation: true,
      runStatus: 'running',
      hasActiveTeams: false,
    })).toEqual({
      interactive: true,
      disabled: false,
      showCommandOutput: false,
      showPromptFrame: true,
      showSelectedMember: false,
      promptPlaceholder: 'Reply to Codara...',
    });
  });
});
