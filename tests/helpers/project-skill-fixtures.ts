import {chmod, mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

export interface ProjectSkillFixturePaths {
  skillsRoot: string;
  basicSkillPath: string;
  basicReferencePath: string;
  diffSkillPath: string;
  diffGuidePath: string;
  diffScriptPath: string;
}

export async function seedProjectSkillFixtures(projectRoot: string): Promise<ProjectSkillFixturePaths> {
  const skillsRoot = path.join(projectRoot, '.codara', 'skills');
  const basicSkillPath = path.join(skillsRoot, 'basic-task-flow', 'SKILL.md');
  const basicReferencePath = path.join(skillsRoot, 'basic-task-flow', 'references', 'checklist.md');
  const diffSkillPath = path.join(skillsRoot, 'repo-diff-check', 'SKILL.md');
  const diffGuidePath = path.join(skillsRoot, 'repo-diff-check', 'references', 'guide.md');
  const diffScriptPath = path.join(skillsRoot, 'repo-diff-check', 'scripts', 'check_diff.sh');

  await mkdir(path.dirname(basicReferencePath), {recursive: true});
  await mkdir(path.dirname(diffGuidePath), {recursive: true});
  await mkdir(path.dirname(diffScriptPath), {recursive: true});

  await writeFile(basicSkillPath, `---
name: basic-task-flow
description: Basic task workflow helper
metadata:
  category: general
allowed-tools:
  - read_file
---
# Basic Task Flow

Read the checklist before completing the task.
`, 'utf8');
  await writeFile(basicReferencePath, `# Checklist

- Review the task context
- Read the referenced files
- Summarize the result
`, 'utf8');
  await writeFile(diffSkillPath, `---
name: repo-diff-check
description: Inspect repository diffs before responding
metadata:
  category: engineering
allowed-tools:
  - read_file
  - bash
---
# Repo Diff Check

Use the guide and script before reporting repository changes.
`, 'utf8');
  await writeFile(diffGuidePath, `# Repo Diff Guide

1. Read the diff summary.
2. Inspect the touched files.
3. Explain the user-facing impact.
`, 'utf8');
  await writeFile(diffScriptPath, `#!/usr/bin/env bash
set -euo pipefail
git diff --stat "$@"
`, 'utf8');
  await chmod(diffScriptPath, 0o755);

  return {
    skillsRoot,
    basicSkillPath,
    basicReferencePath,
    diffSkillPath,
    diffGuidePath,
    diffScriptPath,
  };
}
