---
name: hooks
description: Configure Codara lifecycle hooks for enforcement, rewriting, and auditing. Use when users ask to block risky tool calls, transform tool input before execution, add post-run audit logging, or scaffold hook-based policies.
user-invocable: true
---

# Hooks Toolkit

Use this skill to design deterministic policy at tool lifecycle boundaries.

## Why This Exists

- Prevent unsafe operations before execution (`PreToolUse`).
- Rewrite tool input for isolation workflows (sandbox routing).
- Capture audit trails on success or failure (`PostToolUse`, `PostToolUseFailure`).
- Scaffold reusable hook-centric skills.

Use `permissions` for allow/deny/ask authorization policy.
Use `hooks` when logic must run every time at a lifecycle event.

## Current Configuration

!`bash ${CODARA_SKILL_ROOT}/scripts/show-config.sh`

## Workflow

1. Classify intent: `block`, `rewrite`, `audit`, or `scaffold`.
2. Select event:
   - `PreToolUse`: block or rewrite before the tool runs.
   - `PostToolUse`: log successful executions.
   - `PostToolUseFailure`: log and analyze failures.
   - `SessionStart` / `SessionStop`: session-level notifications.
3. Start from a template, then tune script logic.
4. Apply to `settings.local.json` first; promote to `settings.json` after validation.
5. Verify behavior with representative tool calls.

## Quick Apply Templates

Preview a template:

```bash
cat ${CODARA_SKILL_ROOT}/templates/security-check.json
```

Apply templates safely (append hook arrays by event, merge permissions):

```bash
bash ${CODARA_SKILL_ROOT}/scripts/apply-template.sh security-check settings.local.json
bash ${CODARA_SKILL_ROOT}/scripts/apply-template.sh audit-logger settings.local.json
bash ${CODARA_SKILL_ROOT}/scripts/apply-template.sh sandbox-redirect settings.local.json
```

If target file is omitted, `settings.local.json` is used.

## Build Custom Hooks

Use the canonical schema:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash /absolute/path/to/your-script.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Tool executed: $TOOL_NAME' >> /tmp/log.txt"
          }
        ]
      }
    ]
  }
}
```

Exit behavior:
- `exit 0`: allow. In `PreToolUse`, stdout can return JSON `modify` or `deny`.
- `exit 2`: deny immediately (`PreToolUse`).
- Any other non-zero: continue but record hook error.

## Scaffold New Hook-Based Skills

Create reusable hook-based skills:

```bash
bash ${CODARA_SKILL_ROOT}/scripts/init-hook-skill.sh my-custom-skill
```

## Bundled Scripts

| Script | Typical Event | Purpose |
|---|---|---|
| `scripts/block-dangerous-command.sh` | `PreToolUse` | Deny dangerous shell patterns (exit `2`). |
| `scripts/log-tool-call.sh` | `PostToolUse` | Append structured JSONL audit logs to `.codara/audit.log`. |
| `scripts/redirect-to-sandbox.sh` | `PreToolUse` | Rewrite Bash commands to run in `docker exec sandbox ...`. |
| `scripts/init-hook-skill.sh` | manual utility | Scaffold a new hook-based skill. |
| `scripts/apply-template.sh` | manual utility | Merge template JSON into settings safely. |

## Validation Checklist

- `jq empty ${CODARA_SKILL_ROOT}/templates/*.json`
- `bash -n ${CODARA_SKILL_ROOT}/scripts/*.sh`
- Trigger one known-safe and one known-blocked command.
- For audit setups, verify `.codara/audit.log` contains valid JSONL.

## References

- `references/example-index.md`
- `references/example-block-dangerous.md`
- `references/example-audit-tools.md`
- `references/example-sandbox.md`
- `docs/04-hooks.md`
- `docs/appendix/permissions.md`
