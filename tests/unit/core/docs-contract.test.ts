import {describe, expect, it} from 'bun:test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const repoRoot = process.cwd();

describe('core docs contracts', () => {
  it('should keep the root README focused on top-level docs entry points', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('Core Docs');
    expect(readme).toContain('CLI Docs');
    expect(readme).toContain('Tasks Docs');
    expect(readme).toContain('bun install');
    expect(readme).toContain('bun run dev');
    expect(readme).not.toContain('Plugin Compatibility');
  });

  it('should keep the documented tasking and architecture references pointed at real files', async () => {
    const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8');
    const coreReadme = await readFile(path.join(repoRoot, 'src/core/README.md'), 'utf8');

    expect(readme).toContain('src/core/tasks');
    expect(readme).not.toContain('src/core/tasking');
    expect(coreReadme).toContain('src/core/tasks/README.md');
    expect(coreReadme).not.toContain('docs/subagent-task-architecture.md');
  });
});
