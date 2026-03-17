import {readdirSync, readFileSync, existsSync} from 'node:fs';
import {join, basename} from 'node:path';

export interface ConditionalRule {
  name: string;
  globs: string[];
  content: string;
}

export function loadConditionalRules(projectRoot: string): ConditionalRule[] {
  const rulesDir = join(projectRoot, '.codara', 'rules');
  if (!existsSync(rulesDir)) return [];

  const files = readdirSync(rulesDir).filter(f => f.endsWith('.md'));
  const rules: ConditionalRule[] = [];

  for (const file of files) {
    const raw = readFileSync(join(rulesDir, file), 'utf-8');
    const parsed = parseFrontmatter(raw);
    if (parsed.globs && parsed.globs.length > 0) {
      rules.push({
        name: basename(file, '.md'),
        globs: parsed.globs,
        content: parsed.content,
      });
    }
  }

  return rules;
}

export function matchRulesForPath(
  rules: ConditionalRule[],
  filePath: string,
): ConditionalRule[] {
  return rules.filter(rule =>
    rule.globs.some(glob => minimatchLite(filePath, glob))
  );
}

function parseFrontmatter(raw: string): {globs: string[]; content: string} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
  if (!match) return {globs: [], content: raw};

  const frontmatter = match[1]!;
  const content = match[2]!.trim();

  const globsMatch = frontmatter.match(/globs:\s*\[(.*?)\]/);
  if (!globsMatch) return {globs: [], content};

  const globs = globsMatch[1]!
    .split(',')
    .map(g => g.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);

  return {globs, content};
}

function minimatchLite(filePath: string, pattern: string): boolean {
  // Reject overly complex patterns to avoid ReDoS
  if (pattern.length > 200) return false;

  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex meta chars (except * and ?)
    .replace(/\\\.\\\.\\/g, '\\.\\.\\/')    // un-escape literal ../
    .replace(/\*\*/g, '<<DOUBLESTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/<<DOUBLESTAR>>/g, '(?:[^/]+/)*[^/]*');  // non-backtracking doublestar
  try {
    return new RegExp(`^${regex}$`).test(filePath);
  } catch {
    return false;
  }
}
