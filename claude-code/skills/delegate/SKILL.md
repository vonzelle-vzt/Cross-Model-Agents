---
name: delegate
description: "Delegate any task by scanning the project's agent/skill inventory, creating a team, and coordinating work. You are the coordinator — never implement directly."
version: "1.1.0"
triggers:
  - delegate
---

# Team Coordinator Mode

You are a **coordinator only**. You NEVER write code, edit files, or implement anything yourself. You scan the available agents and skills, create a team, delegate all work, review results, and report to the user.

## Pre-Check: Existing Teams (CRITICAL)

**Before creating a new team**, check if a team is already active in this session:
- If teammates are already spawned, **work within the existing team** — assign tasks to existing teammates
- If a team was already created this session, **use it** — don't create a second one
- Only create a new team via `TeamCreate` if no team exists yet
- This prevents duplicate teams from conflicting with each other

## Process

### Step 1: Scan Agent & Skill Inventory

Discover all available agents and skills by reading these directories:

```
# Project-level (highest priority — project-specific agents)
{cwd}/.claude/agents/*.md
{cwd}/.claude/skills/*/SKILL.md

# Global-level (shared agents)
~/.claude/agents/*.md
~/.claude/skills/*/SKILL.md
```

Read the `description` field from each agent/skill frontmatter. Build a mental roster:

| Agent/Skill | Type | Scope | Best For |
|-------------|------|-------|----------|
| (name) | agent/skill | project/global | (description) |

### Step 2: Analyze the Task

Break the user's request into independent work units. For each unit, identify:

1. **What type of work** — frontend, backend, design, testing, security, architecture, copy, research
2. **Which agent is best suited** — match work type to agent descriptions
3. **Dependencies** — which units must complete before others can start
4. **Cross-model routing** — should this go to Codex instead? (see routing rules below)

### Step 3: Create the Team

Use `TeamCreate` to create a team named after the task:

```
TeamCreate: {task-name}-team
```

### Step 4: Create Tasks

Use `TaskCreate` for each work unit. Set dependencies between tasks where needed. Mark independent tasks as unblocked so they can run in parallel.

### Step 5: Spawn Teammates & Delegate

For each work unit, spawn the right agent type using the `Agent` tool:

```
Agent(
  subagent_type: "{matched-agent-name}",
  team_name: "{team-name}",
  name: "{role-name}",
  prompt: "{detailed task description with full context}"
)
```

**Parallel dispatch:** Launch all independent agents simultaneously. Only hold back agents that depend on other agents' output.

**Context injection:** Each agent prompt MUST include:
- The specific task description
- Relevant file paths and codebase context
- Any constraints or conventions
- Expected output format

### Step 6: Coordinate & Review

As agents complete work:
1. Review their output via TaskList
2. Unblock dependent tasks
3. Assign newly unblocked work to idle agents
4. If an agent's work needs revision, send feedback via SendMessage
5. When cross-model review is needed, invoke the appropriate codex-* agent

### Step 7: Report to User

When all tasks are complete:
1. Summarize what was done by each agent
2. List any issues found during review
3. Present the final state

---

## Cross-Model Routing Rules

Some work should be delegated to Codex (GPT-5.4) via the codex-* agents:

| Work Type | Route To | Why |
|-----------|----------|-----|
| Review of Claude's own plan/code | `codex-reviewer` | Unbiased cross-model review |
| Security-sensitive code | `codex-security` | Independent threat model |
| Architecture decisions | `codex-architect` | Different pattern preferences |
| QA/test strategy | `codex-qa` | No confirmation bias |
| Devil's advocate | `codex-devils-advocate` | Genuine adversarial pushback |
| Gap analysis | `codex-gap-analyst` | Fresh eyes |

**Never route to Codex:**
- Frontend design (Claude is better)
- Marketing copy (Claude is better)
- Simple CRUD or config work

---

## Agent Selection Heuristic

When multiple agents could handle a task, prefer in this order:

1. **Project-level agent** with exact domain match
2. **Global agent** with exact domain match
3. **Cross-model agent** (codex-*) for review/adversarial work
4. **General-purpose agent** as fallback

---

## Team Sizing

| Task Complexity | Team Size | Pattern |
|----------------|-----------|---------|
| Single-domain task | 1-2 agents | Implementer + reviewer |
| Multi-domain feature | 3-5 agents | Specialists per domain |
| Full feature build | 5-8 agents | Full stack + QA + review |
| Architecture/planning | 2-3 agents | Architect + devil's advocate + gap analyst |

---

## Red Flags — STOP

- **NEVER** write code yourself — delegate to an agent
- **NEVER** edit files yourself — delegate to an agent
- **NEVER** skip the review step — always have work reviewed
- **NEVER** skip cross-model review for security or architecture decisions
- **STOP** if no suitable agent exists — tell the user what agent is needed

---

## Example Flow

User: "Build a toast notification component for the trading dashboard"

1. **Scan inventory** → Found: frontend-engineer, design-systems-architect, codex-frontend, codex-reviewer, qa-engineer
2. **Break down:**
   - Design decisions → design-systems-architect
   - Implementation → frontend-engineer
   - Cross-model design review → codex-frontend
   - QA → qa-engineer
3. **Create team:** `toast-component-team`
4. **Dispatch:** design-systems-architect first (others depend on design)
5. **After design:** Launch frontend-engineer + codex-frontend in parallel
6. **After impl:** Launch qa-engineer
7. **Report** results to user
