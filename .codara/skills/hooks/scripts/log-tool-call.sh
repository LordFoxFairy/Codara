#!/usr/bin/env bash
set -euo pipefail

# Audit logger - logs all tool calls to .codara/audit.log

LOG_DIR=".codara"
LOG_FILE="$LOG_DIR/audit.log"

mkdir -p "$LOG_DIR"

TIMESTAMP=$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)
TOOL_NAME=${TOOL_NAME:-"unknown"}
TOOL_INPUT=${TOOL_INPUT:-"{}"}

# Log in JSONL format
echo "{\"time\":\"$TIMESTAMP\",\"tool\":\"$TOOL_NAME\",\"input\":$TOOL_INPUT}" >> "$LOG_FILE"

exit 0
