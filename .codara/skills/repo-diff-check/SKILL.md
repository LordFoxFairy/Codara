---
name: repo-diff-check
description: Use this skill to inspect git working tree changes, summarize impact, and provide a safe verification checklist before submission.
license: MIT
compatibility: codara-agent-runtime
author: codara-team
metadata:
  category: engineering
  level: standard
allowed-tools:
  - read_file
  - bash
---
# Repo Diff Check Skill

## When to use
- User asks for change review or verification before commit.
- You need a structured way to inspect working tree impact.

## Workflow
1. Inspect file-level changes and classify risk.
2. Focus on behavior regressions and missing validation.
3. Run targeted checks before final conclusion.
4. Report findings first, then concise summary.

## Script usage
- Use `scripts/check_diff.sh` to get a compact git status + stats snapshot.

## References
- Read `references/guide.md` for review checklist.
