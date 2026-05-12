#!/bin/bash
# Cross-Model Adversarial Agents — Interactive Installer
# Run from the repo root: ./scripts/install.sh
#
# Installs agents + skills to ~/.claude/ and ~/.codex/
# Optionally sets up MCP servers and CLI tools with guided prompts.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Parse flags
USE_SYMLINKS=true
for arg in "$@"; do
  case "$arg" in
    --copy) USE_SYMLINKS=false ;;
    --help|-h) echo "Usage: ./install.sh [--copy]"; echo "  --copy: Use copies instead of symlinks (default: symlinks)"; exit 0 ;;
  esac
done

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${BLUE}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; }
ask()   { echo -en "${YELLOW}?${NC} $1 [y/N] "; read -r ans; [[ "$ans" =~ ^[Yy] ]]; }

echo ""
echo -e "${BOLD}Cross-Model Adversarial Agents${NC}"
echo -e "Bidirectional review between Claude Code (Opus) and Codex CLI (GPT-5.4)"
echo ""

# ─────────────────────────────────────────────────────────────
# Phase 1: Prerequisite Checks
# ─────────────────────────────────────────────────────────────

echo -e "${BOLD}Phase 1: Prerequisites${NC}"
echo ""

CLAUDE_OK=false
CODEX_OK=false

if command -v claude &>/dev/null; then
  ok "Claude Code found: $(claude --version 2>/dev/null || echo 'installed')"
  CLAUDE_OK=true
else
  fail "Claude Code not found"
  echo "  Install: https://docs.claude.com/en/docs/claude-code"
  echo "  Then run: claude auth login"
fi

if command -v codex &>/dev/null || type codex &>/dev/null; then
  CODEX_VERSION=$(command codex --version 2>/dev/null || echo 'installed')
  ok "Codex CLI found: $CODEX_VERSION"
  CODEX_OK=true
else
  fail "Codex CLI not found"
  echo "  Install: npm install -g @openai/codex"
  echo "  Then run: codex login"
fi

echo ""

if ! $CLAUDE_OK && ! $CODEX_OK; then
  fail "Neither CLI is installed. Install at least one to continue."
  exit 1
fi

if ! $CLAUDE_OK || ! $CODEX_OK; then
  warn "Only one CLI detected. Cross-model features require both."
  echo "  You can still install agents for the available CLI."
  echo ""
  if ! ask "Continue with partial install?"; then
    echo "Exiting. Install both CLIs and try again."
    exit 0
  fi
fi

# ─────────────────────────────────────────────────────────────
# Phase 2: Core Install (Agents + Skills)
# ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Phase 2: Installing Agents${NC}"
echo ""

CLAUDE_AGENT_COUNT=0
CODEX_AGENT_COUNT=0
SKILL_COUNT=0

