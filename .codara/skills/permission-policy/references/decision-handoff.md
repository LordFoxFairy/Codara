# Decision Handoff Protocol

## Why this exists
Permission evaluation and interaction transport are separate responsibilities.

- Permission layer: computes `allow | ask | deny`.
- Interaction layer: handles user confirmation mechanics.

This keeps the policy reusable across CLI, GUI, HIL middleware, and remote approval services.

## Normalized decision payload
Minimum payload fields:
- `input`: tool expression
- `decision`: `allow | ask | deny`
- `matched`: matched rule info or `null`
- `sources`: loaded source files

## Runtime contract
1. Permission layer returns normalized decision.
2. If `allow`: execute the tool call.
3. If `deny`: stop and surface reason.
4. If `ask`: forward payload to interaction layer and wait for resume.
5. Resume result determines continue/block/edit behavior.

## Interaction examples
- HIL middleware pause/resume
- Terminal prompt (`y/n/edit`)
- Web approval center with tabs/panels
- Team policy webhook returning signed decision

No interaction-specific schema should be hardcoded in permission evaluator.
