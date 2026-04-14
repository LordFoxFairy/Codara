import {describe, expect, it} from 'bun:test';
import {mergeSettings} from '@config/merge';
import type {CodaraSettings} from '@config/schema';

describe('mergeSettings', () => {
  it('should return base when overlay is empty', () => {
    const base: CodaraSettings = {model: 'opus', maxTurns: 25};
    expect(mergeSettings(base, {})).toEqual(base);
  });

  it('should overlay scalar values', () => {
    const base: CodaraSettings = {model: 'opus', maxTurns: 25};
    const overlay: CodaraSettings = {model: 'sonnet'};
    expect(mergeSettings(base, overlay)).toEqual({model: 'sonnet', maxTurns: 25});
  });

  it('should deep merge nested objects', () => {
    const base: CodaraSettings = {permissions: {defaultMode: 'default', alwaysAllow: ['Read']}};
    const overlay: CodaraSettings = {permissions: {alwaysDeny: ['Bash(rm:*)']}};
    const result = mergeSettings(base, overlay);
    expect(result.permissions?.defaultMode).toBe('default');
    expect(result.permissions?.alwaysAllow).toEqual(['Read']);
    expect(result.permissions?.alwaysDeny).toEqual(['Bash(rm:*)']);
  });

  it('should replace arrays (not concat)', () => {
    const base: CodaraSettings = {permissions: {alwaysAllow: ['Read', 'Glob']}};
    const overlay: CodaraSettings = {permissions: {alwaysAllow: ['Read']}};
    const result = mergeSettings(base, overlay);
    expect(result.permissions?.alwaysAllow).toEqual(['Read']);
  });

  it('should merge multiple layers in order', () => {
    const layers: CodaraSettings[] = [{model: 'opus', maxTurns: 25}, {maxTurns: 50}, {model: 'sonnet'}];
    const result = layers.reduce(mergeSettings, {} as CodaraSettings);
    expect(result).toEqual({model: 'sonnet', maxTurns: 50});
  });

  it('should deep merge mcpServers', () => {
    const base: CodaraSettings = {mcpServers: {fs: {command: 'npx', args: ['server']}}};
    const overlay: CodaraSettings = {mcpServers: {db: {command: 'node', args: ['db-server']}}};
    const result = mergeSettings(base, overlay);
    expect(result.mcpServers?.fs).toBeDefined();
    expect(result.mcpServers?.db).toBeDefined();
  });
});
