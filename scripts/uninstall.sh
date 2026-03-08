#!/bin/bash
# Cross-Model Adversarial Agents — Uninstaller
# Removes agents and skills installed by install.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

echo ""
echo -e "${BOLD}Uninstalling Cross-Model Adversarial Agents${NC}"
echo ""

# Claude Code agents
CLAUDE_AGENTS="$HOME/.claude/agents"
AGENTS=(codex-reviewer codex-devils-advocate codex-architect codex-frontend codex-backend codex-gap-analyst codex-qa codex-security codex-anti-slop codex-ui-validator)
for agent in "${AGENTS[@]}"; do
  if [ -f "$CLAUDE_AGENTS/$agent.md" ]; then
    rm "$CLAUDE_AGENTS/$agent.md"
    ok "Removed $agent.md"
  fi
done

# Claude Code skills
CLAUDE_SKILLS="$HOME/.claude/skills"
for skill in codex-review council delegate; do
  if [ -d "$CLAUDE_SKILLS/$skill" ]; then
    rm -rf "$CLAUDE_SKILLS/$skill"
    ok "Removed skill: $skill"
  fi
done

# Codex agents
CODEX_AGENTS="$HOME/.codex/agents"
CODEX_AGENTS_LIST=(claude-reviewer claude-devils-advocate claude-architect claude-frontend claude-frontend-design claude-marketing claude-gap-analyst claude-qa claude-security anti-slop ui-validator council planner executor reviewer default backend frontend explorer tester security)
for agent in "${CODEX_AGENTS_LIST[@]}"; do
  if [ -f "$CODEX_AGENTS/$agent.toml" ]; then
    rm "$CODEX_AGENTS/$agent.toml"
    ok "Removed $agent.toml"
  fi
done

echo ""
echo -e "${BOLD}Uninstall complete.${NC}"
echo ""
warn "MCP servers were NOT removed. Remove them manually if needed:"
echo "  claude mcp remove <server-name>"
echo "  Or edit ~/.codex/config.toml [mcp_servers] section"
echo ""
