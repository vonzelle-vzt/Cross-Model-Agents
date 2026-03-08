# Contributing to Cross-Model Adversarial Agents

Thanks for your interest in contributing! This project provides bidirectional adversarial review infrastructure between Claude Code (Opus) and Codex CLI (GPT-5.4). Contributions of new agents, skills, scoring patterns, and improvements are welcome.

## Getting Started

```bash
git clone https://github.com/Dallionking/cross-model-agents.git
cd cross-model-agents
./scripts/install.sh
```

The installer copies agents and skills to your local CLI config directories. After making changes to files in the repo, re-run `install.sh` to update your installed agents.

## Project Structure

```
claude-code/agents/    # Claude Code agents (.md) — delegate TO Codex
claude-code/skills/    # Claude Code skills (slash commands)
codex/agents/          # Codex agents (.toml) — delegate TO Claude
scripts/               # Install and uninstall scripts
docs/                  # Configuration guides
```

## Agent Format Specs

### Claude Code Agents (Markdown)

- **Location:** `claude-code/agents/`
- **Naming:** `codex-{name}.md` (the prefix indicates it delegates to Codex)
- **Format:**

```markdown
# Agent Name

Role description and purpose.

## Workflow

### 1. Gather Context
### 2. Delegate to Codex
### 3. Report Findings

## Constraints

- Constraint 1
- Constraint 2
```

Every agent must start with a `#` heading on line 1. The heading is used by Claude Code to identify the agent.

### Codex Agents (TOML)

- **Location:** `codex/agents/`
- **Naming:** `claude-{name}.toml` for cross-model agents, `{name}.toml` for Codex-native orchestration agents
- **Format:**

```toml
model = "gpt-5.4"
model_reasoning_effort = "xhigh"
sandbox_mode = "read-only"  # or "workspace-write"
developer_instructions = """
Your agent instructions here.

The developer_instructions field contains the full agent prompt.
"""
```

Valid `sandbox_mode` values:
- `"read-only"` — for review, analysis, and scoring agents
- `"workspace-write"` — for implementation agents that need to create/modify files

### Skills (Claude Code)

- **Location:** `claude-code/skills/{skill-name}/SKILL.md`
- **Trigger:** `/skill-name` in Claude Code
- **Format:** Markdown with clear description, workflow steps, and output format

## Creating Matched Scoring Pairs

The anti-slop gate and UI validator work as **matched pairs** — one agent on each side, both using the same scoring formula. If you create a new scoring gate:

1. Create the Claude Code side: `claude-code/agents/codex-{gate-name}.md`
2. Create the Codex side: `codex/agents/{gate-name}.toml`
3. Both MUST use the same formula:

```
SCORE = 10 - (critical_violations * 3) - (moderate_violations * 1) - (minor_violations * 0.5)
```

4. Both MUST use the same pass threshold: `score >= 7`
5. Both MUST check the same patterns (same count, same severity classification)
6. Both MUST loop up to 3 rounds on failure

The formula is the core quality gate. Do not modify it without a very good reason and community discussion.

## Pull Request Checklist

Before submitting a PR, verify:

- [ ] All TOML files parse without errors: `python3 -c "import tomllib; tomllib.load(open('file.toml', 'rb'))"`
- [ ] All Markdown agents have a `#` heading on line 1
- [ ] Scoring formula matches between matched pairs (if applicable)
- [ ] Tested bidirectionally (Claude Code to Codex AND Codex to Claude)
- [ ] Agents degrade gracefully when optional MCP servers are unavailable
- [ ] `scripts/uninstall.sh` agent list updated if adding or removing agents
- [ ] `scripts/install.sh` updated if changing file locations

The CI workflow (`validate.yml`) checks TOML parsing, Markdown headings, uninstall sync, and shell syntax automatically on every PR.

## Testing

There is no automated test suite (agents require live CLI access). Testing is manual:

1. Install your changes: `./scripts/install.sh`
2. Test the agent in the appropriate CLI
3. For cross-model agents, verify delegation works in both directions
4. For scoring gates, verify the score calculation matches the formula
5. Test with and without optional MCP servers to confirm graceful degradation

## Adding a New Agent

1. Create the agent file in the appropriate directory
2. Follow the naming convention and format spec above
3. Add the agent name (without extension) to `scripts/uninstall.sh` in the appropriate array
4. Update the agent count badges in `README.md` if the total changes
5. Add a row to the Agent Reference table in `README.md`
6. Test the agent manually

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). Please be respectful and constructive.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
