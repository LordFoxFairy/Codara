import type { JobArtifact } from '@capability/team/types';

export interface ArtifactValidationResult {
  valid: boolean;
  reason?: string;
  warnings?: string[];
}

export interface ArtifactSecurityConfig {
  maxArtifactSize: number; // bytes, default 1MB
}

export const DEFAULT_ARTIFACT_SECURITY: ArtifactSecurityConfig = {
  maxArtifactSize: 1_000_000,
};

const SUSPICIOUS_PATTERNS = [
  { pattern: /eval\s*\(/, reason: 'eval() usage' },
  { pattern: /process\.env/, reason: 'environment variable access' },
  { pattern: /child_process/, reason: 'process spawning' },
  { pattern: /fs\.(unlink|rmdir|rm)/, reason: 'file deletion' },
];

/** Validate a remote artifact for safety */
export function validateRemoteArtifact(
  artifact: JobArtifact,
  config: ArtifactSecurityConfig = DEFAULT_ARTIFACT_SECURITY,
): ArtifactValidationResult {
  // 1. Size check
  if (artifact.content.length > config.maxArtifactSize) {
    return { valid: false, reason: 'Artifact exceeds size limit' };
  }

  // 2. Path traversal check (for file artifacts)
  if (artifact.path) {
    if (artifact.path.includes('..') || artifact.path.startsWith('/')) {
      return { valid: false, reason: 'Path traversal detected' };
    }
  }

  // 3. Suspicious pattern check (warning only, not blocking)
  const warnings: string[] = [];
  if (artifact.type === 'diff' || artifact.type === 'file') {
    for (const { pattern, reason } of SUSPICIOUS_PATTERNS) {
      if (pattern.test(artifact.content)) {
        warnings.push(`Suspicious pattern: ${reason}. Leader should review carefully.`);
      }
    }
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}
