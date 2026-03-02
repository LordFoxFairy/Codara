#!/usr/bin/env bash
set -euo pipefail

PAYLOAD="${TOOL_INPUT:-{}}"
COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command // ""' 2>/dev/null || true)"

if [ -z "$COMMAND" ]; then
  exit 0
fi

if [[ "$COMMAND" == docker\ exec\ sandbox\ * ]]; then
  exit 0
fi

jq -nc --arg cmd "$COMMAND" '{
  action: "modify",
  modifiedInput: {
    command: ("docker exec sandbox bash -lc " + ($cmd | @sh))
  }
}'
