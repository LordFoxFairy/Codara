import {describe, expect, it} from 'bun:test';
import {toFilesystemSafeId, getTranscriptPath} from '../../../src/session/storage';

describe('toFilesystemSafeId', () => {
  it('should pass through safe strings', () => {
    expect(toFilesystemSafeId('abc-123')).toBe('abc-123');
  });

  it('should encode unsafe characters', () => {
    expect(toFilesystemSafeId('a:b')).toBe('a~3a~b');
    expect(toFilesystemSafeId('a/b')).toBe('a~2f~b');
  });

  it('should handle colons in session IDs', () => {
    const id = 'session:2024:test';
    const safe = toFilesystemSafeId(id);
    expect(safe).not.toContain(':');
  });
});

describe('getTranscriptPath', () => {
  it('should return path under ~/.codara/projects/', () => {
    const p = getTranscriptPath({
      projectRoot: '/home/user/my-project',
      userHome: '/home/user',
      sessionId: 'sess-123',
    });
    expect(p).toContain('.codara/projects');
    expect(p).toContain('my-project');
    expect(p).toEndWith('.jsonl');
  });
});
