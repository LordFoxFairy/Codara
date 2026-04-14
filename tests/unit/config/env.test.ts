import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {parseEnvSettings} from '@config/env';

describe('parseEnvSettings', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CODARA_')) {
        savedEnv[key] = process.env[key];
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CODARA_')) delete process.env[key];
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) process.env[key] = val;
    }
  });

  it('should return empty settings when no CODARA_ vars', () => {
    expect(parseEnvSettings()).toEqual({});
  });

  it('should parse CODARA_MODEL', () => {
    process.env.CODARA_MODEL = 'sonnet';
    expect(parseEnvSettings()).toEqual({model: 'sonnet'});
  });

  it('should parse CODARA_MAX_TURNS as number', () => {
    process.env.CODARA_MAX_TURNS = '100';
    expect(parseEnvSettings()).toEqual({maxTurns: 100});
  });

  it('should parse CODARA_THEME', () => {
    process.env.CODARA_THEME = 'dark';
    expect(parseEnvSettings()).toEqual({theme: 'dark'});
  });

  it('should parse CODARA_PERMISSION_MODE', () => {
    process.env.CODARA_PERMISSION_MODE = 'plan';
    expect(parseEnvSettings()).toEqual({permissions: {defaultMode: 'plan'}});
  });

  it('should ignore unknown CODARA_ vars', () => {
    process.env.CODARA_UNKNOWN_SETTING = 'value';
    expect(parseEnvSettings()).toEqual({});
  });
});
