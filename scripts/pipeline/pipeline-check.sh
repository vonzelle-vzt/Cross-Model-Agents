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

# If no checkpoint exists, allow commit (no implementation happened)
if [[ ! -f "$CHECKPOINT_FILE" ]]; then
  exit 0
fi

COMMIT_ALLOWED=$(jq -r '.commit_allowed' "$CHECKPOINT_FILE")

if [[ "$COMMIT_ALLOWED" == "true" ]]; then
  echo "All pipeline gates passed. Commit allowed."
  exit 0
fi

# Build a list of missing/failed gates
HAS_FRONTEND=$(jq -r '.has_frontend_changes' "$CHECKPOINT_FILE")

MISSING=()

# Check anti_slop
ANTI_SLOP_STATUS=$(jq -r '.gates.anti_slop.status // "NOT RUN"' "$CHECKPOINT_FILE")
if [[ "$ANTI_SLOP_STATUS" != "passed" ]]; then
  MISSING+=("BLOCKED: anti_slop gate ${ANTI_SLOP_STATUS}. Run the codex-anti-slop agent.")
fi

# Check ui_validation (only if frontend changes)
if [[ "$HAS_FRONTEND" == "true" ]]; then
  UI_STATUS=$(jq -r '.gates.ui_validation.status // "NOT RUN"' "$CHECKPOINT_FILE")
  if [[ "$UI_STATUS" != "passed" ]]; then
    MISSING+=("BLOCKED: ui_validation gate ${UI_STATUS}. Run the codex-ui-validator agent. (frontend changes detected)")
  fi
fi

# Check devils_advocate
DA_STATUS=$(jq -r '.gates.devils_advocate.status // "NOT RUN"' "$CHECKPOINT_FILE")
if [[ "$DA_STATUS" != "completed" ]]; then
  MISSING+=("BLOCKED: devils_advocate gate ${DA_STATUS}. Run the codex-devils-advocate agent.")
fi

# Check gap_analysis
GA_STATUS=$(jq -r '.gates.gap_analysis.status // "NOT RUN"' "$CHECKPOINT_FILE")
if [[ "$GA_STATUS" != "completed" ]]; then
  MISSING+=("BLOCKED: gap_analysis gate ${GA_STATUS}. Run the codex-gap-analyst agent.")
fi

echo "PIPELINE CHECK FAILED — commit not allowed."
echo ""
for msg in "${MISSING[@]}"; do
  echo "  $msg"
done
echo ""
echo "Complete the required gates before committing."

exit 2
