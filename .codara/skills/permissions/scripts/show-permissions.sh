#!/usr/bin/env bash
set -euo pipefail

echo "=== Current Permissions Configuration ==="
echo ""

if [ -f settings.json ]; then
  echo "📄 settings.json (team shared):"
  jq '.permissions // "No permissions configured"' settings.json 2>/dev/null || echo "  (invalid JSON)"
else
  echo "📄 settings.json: Not found"
fi

echo ""

if [ -f settings.local.json ]; then
  echo "📄 settings.local.json (local override):"
  jq '.permissions // "No permissions configured"' settings.local.json 2>/dev/null || echo "  (invalid JSON)"
else
  echo "📄 settings.local.json: Not found"
fi

echo ""
echo "💡 Tip: Use templates in .codara/skills/permissions/templates/ for quick setup"
