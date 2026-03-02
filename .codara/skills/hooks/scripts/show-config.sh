#!/bin/bash
# Show current hooks configuration

echo "## Current Configuration"
echo ""

found=false
for f in settings.json settings.local.json; do
  if [ -f "$f" ]; then
    found=true
    echo "📄 **$f**:"
    echo '```json'
    jq '.hooks // "No hooks configured"' "$f" 2>/dev/null || echo "No hooks"
    echo '```'
    echo ""
  fi
done

if [ "$found" = false ]; then
  echo "No configuration files found."
  echo ""
  echo "To add hooks, create \`settings.json\` with:"
  echo '```json'
  echo '{"hooks": {"PreToolUse": []}}'
  echo '```'
fi
