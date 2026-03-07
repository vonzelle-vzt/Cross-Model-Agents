#!/bin/bash
# Install cross-model adversarial agents globally for Claude Code and Codex CLI.
# Run from the repo root: ./scripts/install.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

echo "Installing cross-model agents from: $REPO_DIR"

# Claude Code agents
CLAUDE_AGENTS="$HOME/.claude/agents"
CLAUDE_SKILLS="$HOME/.claude/skills"
mkdir -p "$CLAUDE_AGENTS" "$CLAUDE_SKILLS"

echo "  Claude Code agents -> $CLAUDE_AGENTS"
cp "$REPO_DIR"/claude-code/agents/*.md "$CLAUDE_AGENTS/"

echo "  Claude Code skills -> $CLAUDE_SKILLS"
for skill_dir in "$REPO_DIR"/claude-code/skills/*/; do
  skill_name=$(basename "$skill_dir")
  mkdir -p "$CLAUDE_SKILLS/$skill_name"
  cp "$skill_dir"*.md "$CLAUDE_SKILLS/$skill_name/"
done

# Codex agents
CODEX_AGENTS="$HOME/.codex/agents"
mkdir -p "$CODEX_AGENTS"

echo "  Codex agents -> $CODEX_AGENTS"
cp "$REPO_DIR"/codex/agents/*.toml "$CODEX_AGENTS/"

# Codex MCP server (Claude Code side)
if command -v claude &>/dev/null; then
  if ! claude mcp list 2>/dev/null | grep -q "codex"; then
    echo "  Adding codex MCP server to Claude Code..."
    claude mcp add codex -- npx -y codex-mcp-server
  else
    echo "  Codex MCP server already configured in Claude Code"
  fi
fi

echo ""
echo "Installed:"
echo "  $(ls "$REPO_DIR"/claude-code/agents/*.md | wc -l | tr -d ' ') Claude Code agents"
echo "  $(ls "$REPO_DIR"/claude-code/skills/*/SKILL.md | wc -l | tr -d ' ') Claude Code skills"
echo "  $(ls "$REPO_DIR"/codex/agents/*.toml | wc -l | tr -d ' ') Codex agents"
echo ""
echo "Restart Claude Code and Codex for changes to take effect."
