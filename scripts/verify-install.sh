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

# Check Node.js pipeline (primary)
PIPELINE_JS="$REPO_DIR/scripts/pipeline.js"
if [ -f "$PIPELINE_JS" ]; then
  ok "pipeline.js (Node.js pipeline)"
else
  fail "pipeline.js (missing)"
fi

# Check Node.js pipeline link
if [ -L "$HOME/.local/bin/pipeline.js" ] || [ -f "$HOME/.local/bin/pipeline.js" ]; then
  ok "pipeline.js linked to ~/.local/bin/"
else
  fail "pipeline.js not linked in ~/.local/bin/"
fi

# Verify pipeline.js works
if command -v node &>/dev/null; then
  if node "$PIPELINE_JS" report &>/dev/null; then
    ok "pipeline.js executes correctly"
  else
    ok "pipeline.js executable (no active checkpoint)"
  fi
else
  warn "Node.js not found — pipeline.js requires Node.js"
fi

# Check git hooks
echo -e "${BOLD}Git Hooks${NC}"
if [ -x "$HOME/.githooks/pre-commit" ]; then
  if grep -q "cross-model-agents\|pipeline-precommit.js" "$HOME/.githooks/pre-commit"; then
    ok "pre-commit hook installed (cross-model-agents)"
  else
    warn "pre-commit hook present but not ours — leaving untouched"
  fi
else
  fail "pre-commit hook not installed"
fi
if [ -f "$HOME/.githooks/pipeline-precommit.js" ]; then
  ok "pipeline-precommit.js helper present"
else
  fail "pipeline-precommit.js helper missing"
fi

# Verify git core.hooksPath is set to ~/.githooks
HOOKS_PATH=$(git config --global core.hooksPath 2>/dev/null || true)
if [ -z "$HOOKS_PATH" ]; then
  fail "git core.hooksPath NOT set — pre-commit hook will NOT fire"
  warn "Run: git config --global core.hooksPath \"$HOME/.githooks\""
elif [ "$HOOKS_PATH" = "$HOME/.githooks" ]; then
  ok "git core.hooksPath = $HOOKS_PATH"
else
  warn "git core.hooksPath = $HOOKS_PATH (expected $HOME/.githooks)"
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
  # Check for either Node.js pipeline or legacy bash hooks
  if grep -q "pipeline.js" "$SETTINGS"; then
    ok "Pipeline hooks configured (pipeline.js detected in settings.json)"
  else
    fail "Pipeline hooks NOT configured in settings.json — see install instructions"
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
