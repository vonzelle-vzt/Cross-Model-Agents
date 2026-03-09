#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for jq
if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not installed. Install with: brew install jq" >&2
  exit 1
fi

# Usage check
if [[ $# -lt 2 ]]; then
  echo "Usage: pipeline-gate.sh <gate_name> <status> [score] [round]" >&2
  echo "  gate_name: anti_slop, ui_validation, devils_advocate, gap_analysis" >&2
  echo "  status: passed, failed, completed" >&2
  echo "  score: optional numeric (for anti_slop and ui_validation)" >&2
  echo "  round: optional round number" >&2
  exit 1
fi

GATE_NAME="$1"
STATUS="$2"
SCORE="${3:-null}"
ROUND="${4:-null}"

# Validate gate name
case "$GATE_NAME" in
  anti_slop|ui_validation|devils_advocate|gap_analysis) ;;
  *)
    echo "ERROR: Invalid gate name '$GATE_NAME'. Must be one of: anti_slop, ui_validation, devils_advocate, gap_analysis" >&2
    exit 1
    ;;
esac

# Validate status
case "$STATUS" in
  passed|failed|completed) ;;
  *)
    echo "ERROR: Invalid status '$STATUS'. Must be one of: passed, failed, completed" >&2
    exit 1
    ;;
esac

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

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Build the gate entry
GATE_ENTRY=$(jq -n \
  --arg status "$STATUS" \
  --arg updated_at "$TIMESTAMP" \
  --argjson score "$SCORE" \
  --argjson round "$ROUND" \
  '{status: $status, updated_at: $updated_at, score: $score, round: $round}')

# Update the checkpoint file with the gate result
UPDATED=$(jq \
  --arg gate_name "$GATE_NAME" \
  --argjson gate_entry "$GATE_ENTRY" \
  '.gates[$gate_name] = $gate_entry' "$CHECKPOINT_FILE")

# Recalculate commit_allowed
UPDATED=$(echo "$UPDATED" | jq '
  .commit_allowed = (
    (.gates.anti_slop.status // "" | . == "passed") and
    (if .has_frontend_changes then (.gates.ui_validation.status // "" | . == "passed") else true end) and
    (.gates.devils_advocate.status // "" | . == "completed") and
    (.gates.gap_analysis.status // "" | . == "completed")
  )
')

echo "$UPDATED" > "$CHECKPOINT_FILE"

# Report
COMMIT_ALLOWED=$(echo "$UPDATED" | jq -r '.commit_allowed')
echo "Gate '$GATE_NAME' recorded: status=$STATUS score=$SCORE round=$ROUND"
echo "Commit allowed: $COMMIT_ALLOWED"
