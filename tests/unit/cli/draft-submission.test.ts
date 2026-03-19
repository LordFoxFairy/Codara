import {describe, expect, it} from 'bun:test';
import {resolveCliDraftSubmission} from '@/cli/app/draft-submission';

describe('CLI draft submission', () => {
  it('returns empty for blank draft text', () => {
    expect(resolveCliDraftSubmission({
      text: '   ',
      teamNames: [],
    })).toEqual({type: 'empty'});
  });

  it('keeps plain prompts as normal prompt submission', () => {
    expect(resolveCliDraftSubmission({
      text: 'fix the failing test',
      teamNames: ['builder'],
    })).toEqual({
      type: 'plain-prompt',
      prompt: 'fix the failing test',
    });
  });

  it('turns @team shorthand into a slash command plan', () => {
    expect(resolveCliDraftSubmission({
      text: '@builder check the latest failure',
      teamNames: ['builder'],
    })).toEqual({
      type: 'team-message',
      teamName: 'builder',
      message: 'check the latest failure',
      command: '/team message builder check the latest failure',
    });
  });

  it('returns a team-not-found plan when shorthand targets a missing team', () => {
    expect(resolveCliDraftSubmission({
      text: '@builder check the latest failure',
      teamNames: ['reviewer', 'planner'],
    })).toEqual({
      type: 'team-not-found',
      teamName: 'builder',
      availableTeams: ['reviewer', 'planner'],
    });
  });
});
