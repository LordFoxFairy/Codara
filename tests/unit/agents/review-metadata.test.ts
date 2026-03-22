import {describe, expect, it} from 'bun:test';
import {
  mergeSubagentPauseMetadata,
  mergeSubagentRunRecoveryMetadata,
  readSubagentPauseMetadata,
  readSubagentRunRecoveryMetadata,
} from '@capability/subagent/review-metadata';

describe('subagent review metadata helpers', () => {
  it('should round-trip subagent pause metadata for wrapped parent reviews', () => {
    const metadata = mergeSubagentPauseMetadata(
      {skill: 'Explore'},
      {
        childSessionId: 'child-1',
        recovery: {
          toolNames: ['read_file'],
          systemMessages: ['system'],
          maxTurns: 5,
        },
      },
    );

    expect(readSubagentPauseMetadata(metadata)).toEqual({
      childSessionId: 'child-1',
      recovery: {
        toolNames: ['read_file'],
        systemMessages: ['system'],
        maxTurns: 5,
      },
    });
  });

  it('should round-trip subagent-run recovery metadata for runtime approvals', () => {
    const metadata = mergeSubagentRunRecoveryMetadata(
      {skill: 'Explore'},
      {
        childSessionId: 'child-2',
        recovery: {
          toolNames: ['bash'],
          systemMessages: ['system'],
          maxTurns: 7,
        },
      },
    );

    expect(readSubagentRunRecoveryMetadata(metadata)).toEqual({
      childSessionId: 'child-2',
      recovery: {
        toolNames: ['bash'],
        systemMessages: ['system'],
        maxTurns: 7,
      },
    });
  });
});
