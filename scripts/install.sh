#!/bin/bash
# Cross-Model Adversarial Agents — Interactive Installer
# Run from the repo root: ./scripts/install.sh
#
# Installs agents + skills to ~/.claude/ and ~/.codex/
# Optionally sets up MCP servers and CLI tools with guided prompts.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

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

  cp "$REPO_DIR"/claude-code/agents/*.md "$CLAUDE_AGENTS/"
  CLAUDE_AGENT_COUNT=$(ls "$REPO_DIR"/claude-code/agents/*.md 2>/dev/null | wc -l | tr -d ' ')
  ok "Installed $CLAUDE_AGENT_COUNT Claude Code agents → $CLAUDE_AGENTS"

  # Skills
  for skill_dir in "$REPO_DIR"/claude-code/skills/*/; do
    if [ -d "$skill_dir" ]; then
      skill_name=$(basename "$skill_dir")
      mkdir -p "$CLAUDE_SKILLS/$skill_name"
      cp "$skill_dir"*.md "$CLAUDE_SKILLS/$skill_name/" 2>/dev/null || true
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

  cp "$REPO_DIR"/codex/agents/*.toml "$CODEX_AGENTS/"
  CODEX_AGENT_COUNT=$(ls "$REPO_DIR"/codex/agents/*.toml 2>/dev/null | wc -l | tr -d ' ')
  ok "Installed $CODEX_AGENT_COUNT Codex agents → $CODEX_AGENTS"
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
[ $CLAUDE_AGENT_COUNT -gt 0 ] && echo "    $CLAUDE_AGENT_COUNT Claude Code agents → ~/.claude/agents/"
[ $CODEX_AGENT_COUNT -gt 0 ] && echo "    $CODEX_AGENT_COUNT Codex agents → ~/.codex/agents/"
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
echo "  Docs: https://github.com/Dallionking/cross-model-agents"
echo ""
