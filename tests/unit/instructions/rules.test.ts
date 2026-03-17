import {describe, test, expect} from 'bun:test';
import {loadConditionalRules, matchRulesForPath} from '@infra/context/instructions/rules';
import {mkdtempSync, writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

describe('Conditional rules', () => {
  function createTempRulesDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'codara-rules-'));
    const rulesDir = join(dir, '.codara', 'rules');
    mkdirSync(rulesDir, {recursive: true});
    return dir;
  }

  test('loads rules from .codara/rules/*.md', () => {
    const root = createTempRulesDir();
    writeFileSync(
      join(root, '.codara', 'rules', 'typescript.md'),
      '---\nglobs: ["**/*.ts", "**/*.tsx"]\n---\nAlways use strict TypeScript.',
    );
    const rules = loadConditionalRules(root);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.globs).toEqual(['**/*.ts', '**/*.tsx']);
    expect(rules[0]!.content).toContain('strict TypeScript');
  });

  test('matchRulesForPath filters by glob', () => {
    const rules = [
      {globs: ['**/*.ts'], content: 'TS rule', name: 'ts'},
      {globs: ['**/*.py'], content: 'Python rule', name: 'py'},
    ];
    const matched = matchRulesForPath(rules, 'src/foo.ts');
    expect(matched).toHaveLength(1);
    expect(matched[0]!.content).toBe('TS rule');
  });

  test('returns empty when no rules dir', () => {
    const rules = loadConditionalRules('/nonexistent');
    expect(rules).toHaveLength(0);
  });
});
