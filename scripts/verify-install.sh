#!/bin/bash
# Verify cross-model agents installation
set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo -e "${YELLOW}!${NC} $1"; }

ERRORS=0
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo -e "${BOLD}Cross-Model Agents — Installation Verification${NC}"
echo ""

# Check Claude Code agents
echo -e "${BOLD}Claude Code Agents${NC}"
for agent in "$REPO_DIR"/claude-code/agents/*.md; do
  name=$(basename "$agent")
  installed="$HOME/.claude/agents/$name"
  if [ -L "$installed" ]; then
    target=$(readlink "$installed")
    if [ "$target" = "$agent" ]; then
      ok "$name (symlinked, in sync)"
    else
      warn "$name (symlinked to wrong target: $target)"
      ERRORS=$((ERRORS + 1))
    fi
  elif [ -f "$installed" ]; then
    if diff -q "$agent" "$installed" &>/dev/null; then
      warn "$name (copy, in sync — consider re-running install.sh for symlinks)"
    else
      fail "$name (copy, OUT OF SYNC — re-run install.sh)"
    fi
  else
    fail "$name (not installed)"
  fi
done
echo ""

# Check Codex agents
echo -e "${BOLD}Codex Agents${NC}"
for agent in "$REPO_DIR"/codex/agents/*.toml; do
  name=$(basename "$agent")
  installed="$HOME/.codex/agents/$name"
  if [ -L "$installed" ]; then
    target=$(readlink "$installed")
    if [ "$target" = "$agent" ]; then
      ok "$name (symlinked, in sync)"
    else
      warn "$name (symlinked to wrong target: $target)"
      ERRORS=$((ERRORS + 1))
    fi
  elif [ -f "$installed" ]; then
    if diff -q "$agent" "$installed" &>/dev/null; then
      warn "$name (copy, in sync)"
    else
      fail "$name (copy, OUT OF SYNC)"
    fi
  else
    fail "$name (not installed)"
  fi
done
echo ""

# Check skills
echo -e "${BOLD}Skills${NC}"
for skill_dir in "$REPO_DIR"/claude-code/skills/*/; do
  skill_name=$(basename "$skill_dir")
  installed_dir="$HOME/.claude/skills/$skill_name"
  if [ -d "$installed_dir" ]; then
    ok "$skill_name skill installed"
  else
    fail "$skill_name skill not installed"
  fi
done
echo ""

# Check pipeline scripts
echo -e "${BOLD}Pipeline Scripts${NC}"
PIPELINE_DIR="$REPO_DIR/scripts/pipeline"
for script in pipeline-init.sh pipeline-gate.sh pipeline-check.sh pipeline-reset.sh track-file-change.sh post-edit-reminder.sh pre-commit-gate.sh stop-gate.sh; do
  if [ -x "$PIPELINE_DIR/$script" ]; then
    ok "$script"
  elif [ -f "$PIPELINE_DIR/$script" ]; then
    warn "$script (exists but not executable)"
  else
    fail "$script (missing)"
  fi
done
echo ""

echo -e "${BOLD}Pipeline Symlinks (~/.local/bin)${NC}"
for script in pipeline-init.sh pipeline-gate.sh pipeline-check.sh pipeline-reset.sh track-file-change.sh post-edit-reminder.sh pre-commit-gate.sh stop-gate.sh; do
  link="$HOME/.local/bin/$script"
  if [ -L "$link" ]; then
    ok "$script linked"
  elif [ -f "$link" ]; then
    warn "$script exists but is not a symlink"
  else
    fail "$script not linked in ~/.local/bin"
  fi
done
echo ""

# Check hooks
echo -e "${BOLD}Git Hooks${NC}"
if [ -x "$HOME/.githooks/pre-commit" ]; then
  ok "pre-commit hook installed"
else
  fail "pre-commit hook not installed"
fi
if [ -x "$HOME/.githooks/post-commit" ]; then
  ok "post-commit hook installed (GitNexus)"
fi
if [ -x "$HOME/.githooks/pre-push" ]; then
  ok "pre-push hook installed (PR file budget)"
fi
echo ""

# Check Claude Code hooks in settings.json
echo -e "${BOLD}Claude Code Hooks (settings.json)${NC}"
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ]; then
  if grep -q "pre-commit-gate.sh" "$SETTINGS"; then
    ok "Commit gate hook configured"
  else
    fail "Commit gate hook NOT configured in settings.json"
  fi
  if grep -q "post-edit-reminder.sh" "$SETTINGS"; then
    ok "Post-edit reminder hook configured"
  else
    fail "Post-edit reminder hook NOT configured in settings.json"
  fi
  if grep -q "stop-gate.sh" "$SETTINGS"; then
    ok "Stop gate hook configured"
  else
    fail "Stop gate hook NOT configured in settings.json"
  fi
else
  fail "settings.json not found"
fi
echo ""

# Summary
echo -e "${BOLD}────────────────────────────────────${NC}"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}All checks passed!${NC}"
else
  echo -e "${RED}$ERRORS issue(s) found.${NC} Re-run install.sh to fix."
fi
echo ""
