#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Handle --all flag
if [[ "${1:-}" == "--all" ]]; then
  echo "Clearing all pipeline state files..."
  rm -f /tmp/pipeline-state-*.json
  rm -f /tmp/pipeline-stop-warned-*
  echo "Done."
  exit 0
fi

# Detect repo and branch
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown')"
REPO_SLUG="$(basename "$REPO_ROOT")"
BRANCH_RAW="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
BRANCH_SAFE="${BRANCH_RAW//\//-}"

CHECKPOINT_FILE="/tmp/pipeline-state-${REPO_SLUG}-${BRANCH_SAFE}.json"

if [[ -f "$CHECKPOINT_FILE" ]]; then
  # Clean up the stop-warned marker too if it exists
  if command -v jq &>/dev/null && [[ -f "$CHECKPOINT_FILE" ]]; then
    SESSION_ID=$(jq -r '.session_id // ""' "$CHECKPOINT_FILE" 2>/dev/null || true)
    if [[ -n "$SESSION_ID" ]]; then
      rm -f "/tmp/pipeline-stop-warned-${SESSION_ID}"
    fi
  fi

  rm -f "$CHECKPOINT_FILE"
  echo "Pipeline checkpoint cleared for ${REPO_SLUG}/${BRANCH_RAW}"
else
  echo "No pipeline checkpoint found for ${REPO_SLUG}/${BRANCH_RAW}"
fi
