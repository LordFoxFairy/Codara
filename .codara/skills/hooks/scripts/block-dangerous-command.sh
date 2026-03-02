#!/usr/bin/env bash
set -euo pipefail

PAYLOAD="${TOOL_INPUT:-{}}"
COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command // ""' 2>/dev/null || true)"

if [ -z "$COMMAND" ]; then
  exit 0
fi

case "$COMMAND" in
  rm\ -rf*|sudo*|chmod\ 777*|chmod\ -R\ 777*|dd\ if=*|mkfs*|*production*)
    echo "Blocked by hooks policy: $COMMAND" >&2
    exit 2
    ;;
esac

exit 0
