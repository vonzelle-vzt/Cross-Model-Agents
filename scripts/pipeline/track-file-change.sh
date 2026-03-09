#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed. Install with: brew install jq" >&2
  exit 1
fi

# Usage check
if [[ $# -lt 1 ]]; then
  echo "Usage: track-file-change.sh <file_path>" >&2
  exit 1
fi

FILE_PATH="$1"

# Detect repo and branch
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown')"
REPO_SLUG="$(basename "$REPO_ROOT")"
BRANCH_RAW="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
BRANCH_SAFE="${BRANCH_RAW//\//-}"

CHECKPOINT_FILE="/tmp/pipeline-state-${REPO_SLUG}-${BRANCH_SAFE}.json"

# Auto-initialize if checkpoint doesn't exist
if [[ ! -f "$CHECKPOINT_FILE" ]]; then
  "$SCRIPT_DIR/pipeline-init.sh"
fi

# Add file to changed_files (deduplicated)
UPDATED=$(jq \
  --arg file "$FILE_PATH" \
  'if (.changed_files | index($file)) then . else .changed_files += [$file] end' \
  "$CHECKPOINT_FILE")

# Check if this is a frontend file
IS_FRONTEND=false

# Check by extension
case "$FILE_PATH" in
  *.tsx|*.jsx|*.css|*.scss|*.vue|*.svelte|*.module.css)
    IS_FRONTEND=true
    ;;
esac

# Check by path pattern
if [[ "$FILE_PATH" == *"/components/"* ]] || \
   [[ "$FILE_PATH" == *"/app/"* ]] || \
   [[ "$FILE_PATH" == *"/pages/"* ]] || \
   [[ "$FILE_PATH" == *"/views/"* ]] || \
   [[ "$FILE_PATH" == *"/layouts/"* ]]; then
  case "$FILE_PATH" in
    *.ts|*.tsx|*.js|*.jsx|*.css|*.scss|*.vue|*.svelte|*.html)
      IS_FRONTEND=true
      ;;
  esac
fi

# Update has_frontend_changes if needed
if [[ "$IS_FRONTEND" == "true" ]]; then
  UPDATED=$(echo "$UPDATED" | jq '.has_frontend_changes = true')
fi

echo "$UPDATED" > "$CHECKPOINT_FILE"
