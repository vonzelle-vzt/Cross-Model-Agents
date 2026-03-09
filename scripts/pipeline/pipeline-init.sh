#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed. Install with: brew install jq" >&2
  exit 1
fi

# Detect repo and branch
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown')"
REPO_SLUG="$(basename "$REPO_ROOT")"
BRANCH_RAW="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
BRANCH_SAFE="${BRANCH_RAW//\//-}"

CHECKPOINT_FILE="/tmp/pipeline-state-${REPO_SLUG}-${BRANCH_SAFE}.json"

# If checkpoint already exists, don't overwrite
if [[ -f "$CHECKPOINT_FILE" ]]; then
  exit 0
fi

# Generate a random session ID
SESSION_ID="$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 12 || true)"
TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Create the checkpoint file
jq -n \
  --arg session_id "$SESSION_ID" \
  --arg repo "$REPO_SLUG" \
  --arg branch "$BRANCH_RAW" \
  --arg created_at "$TIMESTAMP" \
  '{
    session_id: $session_id,
    repo: $repo,
    branch: $branch,
    changed_files: [],
    has_frontend_changes: false,
    gates: {},
    commit_allowed: false,
    created_at: $created_at
  }' > "$CHECKPOINT_FILE"

echo "Pipeline checkpoint initialized: $CHECKPOINT_FILE"
