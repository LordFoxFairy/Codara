#!/usr/bin/env bash
set -euo pipefail

# Audit logger - logs all tool calls to .codara/audit.log

LOG_DIR=".codara"
LOG_FILE="$LOG_DIR/audit.log"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)
TOOL_NAME=${TOOL_NAME:-"unknown"}
HOOK_EVENT=${HOOK_EVENT:-"unknown"}
RAW_INPUT=${TOOL_INPUT:-"{}"}

INPUT_JSON="$(printf '%s' "$RAW_INPUT" | jq -c . 2>/dev/null || printf '%s' "$RAW_INPUT" | jq -R .)"

# Log in JSONL format
jq -nc \
  --arg time "$TIMESTAMP" \
  --arg event "$HOOK_EVENT" \
  --arg tool "$TOOL_NAME" \
  --argjson input "$INPUT_JSON" \
  '{time: $time, event: $event, tool: $tool, input: $input}' >> "$LOG_FILE"

exit 0
