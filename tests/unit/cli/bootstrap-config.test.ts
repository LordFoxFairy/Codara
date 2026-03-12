import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {
  ensureCliCodaraPath,
  hasCodaraConfig,
  resolveHomeCodaraPath,
  resolveRepoCodaraPath,
} from '@/cli/adapters/bootstrap-config';

describe('cli bootstrap config', () => {
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalCodaraPath: string | undefined;
  let tempRoot: string;

  beforeEach(() => {
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalCodaraPath = process.env.CODARA_PATH;
    tempRoot = mkdtempSync(join(tmpdir(), 'codara-cli-bootstrap-'));
    process.env.HOME = join(tempRoot, 'home');
    process.env.USERPROFILE = join(tempRoot, 'profile');
    delete process.env.CODARA_PATH;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    process.env.CODARA_PATH = originalCodaraPath;
    rmSync(tempRoot, {recursive: true, force: true});
  });

  it('should keep existing CODARA_PATH untouched', () => {
    process.env.CODARA_PATH = 'D:/custom/.codara';
    expect(ensureCliCodaraPath(join(tempRoot, 'repo'))).toBe('D:/custom/.codara');
    expect(process.env.CODARA_PATH).toBe('D:/custom/.codara');
  });

  it('should prefer home config when it exists', () => {
    const homeCodara = resolveHomeCodaraPath();
    mkdirSync(homeCodara, {recursive: true});
    writeFileSync(join(homeCodara, 'config.json'), '{}');

    const repoCodara = resolveRepoCodaraPath(join(tempRoot, 'repo'));
    mkdirSync(repoCodara, {recursive: true});
    writeFileSync(join(repoCodara, 'config.json'), '{}');

    expect(ensureCliCodaraPath(join(tempRoot, 'repo'))).toBeUndefined();
    expect(process.env.CODARA_PATH).toBeUndefined();
  });

  it('should fallback to repo .codara when home config is missing', () => {
    const repoRoot = join(tempRoot, 'repo');
    const repoCodara = resolveRepoCodaraPath(repoRoot);
    mkdirSync(repoCodara, {recursive: true});
    writeFileSync(join(repoCodara, 'config.json'), '{}');

    expect(hasCodaraConfig(repoCodara)).toBe(true);
    expect(ensureCliCodaraPath(repoRoot)).toBe(repoCodara);
    expect(process.env.CODARA_PATH).toBe(repoCodara);
  });

  it('should do nothing when neither home nor repo config exists', () => {
    expect(ensureCliCodaraPath(join(tempRoot, 'repo'))).toBeUndefined();
    expect(process.env.CODARA_PATH).toBeUndefined();
  });
});
