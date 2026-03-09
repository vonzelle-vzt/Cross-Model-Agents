#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check for jq
if ! command -v jq &>/dev/null; then
  echo "{}"
  exit 0
fi

# Read stdin (hook JSON with tool_input.command)
HOOK_INPUT=$(cat)

# Extract the command from the hook input
COMMAND=$(echo "$HOOK_INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null || echo "")

# Check if this is a git commit command
# Match "git commit" but not "git commit --allow-empty"
IS_GIT_COMMIT=false
if echo "$COMMAND" | grep -qE '^\s*git\s+commit(\s|$)'; then
  # Check it's not --allow-empty
  if ! echo "$COMMAND" | grep -qE '\-\-allow-empty'; then
    IS_GIT_COMMIT=true
  fi
fi

# If not a git commit command, allow it
if [[ "$IS_GIT_COMMIT" != "true" ]]; then
  echo "{}"
  exit 0
fi

# Check for override
if [[ "${SKIP_PIPELINE_CHECK:-}" == "1" ]]; then
  echo "{}"
  exit 0
fi

# Run pipeline-check.sh and capture the result
CHECK_OUTPUT=$("$SCRIPT_DIR/pipeline-check.sh" 2>&1) && CHECK_EXIT=0 || CHECK_EXIT=$?

# If check passed, allow commit
if [[ "$CHECK_EXIT" -eq 0 ]]; then
  echo "{}"
  exit 0
fi

# Check failed — build the deny response with gate details
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown')"
REPO_SLUG="$(basename "$REPO_ROOT")"
BRANCH_RAW="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
BRANCH_SAFE="${BRANCH_RAW//\//-}"

CHECKPOINT_FILE="/tmp/pipeline-state-${REPO_SLUG}-${BRANCH_SAFE}.json"

# Build missing gates list
MISSING_LINES=""
HAS_FRONTEND="false"

if [[ -f "$CHECKPOINT_FILE" ]]; then
  HAS_FRONTEND=$(jq -r '.has_frontend_changes' "$CHECKPOINT_FILE" 2>/dev/null || echo "false")

  ANTI_SLOP=$(jq -r '.gates.anti_slop.status // "NOT RUN"' "$CHECKPOINT_FILE")
  if [[ "$ANTI_SLOP" != "passed" ]]; then
    MISSING_LINES="${MISSING_LINES}\n- anti_slop: ${ANTI_SLOP}"
  fi

  if [[ "$HAS_FRONTEND" == "true" ]]; then
    UI_VAL=$(jq -r '.gates.ui_validation.status // "NOT RUN"' "$CHECKPOINT_FILE")
    if [[ "$UI_VAL" != "passed" ]]; then
      MISSING_LINES="${MISSING_LINES}\n- ui_validation: ${UI_VAL} (frontend changes detected)"
    fi
  fi

  DA=$(jq -r '.gates.devils_advocate.status // "NOT RUN"' "$CHECKPOINT_FILE")
  if [[ "$DA" != "completed" ]]; then
    MISSING_LINES="${MISSING_LINES}\n- devils_advocate: ${DA}"
  fi

  GA=$(jq -r '.gates.gap_analysis.status // "NOT RUN"' "$CHECKPOINT_FILE")
  if [[ "$GA" != "completed" ]]; then
    MISSING_LINES="${MISSING_LINES}\n- gap_analysis: ${GA}"
  fi
else
  MISSING_LINES="\n- anti_slop: NOT RUN\n- devils_advocate: NOT RUN\n- gap_analysis: NOT RUN"
fi

REASON="PIPELINE GATE BLOCKED: Cannot commit without completing required gates.\n\nMissing gates:${MISSING_LINES}\n\nRun these agents before committing."

printf '%s' "$REASON" | jq -Rs '{decision: "deny", reason: .}'
