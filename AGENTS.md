# Agent Delivery Skill (Codara)

This file defines a reusable delivery workflow for coding agents in this repo.
Use it for feature work, bug fixes, refactors, and PR review/fix loops.

## 1. Core Execution Rules

1. Plan before code for any non-trivial change (3+ steps or architecture impact).
2. Re-plan immediately when assumptions break or validation fails.
3. Keep changes minimal and focused on root cause.
4. Do not mark work done without executable proof (lint/build/tests/logs).
5. After any correction from user or review, write one new rule in `tasks/lessons.md`.

## 2. Task Orchestration Contract

1. Open `tasks/todo.md` and create:
- Goal
- Checklist (checkable items)
- Acceptance Criteria
2. Execute checklist items one by one and mark status continuously.
3. Add a Review section in `tasks/todo.md` with:
- What changed
- Why
- Verification commands and outcomes

## 3. Implementation Loop

1. Confirm scope and non-goals first.
2. Implement the smallest complete fix/feature.
3. Run verification in this order:
- `bun run lint`
- `bun run build`
- `bun test` (or targeted test files when appropriate)
4. If failure happens, fix immediately and re-run verification.

## 4. PR Publishing Workflow

1. Create branch:
```bash
git checkout -b feat/<topic>
```
2. Commit with clear scope:
```bash
git add <files>
git commit -m "feat(scope): short summary"
```
3. Push branch:
```bash
git push -u origin <branch>
```
4. Create PR (preferred via `gh`):
```bash
gh pr create --title "<type(scope): summary>" --body "<what/why/how tested>"
```

## 5. PR Review Workflow (Pull and Review Locally)

1. Fetch PR branch into local review branch:
```bash
git fetch origin pull/<PR_NUMBER>/head:review/pr-<PR_NUMBER>
git checkout review/pr-<PR_NUMBER>
```
2. Review with code-first checks:
- correctness and regressions
- edge cases and error paths
- test coverage gaps
- API/behavior compatibility
3. Validate with commands used by the PR author.
4. Record findings by severity with file/line references.

## 6. Fix-and-Resubmit Loop

1. Convert review comments into checklist items in `tasks/todo.md`.
2. Fix highest-severity issues first.
3. Re-run lint/build/tests and update review notes.
4. Commit follow-up:
```bash
git add <files>
git commit -m "fix(scope): address PR review comments"
git push
```
5. Repeat until review is green.

## 7. Experience and Lessons Loop

1. Every rejected assumption or repeated mistake becomes a rule in `tasks/lessons.md`.
2. New tasks must scan `tasks/lessons.md` before implementation.
3. Prefer preventing classes of mistakes over one-off patching.

## 8. Definition of Done

All items below must be true:

1. Checklist in `tasks/todo.md` is fully checked.
2. Acceptance criteria are satisfied.
3. Verification commands are recorded with outcomes.
4. PR comments are resolved or explicitly documented with rationale.
5. New lessons (if any) are written in `tasks/lessons.md`.
