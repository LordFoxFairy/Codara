---
command-name: code-review
description: Code review a pull request with multi-agent analysis
argument-hint: PR number or URL (optional --comment flag)
user-invocable: true
---

# Code Review Skill

Provide comprehensive code review for a pull request using multi-agent parallel analysis.

## Arguments

- `PR_NUMBER_OR_URL`: Pull request number or full URL
- `--comment`: (Optional) Post review comments to GitHub

## Workflow

### Phase 1: Pre-flight Check

Create a team and launch a quick validation agent to check:
- Is the PR closed or draft?
- Does it need review? (skip automated/trivial PRs)
- Has Claude already reviewed it?

If any condition fails, stop immediately.

### Phase 2: Context Gathering

Launch parallel agents to gather context:
1. **CLAUDE.md Finder**: Find all relevant CLAUDE.md files (root + modified directories)
2. **PR Summarizer**: Read PR and summarize changes

### Phase 3: Parallel Review

Launch 4 independent review agents in parallel:

**Agent 1-2: CLAUDE.md Compliance (Sonnet)**
- Audit changes for CLAUDE.md violations
- Only flag clear, unambiguous rule violations
- Quote exact rules being broken

**Agent 3-4: Bug Detection (Opus)**
- Agent 3: Scan diff for obvious bugs (syntax, type errors, logic errors)
- Agent 4: Look for security issues and incorrect logic in new code

**HIGH SIGNAL ONLY**: Flag issues where:
- Code will fail to compile/parse
- Code will definitely produce wrong results
- Clear CLAUDE.md violations with exact rule quotes

**DO NOT flag**:
- Code style/quality concerns
- Potential issues depending on specific inputs
- Subjective suggestions

### Phase 4: Validation

For each issue found by agents 3-4, launch validation subagents:
- Opus for bugs/logic issues
- Sonnet for CLAUDE.md violations
- Confirm the issue is real with high confidence

### Phase 5: Output

Filter validated issues and output summary:
- If issues found: list each with description
- If no issues: "No issues found. Checked for bugs and CLAUDE.md compliance."

If `--comment` flag provided:
- No issues: post summary comment
- Issues found: post inline comments with `gh pr comment` or GitHub API

## Implementation Notes

**Multi-Agent Orchestration**:
```
1. TeamCreate with team_name="code-review-{pr_number}"
2. TaskCreate for each review phase
3. Agent tool with team_name + subagent_type
4. Collect results via task completion
5. TeamDelete when done
```

**Tools Required**:
- `gh` CLI for GitHub operations
- `Agent` tool for spawning review agents
- `TeamCreate`/`TaskCreate` for orchestration

**False Positives to Avoid**:
- Pre-existing issues
- Bugs that are actually correct
- Pedantic nitpicks
- Linter-catchable issues
- General quality concerns (unless in CLAUDE.md)
- Silenced issues (lint ignore comments)

## Comment Format

When posting to GitHub:

**No issues**:
```
## Code review

No issues found. Checked for bugs and CLAUDE.md compliance.
```

**With issues**:
- One inline comment per unique issue
- Brief description + fix suggestion
- Small fixes (<6 lines): committable suggestion block
- Large fixes: describe without suggestion
- Link to relevant code/CLAUDE.md rules
