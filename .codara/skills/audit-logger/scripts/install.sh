#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="settings.json"
LOG_FILE=".codara/audit.log"
HOOK_COMMAND="jq -c '{time: now, tool: .tool, input: .input, sessionId: .sessionId}' >> .codara/audit.log"

echo "Installing audit logger..."
echo ""

mkdir -p .codara

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Creating $CONFIG_FILE..."
  echo '{}' > "$CONFIG_FILE"
fi

cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
echo "Backed up existing config to $CONFIG_FILE.backup"

TMP_FILE="$(mktemp)"

jq --arg hook_command "$HOOK_COMMAND" '
  if (.hooks == null or (.hooks | type) == "object") then .
  else error("hooks must be an object keyed by event names")
  end
  | .hooks = (.hooks // {})
  | .hooks.PostToolUse = ((.hooks.PostToolUse // []) + [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": $hook_command
          }
        ]
      }
    ])
  | .hooks.PostToolUse |= unique_by(.matcher, (.hooks | tostring))
' "$CONFIG_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$CONFIG_FILE"

if [ ! -f "$LOG_FILE" ]; then
  touch "$LOG_FILE"
  echo "Created $LOG_FILE"
fi

if [ -f .gitignore ]; then
  if ! grep -q '^.codara/audit.log$' .gitignore; then
    echo '.codara/audit.log' >> .gitignore
    echo 'Added .codara/audit.log to .gitignore'
  fi
else
  echo '.codara/audit.log' > .gitignore
  echo 'Created .gitignore with .codara/audit.log'
fi

echo ""
echo "Audit logging installed successfully"
echo ""
echo "Configuration saved to: $CONFIG_FILE"
echo "Backup saved to: $CONFIG_FILE.backup"
