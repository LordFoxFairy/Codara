#!/bin/bash
# Install audit-logger configuration

CONFIG_FILE=".codara/settings.json"
LOG_FILE=".codara/audit.log"

echo "Installing audit logger..."
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

# Add PostToolUse hook for audit logging
echo "✓ Adding PostToolUse hook..."
jq '.hooks = (.hooks // []) + [
  {
    "matcher": {"event": "PostToolUse"},
    "hooks": [{
      "command": "jq -c '\''{time: now, tool: .tool, input: .input, sessionId: .sessionId}'\'' >> .codara/audit.log"
    }]
  }
]' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"

# Create audit log file if it doesn't exist
if [ ! -f "$LOG_FILE" ]; then
  touch "$LOG_FILE"
  echo "✓ Created $LOG_FILE"
fi

# Add to .gitignore
if [ -f .gitignore ]; then
  if ! grep -q "^.codara/audit.log$" .gitignore; then
    echo ".codara/audit.log" >> .gitignore
    echo "✓ Added audit.log to .gitignore"
  fi
else
  echo ".codara/audit.log" > .gitignore
  echo "✓ Created .gitignore with audit.log"
fi

echo ""
echo "✅ Audit logging installed successfully!"
echo ""
echo "Logs will be written to: $LOG_FILE"
echo ""
echo "View logs:"
echo "  tail -f .codara/audit.log"
echo "  jq . .codara/audit.log"
echo ""
echo "Configuration saved to: $CONFIG_FILE"
echo "Backup saved to: $CONFIG_FILE.backup"
