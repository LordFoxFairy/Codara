#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <skill-name>" >&2
  exit 1
fi

SKILL_NAME="$1"

if ! printf '%s' "$SKILL_NAME" | rg -q '^[a-z0-9][a-z0-9-]*$'; then
  echo "Skill name must match [a-z0-9-]+" >&2
  exit 1
fi

SKILL_DIR=".codara/skills/${SKILL_NAME}"

if [ -e "$SKILL_DIR" ]; then
  echo "Skill already exists: $SKILL_DIR" >&2
  exit 1
fi

mkdir -p "$SKILL_DIR/scripts"

cat > "$SKILL_DIR/SKILL.md" <<TEMPLATE
---
name: ${SKILL_NAME}
description: Describe what this hook skill does and when to use it.
user-invocable: true
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash \${CODARA_SKILL_ROOT}/scripts/main.sh"
---

# ${SKILL_NAME}

Describe behavior, scope, and safety constraints.
TEMPLATE

cat > "$SKILL_DIR/scripts/main.sh" <<'TEMPLATE'
#!/usr/bin/env bash
set -euo pipefail

PAYLOAD="${TOOL_INPUT:-{}}"
COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command // ""' 2>/dev/null || true)"

# Implement policy logic here.
# Exit 2 to deny, exit 0 to allow.

if [ -z "$COMMAND" ]; then
  exit 0
fi

exit 0
TEMPLATE

chmod +x "$SKILL_DIR/scripts/main.sh"

echo "Created hook skill scaffold: $SKILL_DIR"
