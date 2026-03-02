#!/usr/bin/env bash
set -euo pipefail

PAYLOAD="${TOOL_INPUT:-{}}"
COMMAND="$(printf '%s' "$PAYLOAD" | jq -r '.command // ""' 2>/dev/null || true)"

if [ -z "$COMMAND" ]; then
  exit 0
fi

case "$COMMAND" in
  rm\ -rf*)
    echo "BLOCKED: rm -rf is dangerous" >&2
    exit 2
    ;;
  sudo*)
    echo "BLOCKED: sudo requires manual approval" >&2
    exit 2
    ;;
  chmod\ 777*|chmod\ -R\ 777*)
    echo "BLOCKED: insecure chmod pattern" >&2
    exit 2
    ;;
  dd\ if=*)
    echo "BLOCKED: dd disk operations are restricted" >&2
    exit 2
    ;;
  mkfs*)
    echo "BLOCKED: mkfs is destructive" >&2
    exit 2
    ;;
  *production*)
    echo "BLOCKED: production commands require manual review" >&2
    exit 2
    ;;
esac

exit 0
