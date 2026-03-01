#!/bin/bash
# Install security-check configuration

CONFIG_FILE=".codara/settings.json"

echo "Installing security checks..."
echo ""

# Create .codara directory if it doesn't exist
mkdir -p .codara

# Check if settings.json exists
if [ ! -f "$CONFIG_FILE" ]; then
  echo "Creating $CONFIG_FILE..."
  echo '{}' > "$CONFIG_FILE"
fi

# Backup existing config
cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
echo "✓ Backed up existing config to $CONFIG_FILE.backup"

# Add permissions deny rules
echo "✓ Adding permissions deny rules..."
jq '.permissions.deny = (.permissions.deny // []) + [
  "Bash(rm -rf*:*)",
  "Bash(sudo*:*)",
  "Bash(chmod 777*:*)",
  "Bash(dd if=*:*)",
  "Bash(mkfs*:*)",
  "Bash(*production*:*)"
] | .permissions.deny |= unique' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

# Add hooks
echo "✓ Adding PreToolUse hooks..."
jq '.hooks = (.hooks // []) + [
  {
    "matcher": {"event": "PreToolUse", "tool": "Bash", "pattern": "rm -rf*"},
    "hooks": [{"command": "echo \"BLOCKED: rm -rf is dangerous\" >&2", "exit": 2}]
  },
  {
    "matcher": {"event": "PreToolUse", "tool": "Bash", "pattern": "sudo*"},
    "hooks": [{"command": "echo \"BLOCKED: sudo requires manual approval\" >&2", "exit": 2}]
  },
  {
    "matcher": {"event": "PreToolUse", "tool": "Bash", "pattern": "chmod 777*"},
    "hooks": [{"command": "echo \"BLOCKED: chmod 777 is insecure\" >&2", "exit": 2}]
  },
  {
    "matcher": {"event": "PreToolUse", "tool": "Bash", "pattern": "*production*"},
    "hooks": [{"command": "echo \"BLOCKED: production commands require manual review\" >&2", "exit": 2}]
  }
]' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

echo ""
echo "✅ Security checks installed successfully!"
echo ""
echo "Protected against:"
echo "  - rm -rf (recursive delete)"
echo "  - sudo (superuser commands)"
echo "  - chmod 777 (insecure permissions)"
echo "  - dd if= (disk operations)"
echo "  - mkfs (filesystem formatting)"
echo "  - *production* (production commands)"
echo ""
echo "Configuration saved to: $CONFIG_FILE"
echo "Backup saved to: $CONFIG_FILE.backup"