# Claude Code agents
if $CLAUDE_OK; then
  CLAUDE_AGENTS="$HOME/.claude/agents"
  CLAUDE_SKILLS="$HOME/.claude/skills"
  mkdir -p "$CLAUDE_AGENTS" "$CLAUDE_SKILLS"

  # Backup existing agents
  if ls "$CLAUDE_AGENTS"/codex-*.md &>/dev/null; then
    BACKUP_DIR="$CLAUDE_AGENTS/.backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp "$CLAUDE_AGENTS"/codex-*.md "$BACKUP_DIR/" 2>/dev/null || true
    info "Backed up existing agents to $BACKUP_DIR"
  fi

  CLAUDE_AGENT_COUNT=$(ls "$REPO_DIR"/claude-code/agents/*.md 2>/dev/null | wc -l | tr -d ' ')
  if $USE_SYMLINKS; then
    for agent_file in "$REPO_DIR"/claude-code/agents/*.md; do
      ln -sf "$agent_file" "$CLAUDE_AGENTS/$(basename "$agent_file")"
    done
    ok "Symlinked $CLAUDE_AGENT_COUNT Claude Code agents → $CLAUDE_AGENTS"
  else
    cp "$REPO_DIR"/claude-code/agents/*.md "$CLAUDE_AGENTS/"
    ok "Copied $CLAUDE_AGENT_COUNT Claude Code agents → $CLAUDE_AGENTS"
  fi

  # Skills
  for skill_dir in "$REPO_DIR"/claude-code/skills/*/; do
    if [ -d "$skill_dir" ]; then
      skill_name=$(basename "$skill_dir")
      mkdir -p "$CLAUDE_SKILLS/$skill_name"
      if $USE_SYMLINKS; then
        for skill_file in "$skill_dir"*.md; do
          [ -f "$skill_file" ] && ln -sf "$skill_file" "$CLAUDE_SKILLS/$skill_name/$(basename "$skill_file")"
        done
      else
        cp "$skill_dir"*.md "$CLAUDE_SKILLS/$skill_name/" 2>/dev/null || true
      fi
      SKILL_COUNT=$((SKILL_COUNT + 1))
    fi
  done
  if [ $SKILL_COUNT -gt 0 ]; then
    ok "Installed $SKILL_COUNT Claude Code skills → $CLAUDE_SKILLS"
  fi
fi

# Codex agents
if $CODEX_OK; then
  CODEX_AGENTS="$HOME/.codex/agents"
  mkdir -p "$CODEX_AGENTS"

  # Backup existing agents
  if ls "$CODEX_AGENTS"/claude-*.toml &>/dev/null || ls "$CODEX_AGENTS"/anti-slop.toml &>/dev/null; then
    BACKUP_DIR="$CODEX_AGENTS/.backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    cp "$CODEX_AGENTS"/claude-*.toml "$BACKUP_DIR/" 2>/dev/null || true
    cp "$CODEX_AGENTS"/anti-slop.toml "$BACKUP_DIR/" 2>/dev/null || true
    cp "$CODEX_AGENTS"/ui-validator.toml "$BACKUP_DIR/" 2>/dev/null || true
    info "Backed up existing agents to $BACKUP_DIR"
  fi

  CODEX_AGENT_COUNT=$(ls "$REPO_DIR"/codex/agents/*.toml 2>/dev/null | wc -l | tr -d ' ')
  if $USE_SYMLINKS; then
    for agent_file in "$REPO_DIR"/codex/agents/*.toml; do
      ln -sf "$agent_file" "$CODEX_AGENTS/$(basename "$agent_file")"
    done
    ok "Symlinked $CODEX_AGENT_COUNT Codex agents → $CODEX_AGENTS"
  else
    cp "$REPO_DIR"/codex/agents/*.toml "$CODEX_AGENTS/"
    ok "Copied $CODEX_AGENT_COUNT Codex agents → $CODEX_AGENTS"
  fi
fi

# Pipeline enforcement (single Node.js script, no legacy bash since v3.0.0)
PIPELINE_JS="$REPO_DIR/scripts/pipeline.js"
LOCAL_BIN="$HOME/.local/bin"
mkdir -p "$LOCAL_BIN"

if [ -f "$PIPELINE_JS" ]; then
  if $USE_SYMLINKS; then
    ln -sf "$PIPELINE_JS" "$LOCAL_BIN/pipeline.js"
  else
    cp "$PIPELINE_JS" "$LOCAL_BIN/pipeline.js"
  fi
  ok "Pipeline CLI installed → $LOCAL_BIN/pipeline.js"
fi

# Install git pre-commit hook (sh shim → Node helper; cross-platform)
GITHOOKS_DIR="$HOME/.githooks"
mkdir -p "$GITHOOKS_DIR"

# Always (re)write the Node helper
cat > "$GITHOOKS_DIR/pipeline-precommit.js" << 'JSEOF'
#!/usr/bin/env node
// Pipeline pre-commit hook (cross-platform). Installed by cross-model-agents.
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

if (process.env.SKIP_PIPELINE_CHECK === '1') {
  const reason = (process.env.PIPELINE_BYPASS_REASON || '').trim();
  if (reason.length < 12) {
    console.error('Pipeline bypass requires PIPELINE_BYPASS_REASON="<at least 12 chars>" (or run: pipeline.js bypass --reason "<text>")');
    process.exit(1);
  }
  console.log(`Pipeline check skipped (reason: ${reason})`);
  process.exit(0);
}

const pipeline = path.join(os.homedir(), '.local', 'bin', 'pipeline.js');
if (!fs.existsSync(pipeline)) process.exit(0);
const r = spawnSync(process.execPath, [pipeline, 'check'], { stdio: 'inherit' });
process.exit(r.status === null ? 1 : r.status);
JSEOF
chmod +x "$GITHOOKS_DIR/pipeline-precommit.js" 2>/dev/null || true

if [ -f "$GITHOOKS_DIR/pre-commit" ]; then
  if grep -q "cross-model-agents\|pipeline-precommit.js" "$GITHOOKS_DIR/pre-commit"; then
    : # ours — overwrite below
  else
    warn "Found non-pipeline pre-commit hook at $GITHOOKS_DIR/pre-commit — left untouched"
    info "Merge manually or back up and re-run installer."
    PRECOMMIT_SKIP=1
  fi
fi

if [ "${PRECOMMIT_SKIP:-0}" != "1" ]; then
  cat > "$GITHOOKS_DIR/pre-commit" << 'HOOKEOF'
#!/bin/sh
# Pipeline enforcement pre-commit hook. Installed by cross-model-agents.
# Delegates to a Node.js helper for full cross-platform behavior.

if ! command -v node >/dev/null 2>&1; then
  echo "WARNING: node not on PATH — pipeline check skipped." >&2
  exit 0
fi
exec node "$HOME/.githooks/pipeline-precommit.js" "$@"
HOOKEOF
  chmod +x "$GITHOOKS_DIR/pre-commit"
  ok "Installed git pre-commit hook → $GITHOOKS_DIR/pre-commit"
fi

# CRITICAL: set core.hooksPath so the hook actually fires
CURRENT_HOOKS_PATH=$(git config --global core.hooksPath 2>/dev/null || true)
if [ -z "$CURRENT_HOOKS_PATH" ]; then
  if git config --global core.hooksPath "$GITHOOKS_DIR" 2>/dev/null; then
    ok "git core.hooksPath set to $GITHOOKS_DIR"
  else
    fail "Failed to set git core.hooksPath — run manually: git config --global core.hooksPath \"$GITHOOKS_DIR\""
  fi
elif [ "$CURRENT_HOOKS_PATH" = "$GITHOOKS_DIR" ]; then
  ok "git core.hooksPath already = $GITHOOKS_DIR"
else
  warn "git core.hooksPath is already set to \"$CURRENT_HOOKS_PATH\" — pipeline hook will NOT fire."
  info "To enable: git config --global core.hooksPath \"$GITHOOKS_DIR\""
fi

echo ""

# ─────────────────────────────────────────────────────────────
# Phase 3: Optional CLI Tools
# ─────────────────────────────────────────────────────────────

echo -e "${BOLD}Phase 3: Optional CLI Tools${NC}"
echo ""
echo "These tools enhance the cross-model workflow but are not required."
echo ""

# agent-browser (for UI validation gate)
if command -v agent-browser &>/dev/null; then
  ok "agent-browser already installed (used by UI validation gate)"
else
  echo "  agent-browser — Browser automation for UI validation gate"
  echo "  The UI validator uses this to capture screenshots and test responsive layouts."
  if ask "Install agent-browser CLI?"; then
    info "Installing agent-browser..."
    npm install -g agent-browser 2>/dev/null && ok "agent-browser installed" || fail "Install failed. Run: npm install -g agent-browser"
  fi
fi

# shadcn CLI (for frontend component work)
if npx shadcn@latest --version &>/dev/null 2>&1; then
  ok "shadcn CLI available via npx"
else
  echo "  shadcn/ui v4 CLI — Install and manage UI components"
  echo "  Used by frontend agents for component scaffolding."
  echo "  Available via npx (no global install needed): npx shadcn@latest add <component>"
  ok "shadcn CLI available on-demand via npx"
fi

echo ""

# ─────────────────────────────────────────────────────────────
# Phase 4: Optional MCP Servers
# ─────────────────────────────────────────────────────────────

echo -e "${BOLD}Phase 4: MCP Servers (Optional)${NC}"
echo ""
echo "MCP servers give agents access to external tools. Install only what you need."
echo "Agents gracefully skip unavailable MCPs — nothing breaks without them."
echo ""

# Track what was installed
MCP_INSTALLED=()

install_mcp_claude() {
  local name="$1" cmd="$2" args="$3"
  if $CLAUDE_OK; then
    if claude mcp list 2>/dev/null | grep -q "$name"; then
      ok "$name already configured in Claude Code"
    else
      claude mcp add "$name" -- $cmd $args 2>/dev/null && ok "Added $name to Claude Code" || fail "Failed to add $name"
    fi
  fi
}

install_mcp_codex_note() {
  local name="$1"
  if $CODEX_OK; then
    info "For Codex: Add [$name] to ~/.codex/config.toml under [mcp_servers]"
  fi
}

# --- Cross-Model Communication (Required for MCP-based delegation) ---

echo -e "${BOLD}Cross-Model Communication${NC}"
echo ""
echo "  These MCP servers enable cross-model delegation without CLI shell-outs."
echo "  They reduce latency, improve reliability, and remove --dangerously-skip-permissions."
echo ""

# Codex MCP Server (for Claude Code → Codex delegation)
echo "  codex-mcp-server — Wraps Codex CLI as an MCP server"
echo "  Allows Claude Code agents to call Codex via structured MCP tool calls."
if ask "Install codex-mcp-server?"; then
  install_mcp_claude "codex" "npx" "-y codex-mcp-server"
  MCP_INSTALLED+=("codex-mcp-server")
fi
echo ""

# Claude Code MCP Server (for Codex → Claude delegation)
echo "  claude-code-mcp — Wraps Claude Code as an MCP server"
echo "  Allows Codex agents to call Claude via structured MCP tool calls."
if ask "Install claude-code-mcp?"; then
  if $CODEX_OK; then
    info "For Codex, add to ~/.codex/config.toml:"
    echo '    [mcp_servers."claude-code-mcp"]'
    echo '    command = "npx"'
    echo '    args = ["-y", "@anthropic-ai/claude-code-mcp@latest"]'
  fi
  MCP_INSTALLED+=("claude-code-mcp")
fi
echo ""

# --- Codebase Intelligence ---

echo -e "${BOLD}Codebase Intelligence${NC}"
echo ""

echo "  Auggie (codebase-retrieval) — Semantic codebase search"
echo "  Indexes your entire repo. Finds cross-file references grep misses."
if ask "Install Auggie MCP?"; then
  if command -v auggie &>/dev/null; then
    ok "auggie CLI already installed"
    install_mcp_claude "codebase-retrieval" "auggie" "--mcp --mcp-auto-workspace"
  else
    info "Install auggie first: npm install -g auggie"
    info "Then run: claude mcp add codebase-retrieval -- auggie --mcp --mcp-auto-workspace"
  fi
  MCP_INSTALLED+=("auggie")
fi
echo ""

echo "  GitNexus — Dependency graphs and impact analysis"
echo "  Maps what depends on what. Shows what breaks when you change something."
if ask "Install GitNexus MCP?"; then
  install_mcp_claude "gitnexus" "npx" "-y gitnexus@latest mcp"
  install_mcp_codex_note "gitnexus"
  MCP_INSTALLED+=("gitnexus")
fi
echo ""

# --- Research & Documentation ---

echo -e "${BOLD}Research & Documentation${NC}"
echo ""

echo "  EXA — Semantic web search for research and patterns"
echo "  Agents use this to research design patterns, best practices, and real-world examples."
if ask "Install EXA MCP?"; then
  echo -en "  Enter your EXA API key (get one at https://exa.ai): "
  read -r EXA_KEY
  if [ -n "$EXA_KEY" ]; then
    if $CLAUDE_OK; then
      claude mcp add exa --url "https://mcp.exa.ai/mcp" --header "Authorization: Bearer $EXA_KEY" 2>/dev/null && ok "Added EXA to Claude Code" || fail "Failed"
    fi
    info "For Codex, add to ~/.codex/config.toml:"
    echo '    [mcp_servers.exa]'
    echo '    url = "https://mcp.exa.ai/mcp"'
    echo "    bearer_token_env_var = \"EXA_API_KEY\""
    echo ""
    echo "    Then set: export EXA_API_KEY=$EXA_KEY"
    MCP_INSTALLED+=("exa")
  else
    warn "Skipped — no API key provided"
  fi
fi
echo ""

echo "  Ref — Documentation search across frameworks and libraries"
echo "  Free, no API key needed."
if ask "Install Ref MCP?"; then
  if $CLAUDE_OK; then
    claude mcp add ref --url "https://api.ref.tools/mcp?apiKey=ref-a867514653e7d2c73d9e" 2>/dev/null && ok "Added Ref to Claude Code" || fail "Failed"
  fi
  info "For Codex, add to ~/.codex/config.toml:"
  echo '    [mcp_servers."ref"]'
  echo '    url = "https://api.ref.tools/mcp?apiKey=ref-a867514653e7d2c73d9e"'
  MCP_INSTALLED+=("ref")
fi
echo ""

echo "  Context7 — Library documentation lookup"
echo "  Free, no API key needed. Gives agents access to framework docs."
if ask "Install Context7 MCP?"; then
  install_mcp_claude "context7" "npx" "-y @upstash/context7-mcp"
  install_mcp_codex_note "context7"
  MCP_INSTALLED+=("context7")
fi
echo ""

echo "  Firecrawl — Web scraping and crawling"
echo "  Agents use this to scrape documentation, research URLs, and crawl sites."
if ask "Install Firecrawl MCP?"; then
  echo -en "  Enter your Firecrawl API key (get one at https://firecrawl.dev): "
  read -r FC_KEY
  if [ -n "$FC_KEY" ]; then
    install_mcp_claude "firecrawl" "npx" "-y firecrawl-mcp"
    info "Set the env var: export FIRECRAWL_API_KEY=$FC_KEY"
    MCP_INSTALLED+=("firecrawl")
  else
    warn "Skipped — no API key provided"
  fi
fi
echo ""

# --- Code Review ---

echo -e "${BOLD}Code Review${NC}"
echo ""

echo "  Greptile — AI-powered code review and PR scoring"
echo "  Used in the PR review gate at the end of the pipeline."
if ask "Install Greptile MCP?"; then
  echo -en "  Enter your Greptile API key (get one at https://greptile.com): "
  read -r GREPTILE_KEY
  if [ -n "$GREPTILE_KEY" ]; then
    if $CLAUDE_OK; then
      claude mcp add greptile --url "https://api.greptile.com/mcp" --header "Authorization: Bearer $GREPTILE_KEY" 2>/dev/null && ok "Added Greptile to Claude Code" || fail "Failed"
    fi
    info "For Codex, add to ~/.codex/config.toml:"
    echo '    [mcp_servers."greptile"]'
    echo '    url = "https://api.greptile.com/mcp"'
    echo '    bearer_token_env_var = "GREPTILE_API_KEY"'
    echo ""
    echo "    Then set: export GREPTILE_API_KEY=$GREPTILE_KEY"
    MCP_INSTALLED+=("greptile")
  else
    warn "Skipped — no API key provided"
  fi
fi
echo ""

# --- UI Components ---

echo -e "${BOLD}UI Components${NC}"
echo ""

echo "  shadcn/ui MCP — Browse and discover UI components"
echo "  Free, no API key. Lets agents browse the shadcn/ui component library."
if ask "Install shadcn/ui MCP?"; then
  install_mcp_claude "shadcn-ui" "npx" "-y @jpisnice/shadcn-ui-mcp-server"
  install_mcp_codex_note "shadcn-ui"
  MCP_INSTALLED+=("shadcn-ui")
fi
echo ""

# --- Reasoning ---

echo -e "${BOLD}Reasoning${NC}"
echo ""

echo "  Sequential Thinking — Structured multi-step reasoning"
echo "  Free, no API key. Helps agents with complex multi-step analysis."
if ask "Install Sequential Thinking MCP?"; then
  install_mcp_claude "sequential-thinking" "npx" "-y @modelcontextprotocol/server-sequential-thinking"
  install_mcp_codex_note "sequential-thinking"
  MCP_INSTALLED+=("sequential-thinking")
fi
echo ""

# ─────────────────────────────────────────────────────────────
# Phase 5: Summary
# ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}────────────────────────────────────────${NC}"
echo -e "${BOLD}Installation Complete${NC}"
echo -e "${BOLD}────────────────────────────────────────${NC}"
echo ""
echo -e "  ${GREEN}Agents:${NC}"
if [ $CLAUDE_AGENT_COUNT -gt 0 ]; then
  if $USE_SYMLINKS; then
    echo "    $CLAUDE_AGENT_COUNT Claude Code agents (symlinked) → ~/.claude/agents/"
  else
    echo "    $CLAUDE_AGENT_COUNT Claude Code agents (copied) → ~/.claude/agents/"
  fi
fi
if [ $CODEX_AGENT_COUNT -gt 0 ]; then
  if $USE_SYMLINKS; then
    echo "    $CODEX_AGENT_COUNT Codex agents (symlinked) → ~/.codex/agents/"
  else
    echo "    $CODEX_AGENT_COUNT Codex agents (copied) → ~/.codex/agents/"
  fi
fi
[ $SKILL_COUNT -gt 0 ] && echo "    $SKILL_COUNT Claude Code skills → ~/.claude/skills/"
echo ""

if [ ${#MCP_INSTALLED[@]} -gt 0 ]; then
  echo -e "  ${GREEN}MCP Servers:${NC}"
  for mcp in "${MCP_INSTALLED[@]}"; do
    echo "    ✓ $mcp"
  done
  echo ""
fi

echo -e "  ${YELLOW}Next Steps:${NC}"
echo "    1. Restart Claude Code and Codex CLI for changes to take effect"
echo "    2. Test: In Claude Code, try 'Use the codex-reviewer agent to review my code'"
echo "    3. Test: In Codex, try '@claude-reviewer Review my implementation'"
echo ""

echo -e "  ${BLUE}Pipeline:${NC}"
echo "    Plan → Anti-Slop Gate → UI Validation → Devil's Advocate → Gap Analysis → Commit → PR → Merge"
echo ""
echo "  Docs: https://github.com/vonzelle-vzt/Cross-Model-Agents"
echo ""
