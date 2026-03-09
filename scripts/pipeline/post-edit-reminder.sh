#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for jq
if ! command -v jq &>/dev/null; then
  echo "{}"
  exit 0
fi

# Read stdin (hook JSON) but we primarily use the file_path argument
cat >/dev/null 2>&1 || true

FILE_PATH="${1:-}"

# If no file path provided, output empty JSON
if [[ -z "$FILE_PATH" ]]; then
  echo "{}"
  exit 0
fi

# Check if this is a code file
IS_CODE=false
case "$FILE_PATH" in
  *.ts|*.tsx|*.js|*.jsx|*.py|*.rs|*.go|*.java|*.css|*.scss|*.vue|*.svelte|*.html)
    IS_CODE=true
    ;;
esac

# If not a code file, don't show reminder
if [[ "$IS_CODE" != "true" ]]; then
  echo "{}"
  exit 0
fi

# Track the file change
"$SCRIPT_DIR/track-file-change.sh" "$FILE_PATH" >/dev/null 2>&1 || true

# Detect repo and branch for checkpoint lookup
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown')"
REPO_SLUG="$(basename "$REPO_ROOT")"
BRANCH_RAW="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
BRANCH_SAFE="${BRANCH_RAW//\//-}"

CHECKPOINT_FILE="/tmp/pipeline-state-${REPO_SLUG}-${BRANCH_SAFE}.json"

# Check if frontend changes detected
HAS_FRONTEND=false
if [[ -f "$CHECKPOINT_FILE" ]]; then
  HAS_FRONTEND=$(jq -r '.has_frontend_changes' "$CHECKPOINT_FILE" 2>/dev/null || echo "false")
fi

# Check if this specific file is a frontend file
IS_FRONTEND=false
case "$FILE_PATH" in
  *.tsx|*.jsx|*.css|*.scss|*.vue|*.svelte|*.module.css)
    IS_FRONTEND=true
    ;;
esac
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

# Build the reminder message
GATES="- Anti-slop gate (codex-anti-slop agent)"
if [[ "$IS_FRONTEND" == "true" ]] || [[ "$HAS_FRONTEND" == "true" ]]; then
  GATES="${GATES}\n- UI validation gate (codex-ui-validator agent) [frontend file detected]"
fi
GATES="${GATES}\n- Devil's advocate (codex-devils-advocate agent)"
GATES="${GATES}\n- Gap analysis (codex-gap-analyst agent)"

# Use printf to handle the newlines properly, then pass to jq
MESSAGE="You modified ${FILE_PATH}. Pipeline gates REQUIRED before commit:\n${GATES}\n\nRun these gates before attempting git commit."

# Output the JSON with additionalContext
printf '%s' "$MESSAGE" | jq -Rs '{additionalContext: .}'
