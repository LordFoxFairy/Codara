# Code Review Execution

You are performing a comprehensive code review using multi-agent analysis.

## Input

- PR: $ARGUMENTS
- Comment flag: Check if `--comment` is in arguments

## Execution Steps

### Step 1: Parse Arguments

Extract PR number/URL and check for `--comment` flag.

### Step 2: Create Review Team

```
Use TeamCreate to create team: "code-review-{pr_number}"
```

### Step 3: Pre-flight Check (Task 1)

Launch haiku agent to validate:
- Check `gh pr view {PR}` for status
- Is PR closed? → Stop
- Is PR draft? → Stop
- Is PR trivial/automated? → Stop
- Has Claude commented? Check `gh pr view {PR} --comments` → Stop

If any condition true, shutdown team and stop.

### Step 4: Context Gathering (Tasks 2-3, Parallel)

**Task 2**: Launch haiku agent to find CLAUDE.md files
- Find root CLAUDE.md
- Find CLAUDE.md in modified directories
- Return list of file paths

**Task 3**: Launch sonnet agent to summarize PR
- Run `gh pr view {PR} --json title,body,files`
- Summarize changes and intent
- Return summary

### Step 5: Parallel Review (Tasks 4-7, Parallel)

Create 4 tasks and launch agents in parallel:

**Task 4**: CLAUDE.md Compliance Agent 1 (Sonnet)
```
Agent prompt:
- Review PR diff for CLAUDE.md violations
- Only flag clear, unambiguous violations
- Quote exact rules
- Return: List of issues with [description, reason, file, line]
```

**Task 5**: CLAUDE.md Compliance Agent 2 (Sonnet)
```
Same as Task 4, independent review
```

**Task 6**: Bug Detection Agent 1 (Opus)
```
Agent prompt:
- Scan diff for obvious bugs
- Focus: syntax errors, type errors, logic errors
- HIGH SIGNAL ONLY
- Return: List of issues with [description, reason, file, line]
```

**Task 7**: Bug Detection Agent 2 (Opus)
```
Agent prompt:
- Look for security issues and incorrect logic
- Only in changed code
- HIGH SIGNAL ONLY
- Return: List of issues with [description, reason, file, line]
```

### Step 6: Collect Issues

Wait for all 4 agents to complete. Merge issue lists.

### Step 7: Validation (Parallel)

For each issue from Tasks 6-7 (bug agents):
- Launch Opus validation agent
- Provide: PR context + issue description
- Task: Confirm issue is real with high confidence
- Return: validated (true/false)

For each issue from Tasks 4-5 (CLAUDE.md agents):
- Launch Sonnet validation agent
- Provide: CLAUDE.md content + issue description
- Task: Confirm rule applies and is violated
- Return: validated (true/false)

### Step 8: Filter Issues

Keep only validated issues.

### Step 9: Output Summary

Print to terminal:
```
## Code Review Summary

[If issues found]
Found {N} issues:
1. [Issue description] - {file}:{line}
2. ...

[If no issues]
No issues found. Checked for bugs and CLAUDE.md compliance.
```

### Step 10: Post Comments (if --comment flag)

**If no issues**:
```bash
gh pr comment {PR} --body "## Code review\n\nNo issues found. Checked for bugs and CLAUDE.md compliance."
```

**If issues found**:
For each issue:
- Determine if fix is small (<6 lines, self-contained)
- If small: create committable suggestion
- If large: describe fix without suggestion
- Post inline comment with `gh pr comment {PR} --body "{comment}"`

**Important**: One comment per unique issue. No duplicates.

### Step 11: Cleanup

```
Use TeamDelete to remove team
```

## Agent Spawning Pattern

```typescript
// Example for Task 4
Agent({
  subagent_type: "general-purpose",
  team_name: "code-review-{pr_number}",
  model: "sonnet",
  prompt: `
    Review this PR diff for CLAUDE.md compliance.

    PR Title: {title}
    PR Description: {description}
    CLAUDE.md files: {claude_md_paths}

    Diff:
    {diff}

    Return ONLY high-signal violations where you can quote the exact rule.
    Format: JSON array of {description, reason, file, line}
  `,
  description: "CLAUDE.md compliance check"
})
```

## False Positive Filters

Do NOT flag:
- Pre-existing issues
- Correct code that looks like bugs
- Pedantic nitpicks
- Linter-catchable issues
- General quality concerns
- Silenced issues (lint ignore comments)

## Notes

- Use `gh` CLI for all GitHub operations
- All agents should receive PR title + description for context
- Validation agents must have high confidence threshold
- Link to code using format: `https://github.com/{owner}/{repo}/blob/{full_sha}/{file}#L{start}-L{end}`
- Get full SHA with `git rev-parse HEAD`
