import { describe, test, expect } from 'bun:test';
import { validateRemoteArtifact, DEFAULT_ARTIFACT_SECURITY } from '@capability/team/security/artifact-validator';
import type { JobArtifact } from '@capability/team/types';

function makeArtifact(overrides: Partial<JobArtifact> = {}): JobArtifact {
  return {
    type: 'file',
    content: 'const x = 1;',
    ...overrides,
  };
}

describe('validateRemoteArtifact', () => {
  test('accepts valid small artifact', () => {
    const result = validateRemoteArtifact(makeArtifact());
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('rejects oversized artifact', () => {
    const result = validateRemoteArtifact(
      makeArtifact({ content: 'x'.repeat(DEFAULT_ARTIFACT_SECURITY.maxArtifactSize + 1) }),
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Artifact exceeds size limit');
  });

  test('rejects path traversal in artifact path', () => {
    const result = validateRemoteArtifact(makeArtifact({ path: '../../../etc/passwd' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Path traversal detected');
  });

  test('rejects absolute path in artifact', () => {
    const result = validateRemoteArtifact(makeArtifact({ path: '/etc/passwd' }));
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Path traversal detected');
  });

  test('warns on eval() in diff', () => {
    const result = validateRemoteArtifact(makeArtifact({ type: 'diff', content: 'eval (code)' }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('eval()'))).toBe(true);
  });

  test('warns on process.env in file content', () => {
    const result = validateRemoteArtifact(makeArtifact({ type: 'file', content: 'const key = process.env.SECRET' }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.some(w => w.includes('environment variable'))).toBe(true);
  });

  test('multiple warnings collected', () => {
    const result = validateRemoteArtifact(makeArtifact({
      type: 'file',
      content: 'eval (process.env.CMD)',
    }));
    expect(result.valid).toBe(true);
    expect(result.warnings!.length).toBeGreaterThanOrEqual(2);
  });

  test('no warnings on clean code', () => {
    const result = validateRemoteArtifact(makeArtifact({ type: 'file', content: 'const x = 1 + 2;' }));
    expect(result.valid).toBe(true);
    expect(result.warnings).toBeUndefined();
  });
});
