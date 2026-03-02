#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: $0 <template-name> [target-settings-file]" >&2
  echo "Templates: read-only, safe-development, sandbox-only" >&2
  exit 1
fi

TEMPLATE_NAME="$1"
TARGET_FILE="${2:-settings.local.json}"
SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE_FILE="${SKILL_ROOT}/templates/${TEMPLATE_NAME}.json"

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Unknown template: $TEMPLATE_NAME" >&2
  echo "Available templates: read-only, safe-development, sandbox-only" >&2
  exit 1
fi

if [ ! -f "$TARGET_FILE" ]; then
  printf '{}\n' > "$TARGET_FILE"
fi

jq empty "$TARGET_FILE" >/dev/null
jq empty "$TEMPLATE_FILE" >/dev/null

TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/codara-permissions-merge.XXXXXX")"

# Replace permissions arrays with template values while keeping unrelated top-level keys.
jq -s '
  .[0] as $base
  | .[1] as $tpl
  | $base
  | .permissions = (($base.permissions // {}) * ($tpl.permissions // {}))
' "$TARGET_FILE" "$TEMPLATE_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$TARGET_FILE"

echo "Applied '${TEMPLATE_NAME}' to ${TARGET_FILE}"
echo "Current permissions:"
jq '.permissions // {}' "$TARGET_FILE"
