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
  // Normalize: strip leading ./ so globs match consistently
  const normalized = filePath.replace(/^\.\//, '');
  return rules.filter(rule =>
    rule.globs.some(glob => minimatchLite(normalized, glob))
  );
}

function parseFrontmatter(raw: string): {globs: string[]; content: string} {
  const match = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---(?:[ \t]*\r?\n|$)([\s\S]*)/);
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

/** Compiled regex cache — avoids re-compiling on every path check. */
const regexCache = new Map<string, RegExp | null>();

function minimatchLite(filePath: string, pattern: string): boolean {
  // Reject overly complex patterns to avoid ReDoS
  if (pattern.length > 200) return false;

  let cached = regexCache.get(pattern);
  if (cached === undefined) {
    cached = compileGlob(pattern);
    regexCache.set(pattern, cached);
  }
  if (cached === null) return false;

  return cached.test(filePath);
}

/**
 * Compile a glob pattern to a RegExp. Returns null on invalid patterns.
 *
 * Supported syntax: `*`, `**`, `?`, `[abc]`, `[!abc]`, `[a-z]`.
 * - `*`  matches any characters except `/`
 * - `**` matches zero or more path segments (including empty — so `** /x` matches `x`)
 * - `?`  matches a single non-`/` character
 * - `[…]` character classes are passed through to the regex
 */
function compileGlob(pattern: string): RegExp | null {
  // Normalize: strip leading ./
  const pat = pattern.replace(/^\.\//, '');

  let regex = '';
  let i = 0;

  while (i < pat.length) {
    const ch = pat[i]!;

    if (ch === '*') {
      if (pat[i + 1] === '*') {
        // ** (doublestar)
        // Consume any trailing slash: `**/`
        const hasSlash = pat[i + 2] === '/';
        // `**` matches zero or more path segments
        // `**/foo`  → `(.*\/)?foo`  (zero or more segments ending with /)
        // `foo/**`  → `foo\/(.*)`
        // `foo/**/bar` → `foo\/(.*\/)?bar`
        if (hasSlash) {
          regex += '(?:.+/)?'; // zero or more segments (greedy), must end with /
          i += 3;
        } else {
          regex += '.*'; // trailing **, match everything remaining
          i += 2;
        }
      } else {
        // single *
        regex += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      regex += '[^/]';
      i += 1;
    } else if (ch === '[') {
      // Character class — find the closing `]`
      const close = pat.indexOf(']', i + 1);
      if (close === -1) {
        // Malformed — treat `[` as literal
        regex += '\\[';
        i += 1;
      } else {
        // Pass through, but convert leading `!` to `^` for negation
        let inner = pat.slice(i + 1, close);
        if (inner.startsWith('!')) {
          inner = '^' + inner.slice(1);
        }
        regex += '[' + inner + ']';
        i = close + 1;
      }
    } else if ('.+^${}()|\\'.includes(ch)) {
      // Escape regex metacharacters
      regex += '\\' + ch;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }

  try {
    return new RegExp(`^${regex}$`);
  } catch {
    return null;
  }
}
