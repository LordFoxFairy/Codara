import {readFile} from 'node:fs/promises';
import path from 'node:path';

/**
 * CODARA.md loader for the config layer.
 *
 * This module loads CODARA.md instruction files from known locations
 * (user home, project root, local override) and resolves `@`-prefixed
 * include directives.
 *
 * Relationship with `context/instructions.ts`:
 *   - This module: simple one-shot loader used by `init-context.ts` to inject
 *     CODARA.md content into dynamic sections. Frontmatter-aware, flat result.
 *   - `context/instructions.ts`: progressive instruction system with lazy
 *     per-directory resolution during the agent loop. Session-scoped caching.
 *   Both resolve `@`-includes independently — this is intentional because
 *   they operate at different lifecycle stages (init vs. runtime).
 */

export interface CodaraMdInstruction {
  source: 'user' | 'project' | 'local';
  filePath: string;
  content: string;
  frontmatter?: Record<string, unknown>;
}

export interface CodaraMdResult {
  instructions: CodaraMdInstruction[];
}

export interface CodaraMdOptions {
  projectRoot: string;
  userHome: string;
}

export async function loadCodaraMd(options: CodaraMdOptions): Promise<CodaraMdResult> {
  const candidates: Array<{path: string; source: CodaraMdInstruction['source']}> = [
    {path: path.join(options.userHome, '.codara', 'CODARA.md'), source: 'user'},
    {path: path.join(options.projectRoot, '.codara', 'CODARA.md'), source: 'project'},
    {path: path.join(options.projectRoot, 'CODARA.md'), source: 'project'},
    {path: path.join(options.projectRoot, 'CODARA.local.md'), source: 'local'},
  ];

  const instructions: CodaraMdInstruction[] = [];

  for (const candidate of candidates) {
    const raw = await tryReadFile(candidate.path);
    if (raw === undefined) continue;

    const {frontmatter, body} = parseFrontmatter(raw);
    const resolvedBody = await resolveIncludes(body, path.dirname(candidate.path), new Set());
    instructions.push({
      source: candidate.source,
      filePath: candidate.path,
      content: resolvedBody.trim(),
      ...(frontmatter ? {frontmatter} : {}),
    });
  }

  return {instructions};
}

async function resolveIncludes(body: string, baseDir: string, visited: Set<string>): Promise<string> {
  const lines = body.split('\n');
  const resolved: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('@') && !trimmed.startsWith('@{')) {
      const includePath = trimmed.slice(1).trim();
      const fullPath = path.isAbsolute(includePath)
        ? includePath
        : path.resolve(baseDir, includePath);

      if (visited.has(fullPath)) continue;

      const content = await tryReadFile(fullPath);
      if (content !== undefined) {
        visited.add(fullPath);
        const nested = await resolveIncludes(content, path.dirname(fullPath), visited);
        resolved.push(nested);
      }
    } else {
      resolved.push(line);
    }
  }

  return resolved.join('\n');
}

function parseFrontmatter(raw: string): {frontmatter?: Record<string, unknown>; body: string} {
  if (!raw.startsWith('---')) return {body: raw};

  const endIndex = raw.indexOf('\n---', 3);
  if (endIndex === -1) return {body: raw};

  const frontmatterRaw = raw.slice(4, endIndex).trim();
  const body = raw.slice(endIndex + 4);

  try {
    const frontmatter: Record<string, unknown> = {};
    for (const line of frontmatterRaw.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      if (key) frontmatter[key] = value;
    }
    return {frontmatter, body};
  } catch {
    return {body: raw};
  }
}

async function tryReadFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}
