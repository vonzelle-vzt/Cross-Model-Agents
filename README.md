# Cross-Model Adversarial Agents

Bidirectional adversarial review system between **Claude Code (Opus)** and **Codex CLI (GPT-5.4)**. Each model acts as the other's devil's advocate, reviewer, and specialist — eliminating single-model blindness.

## Why

When the same AI model plans and reviews, it won't challenge its own assumptions. A second model catches what the first misses: auth gaps, concurrency bugs, schema conflicts, design blind spots.

## Architecture

```
Claude Code (Opus)                          Codex CLI (GPT-5.4)
├── codex-reviewer        ←→  claude-reviewer
├── codex-devils-advocate ←→  claude-devils-advocate
├── codex-architect       ←→  claude-architect
├── codex-frontend        ←→  claude-frontend-design (Opus for design)
├── codex-backend              claude-marketing (Opus for copy)
├── codex-gap-analyst     ←→  claude-gap-analyst
├── codex-qa              ←→  claude-qa
├── codex-security        ←→  claude-security
│                              council.toml
│                              planner.toml
├── /codex-review skill
└── /council skill
```

### Model Strengths

| Domain | Best Model | Why |
|--------|-----------|-----|
| Backend, architecture, systems | GPT-5.4 | Strong at logic, concurrency, API design |
| Frontend design, UI/UX | Opus | Anti-slop principles, visual hierarchy, design sensibility |
| Marketing copy, content | Opus | More natural, human-sounding, persuasive writing |
| Code review, gap analysis | Cross-model | Different model = unbiased review |
| Security audit | Cross-model | Separate model won't overlook its own assumptions |
| QA, testing | Cross-model | No confirmation bias from the code author |

## Install

### Prerequisites

- [Claude Code](https://docs.claude.com/en/docs/claude-code) with Claude MAX or API key
- [Codex CLI](https://github.com/openai/codex) with Codex Pro or API key
- Both CLIs authenticated and working

### Install agents globally

```bash
git clone <this-repo>
cd cross-model-agents
./scripts/install.sh
```

This installs:
- 8 Claude Code agents to `~/.claude/agents/`
- 2 Claude Code skills to `~/.claude/skills/`
- 12 Codex agents to `~/.codex/agents/`
- Configures the `codex-mcp-server` in Claude Code

### Manual install

Copy the files yourself:
```bash
cp claude-code/agents/*.md ~/.claude/agents/
cp -r claude-code/skills/* ~/.claude/skills/
cp codex/agents/*.toml ~/.codex/agents/
claude mcp add codex -- npx -y codex-mcp-server
```

## Usage

### From Claude Code

**Adversarial review** — send your plan to Codex for critique:
```
/codex-review
```

**Multi-model debate** — Claude and Codex argue to consensus:
```
/council Should we use microservices or a monolith for this project?
```

**Spawn a Codex-powered agent** for unbiased review:
```
Use the codex-reviewer agent to review my auth implementation
```

### From Codex

**Delegate design to Claude** — Codex orchestrates, Opus designs:
```
@claude-frontend-design Build the dashboard layout using our design system
```

**Delegate copy to Claude** — Codex orchestrates, Opus writes:
```
@claude-marketing Write the launch email sequence for our new feature
```

**Get Claude's adversarial review**:
```
@claude-reviewer Review my API implementation plan
```

## Agent Reference

### Claude Code Agents (delegate to Codex)

| Agent | Purpose |
|-------|---------|
| `codex-reviewer` | Adversarial code/plan review |
| `codex-devils-advocate` | Challenge every assumption |
| `codex-architect` | Architecture review from different perspective |
| `codex-frontend` | Frontend from GPT-5.4's perspective |
| `codex-backend` | Backend implementation via Codex |
| `codex-gap-analyst` | Systematic gap detection |
| `codex-qa` | Unbiased QA and test strategy |
| `codex-security` | Independent security audit |

### Codex Agents (delegate to Claude)

| Agent | Purpose |
|-------|---------|
| `claude-reviewer` | Adversarial review via Opus |
| `claude-devils-advocate` | Ruthless challenge via Opus |
| `claude-architect` | Architecture assessment via Opus |
| `claude-frontend` | Frontend review via Opus |
| `claude-frontend-design` | **Full design + implementation via Opus with anti-slop skill** |
| `claude-marketing` | **Marketing copy and content via Opus** |
| `claude-gap-analyst` | Gap analysis via Opus |
| `claude-qa` | QA assessment via Opus |
| `claude-security` | Security audit via Opus |
| `council` | Multi-model deliberation protocol |
| `planner` | Planning with auto Claude review |
| `reviewer` | Iterative review loop |

### Skills (Claude Code)

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/codex-review` | `/codex-review [model]` | Send plan to Codex for adversarial review (max 5 rounds) |
| `/council` | `/council <topic>` | Structured debate between Opus and GPT-5.4 |

## Optional MCP Tools

Agents will use these if available, skip gracefully if not:

- **EXA** — web research for patterns and trends
- **Auggie** — semantic codebase search
- **GitNexus** — cross-file reference tracing
- **Firecrawl** — web scraping for research

## Auth

Both CLIs use **subscription auth** — no API keys needed:
- Claude Code: Claude MAX subscription (OAuth via `claude auth login`)
- Codex CLI: Codex Pro subscription (OAuth via `codex login`)

## License

MIT
