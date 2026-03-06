#!/usr/bin/env bash
set -euo pipefail

echo "[repo-diff-check] git status --short"
git status --short

echo
echo "[repo-diff-check] git diff --stat"
git diff --stat
