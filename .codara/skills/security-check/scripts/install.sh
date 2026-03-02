#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="settings.json"
HOOK_COMMAND="bash .codara/skills/security-check/scripts/check-dangerous-command.sh"

echo "Installing security checks..."
echo ""

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
  | .permissions = (.permissions // {})
  | .permissions.deny = ((.permissions.deny // []) + [
      "Bash(rm -rf *)",
      "Bash(sudo *)",
      "Bash(chmod 777*)",
      "Bash(chmod -R 777*)",
      "Bash(dd if=*)",
      "Bash(mkfs*)",
      "Bash(*production*)"
    ] | unique)
  | .hooks = (.hooks // {})
  | .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": $hook_command
          }
        ]
      }
    ])
  | .hooks.PreToolUse |= unique_by(.matcher, (.hooks | tostring))
' "$CONFIG_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$CONFIG_FILE"

echo ""
echo "Security checks installed successfully"
echo ""
echo "Configuration saved to: $CONFIG_FILE"
echo "Backup saved to: $CONFIG_FILE.backup"
