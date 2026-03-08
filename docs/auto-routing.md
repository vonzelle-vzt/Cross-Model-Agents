# Auto-Routing Configuration

These rules go in the global config for each CLI so agents auto-delegate without manual invocation.

## Claude Code (`~/.claude/CLAUDE.md`)

Add this section to auto-delegate to Codex when the other model is better:

```markdown
## Cross-Model Auto-Delegation

When working on tasks where a different model produces better results, automatically delegate using the installed agents.

### Auto-delegate to Codex (GPT-5.4) via `codex exec`:

| Trigger | Agent | Why |
|---------|-------|-----|
| Reviewing your own plan/code | codex-reviewer | Different model catches blind spots |
| Security-sensitive code | codex-security | Independent threat model |
| Architecture decisions | codex-architect | Different pattern preferences |
| Test strategy for code you wrote | codex-qa | No confirmation bias |
| Devil's advocate requests | codex-devils-advocate | Genuine adversarial pushback |
| Gap analysis on plans/specs | codex-gap-analyst | Fresh eyes on completeness |
```

## Codex (`~/.codex/instructions.md`)

Add this section to auto-delegate to Claude when Opus is stronger:

```markdown
## Cross-Model Auto-Delegation

### MANDATORY delegation (never skip):
- Frontend design → ALWAYS @claude-frontend-design (Opus has better design taste)
- Marketing copy → ALWAYS @claude-marketing (Opus writes better copy)
- Self-review → ALWAYS @claude-reviewer before presenting major work

### Auto-delegate to Claude Opus via `claude -p`:

| Trigger | Agent | Why |
|---------|-------|-----|
| Any frontend/UI work | @claude-frontend-design | Superior design sensibility |
| Any marketing copy | @claude-marketing | More natural, persuasive writing |
| Reviewing own plans | @claude-reviewer | Blind spot detection |
| Security code | @claude-security | Independent threat model |
| Architecture decisions | @claude-architect | Different perspectives |
| Test strategy | @claude-qa | No confirmation bias |
| Devil's advocate | @claude-devils-advocate | Adversarial pushback |
| Gap analysis | @claude-gap-analyst | Completeness check |
```

## Auto-Delegate Plan Mode

Both CLIs also support **mandatory coordinator-only mode** — every plan auto-delegates instead of implementing directly.

### Claude Code (`~/.claude/CLAUDE.md`)

Add this section to make ALL plans auto-delegate:

```markdown
## Auto-Delegate Plan Mode (MANDATORY)

Every plan MUST use coordinator-only mode. You are NEVER the implementer — you are ALWAYS the coordinator.

1. Scan agent/skill inventory ({cwd}/.claude/agents/ and ~/.claude/agents/)
2. Break task into work units
3. Create a team via TeamCreate
4. Delegate ALL work via Agent tool
5. Coordinate, review, report
```

### Codex (`~/.codex/instructions.md`)

Add this section to make ALL plans auto-delegate:

```markdown
## Auto-Delegate Plan Mode (MANDATORY)

Every plan MUST use coordinator-only mode. You are NEVER the implementer — you are ALWAYS the coordinator.

1. Scan agent inventory (~/.codex/agents/*.toml and {cwd}/.codex/agents/)
2. Break task into work units
3. Delegate ALL work via @agent-name
4. Cross-model delegate frontend/marketing to Claude Opus
5. Coordinate, review, report
```

### The `/delegate` Skill (Claude Code)

For explicit invocation: `/delegate` triggers the full coordinator protocol with inventory scanning, team creation, and parallel dispatch. See `claude-code/skills/delegate/SKILL.md`.

---

## Key Principle

The routing is asymmetric by design:
- **Both models** auto-delegate reviews, security, QA, and gap analysis (cross-model = unbiased)
- **Only Codex** auto-delegates design and marketing to Opus (domain strength)
- **Neither model** delegates simple CRUD, bug fixes, or explicitly assigned tasks
