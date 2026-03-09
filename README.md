<p align="center">
  <img src="assets/banner.png" alt="Cross-Model Adversarial Agents" width="100%">
</p>

# Cross-Model Adversarial Agents

**Bidirectional adversarial review between Claude Code (Opus) and Codex CLI (GPT-5.4).** Each model acts as the other's devil's advocate, reviewer, and specialist -- eliminating single-model blindness from your AI-assisted development workflow.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude_Code-Opus_4.6-blueviolet)](https://docs.claude.com/en/docs/claude-code)
[![Codex CLI](https://img.shields.io/badge/Codex_CLI-GPT--5.4-green)](https://github.com/openai/codex)
[![Agents](https://img.shields.io/badge/Agents-31-orange)]()
[![Skills](https://img.shields.io/badge/Skills-3-yellow)]()

---

## Give This To Your Agent

Copy-paste this entire block into Claude Code, Codex, Cursor, Windsurf, or any AI coding agent:

> **Clone and install the cross-model adversarial review system. This gives you bidirectional code review between Claude (Opus) and Codex (GPT-5.4) — each model acts as the other's devil's advocate.**
>
> ```bash
> git clone https://github.com/Dallionking/cross-model-agents.git
> cd cross-model-agents
> ./scripts/install.sh
> ```
>
> **After install, restart your CLI. Then test with:**
> - In Claude Code: `Use the codex-reviewer agent to review my code`
> - In Codex: `@claude-reviewer Review my implementation`
> - In Claude Code: `/council Should we use X or Y?`
>
> **What you get:** 10 Claude Code agents, 3 skills, 21 Codex agents, pipeline enforcement (commit gates, post-edit reminders, session checks), anti-slop scoring, UI validation, multi-model council debates. All agents degrade gracefully without optional MCP servers.
>
> **Read the full docs:** https://github.com/Dallionking/cross-model-agents

---

## Why Cross-Model Review Matters

When the same AI model plans, implements, and reviews, it will not challenge its own assumptions. It has systematic blind spots baked into its training. A second model -- trained differently, with different biases and pattern preferences -- catches what the first one misses.

**Single-model workflow:**
```
Plan (Model A) --> Implement (Model A) --> Review (Model A) --> Ship
                                           ^--- same blind spots
```

**Cross-model workflow:**
```
Plan (Model A) --> Review (Model B) --> Implement --> Anti-Slop (Model B scores Model A)
   --> Devil's Advocate (Model B) --> Gap Analysis (Model B) --> Ship
```

This project provides the complete agent and skill infrastructure to make cross-model review automatic -- not a manual copy-paste between chat windows.

### Who Is This For

- **Solo developers** using AI coding assistants who want a second opinion from a fundamentally different model
- **Teams** that want to enforce cross-model quality gates in their AI-assisted workflows
- **Anyone** who has noticed that AI-generated code sometimes has a "sameness" to it -- over-engineered abstractions, unnecessary wrappers, template-paste patterns (what we call "slop")

---

## Architecture

```
                    CLAUDE CODE (Opus)                                    CODEX CLI (GPT-5.4)
                    ==================                                    ===================

        Agents (delegate TO Codex)                            Agents (delegate TO Claude)
        ~~~~~~~~~~~~~~~~~~~~~~~~~~                            ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
        codex-reviewer         -------- review -------->      claude-reviewer
        codex-devils-advocate  ---- challenge --------->      claude-devils-advocate
        codex-architect        --- architecture ------->      claude-architect
        codex-frontend         ---- frontend ---------->      claude-frontend
        codex-backend                                         claude-frontend-design  (Opus for design)
        codex-gap-analyst      ---- gap analysis ----->       claude-marketing        (Opus for copy)
        codex-qa               ---- QA/testing ------->       claude-gap-analyst
        codex-security         --- security audit ---->       claude-security
        codex-anti-slop        --- slop scoring ------>       claude-qa
                                                              anti-slop               (Claude scores Codex)

        Skills                                                Orchestration Agents
        ~~~~~~                                                ~~~~~~~~~~~~~~~~~~~~
        /codex-review   (iterative review loop)               planner    (auto-sends to Claude review)
        /council        (multi-model debate)                  executor   (implementation + anti-slop)
        /delegate       (coordinator-only mode)               reviewer   (strict review)
                                                              council    (multi-model debate)
                                                              default    (general + anti-slop)
                                                              backend    (backend + anti-slop)
                                                              frontend   (frontend + anti-slop)
```

### The Full Pipeline

Every implementation follows this mandatory pipeline. No exceptions.

```
    Plan
     |
     v
  Cross-Model Review (Planner + Claude/Codex review rounds) --- BLOCKER
     |
     v
  Implement (Executor / Frontend / Backend agents)
     |
     v
  Anti-Slop Gate (cross-model, per-file scoring) -------------- BLOCKER
     |   Score >= 7/10 to pass. Loop up to 3 rounds.
     |   Claude code --> Codex scores --> fix --> rescore
     |   Codex code --> Claude scores --> fix --> rescore
     |
     v
  UI Validation (if frontend, cross-model) -------------------- BLOCKER
     |   Design quality, accessibility, responsive behavior
     |
     v
  Devil's Advocate (cross-model) ------------------------------ BLOCKER
     |   Challenge every assumption. Find what WILL go wrong.
     |
     v
  Gap Analysis (cross-model) ---------------------------------- BLOCKER
     |   Compare spec vs implementation. Find what is missing.
     |
     v
  Commit (only after ALL gates pass)
     |
     v
  Pull Request --> Greptile Score Loop ------------------------- BLOCKER
     |
     v
  Merge
```

### Pipeline Enforcement

The pipeline is **enforced**, not advisory. Three mechanisms prevent ungated code from being committed:

| Mechanism | Type | What It Does |
|-----------|------|-------------|
| **Post-edit reminder** | Claude Code PostToolUse hook | After every file edit, injects a reminder about required gates into the conversation |
| **Commit gate** | Claude Code PreToolUse hook + git pre-commit hook | **Blocks `git commit`** if required gates haven't passed |
| **Session check** | Claude Code Stop hook | Warns when ending a session with incomplete gates |

**Checkpoint system:** Pipeline state is tracked in `/tmp/pipeline-state-{repo}-{branch}.json`. Each gate agent records its result via `pipeline-gate.sh`. The commit gate reads this file to decide whether to allow or block.

**Emergency override:** `SKIP_PIPELINE_CHECK=1 git commit -m "message"` bypasses the gate (use sparingly).

```
Edit code
   |
   v
PostToolUse hook tracks files + reminds about gates
   |
   v
Run gate agents (anti-slop, devil's advocate, gap analysis, UI validation)
   |
   v
Each agent records result via pipeline-gate.sh
   |
   v
commit_allowed = true when all gates pass
   |
   v
git commit unblocked
```

### The Anti-Slop Gate (Bidirectional)

The anti-slop gate is the core innovation. It works in both directions:

```
  Claude writes code                        Codex writes code
        |                                         |
        v                                         v
  Send to Codex for scoring              Send to Claude for scoring
        |                                         |
        v                                         v
  codex exec -m gpt-5.4                   claude -p --model opus
  "Score this for AI slop"               "Score this for AI slop"
        |                                         |
        v                                         v
  VERDICT: PASS (>= 7) or FAIL          VERDICT: PASS (>= 7) or FAIL
        |                                         |
        v                                         v
  If FAIL: fix + rescore (max 3x)        If FAIL: fix + rescore (max 3x)
```

---

## Agent Reference

### Claude Code Agents (delegate to Codex)

These are Markdown files installed to `~/.claude/agents/`. When invoked inside Claude Code, they shell out to `codex exec` to get GPT-5.4's perspective.

| Agent | File | Mode | Purpose |
|-------|------|------|---------|
| `codex-reviewer` | `codex-reviewer.md` | read-only | Adversarial code/plan review. Groups findings by CRITICAL/WARNING/NIT. Supports multi-turn deep dives via `codex --resume`. |
| `codex-devils-advocate` | `codex-devils-advocate.md` | read-only | Relentless adversarial challenger. Finds FATAL FLAWS, BLIND SPOTS, WEAK ASSUMPTIONS, and ALTERNATIVES. |
| `codex-architect` | `codex-architect.md` | read-only | Cross-model architecture review. Evaluates structural integrity, scaling bottlenecks, data architecture, API design, and dependency risks. Scores architecture 1-10. |
| `codex-frontend` | `codex-frontend.md` | read-only or write | Frontend specialist with anti-slop design principles. Reviews or implements components with GPT-5.4's design perspective. |
| `codex-backend` | `codex-backend.md` | write | Backend implementation via Codex. Handles API design, data models, auth flows, concurrency, and migrations. |
| `codex-gap-analyst` | `codex-gap-analyst.md` | read-only | Systematic gap detection. Compares spec vs implementation across 10 dimensions. Classifies gaps as P0/P1/P2. |
| `codex-qa` | `codex-qa.md` | read-only or write | Unbiased QA from a different model than the code author. Generates concrete test cases for coverage gaps, edge cases, and error paths. |
| `codex-security` | `codex-security.md` | read-only | Independent security audit. OWASP Top 10 + JWT, CORS, rate limiting, file upload, WebSocket checks. Includes CWE IDs. |
| `codex-anti-slop` | `codex-anti-slop.md` | read-only | **BLOCKER gate.** Sends Claude's code to Codex for cross-model slop scoring. Score >= 7 to pass. Loops up to 3 rounds. |
| `codex-ui-validator` | `codex-ui-validator.md` | read-only | **BLOCKER gate.** Auto-triggers on frontend files. Sends Claude's UI code to Codex for cross-model UI validation + browser testing. |

### Codex Agents (delegate to Claude)

These are TOML files installed to `~/.codex/agents/`. When invoked inside Codex CLI, they shell out to `claude -p --model opus` to get Opus's perspective.

| Agent | File | Mode | Purpose |
|-------|------|------|---------|
| `claude-reviewer` | `claude-reviewer.toml` | read-only | Adversarial review via Opus. Iterative loop with VERDICT: APPROVED/REVISE. Pre-gathers context via Auggie + GitNexus. |
| `claude-devils-advocate` | `claude-devils-advocate.toml` | read-only | Ruthless adversarial challenge via Opus. Groups as FATAL FLAWS / BLIND SPOTS / WEAK ASSUMPTIONS / ALTERNATIVES. |
| `claude-architect` | `claude-architect.toml` | read-only | Architecture assessment via Opus. Always escalates to council on disagreements -- architecture is where cross-model debate adds the most value. |
| `claude-frontend` | `claude-frontend.toml` | write | Frontend implementation/review via Opus with anti-slop design philosophy. Enforces no generic templates, accessible by default. |
| `claude-frontend-design` | `claude-frontend-design.toml` | write | **Full design + implementation via Opus.** Superior visual hierarchy, spacing, typography, animation decisions. Includes anti-slop principles and design system enforcement. |
| `claude-marketing` | `claude-marketing.toml` | write | **Marketing copy and content via Opus.** Landing pages, email sequences, ad copy, content strategy. More natural, human-sounding, persuasive writing. |
| `claude-gap-analyst` | `claude-gap-analyst.toml` | read-only | Gap analysis via Opus across 10 dimensions. Returns a gap matrix with priority and impact. |
| `claude-qa` | `claude-qa.toml` | read-only | QA assessment via Opus. Reviews code written by GPT-5.4 with zero trust -- assumes bugs exist until proven otherwise. |
| `claude-security` | `claude-security.toml` | read-only | Security audit via Opus. OWASP Top 10 + additional checks. White-box audit with attack vectors and CWE IDs. |
| `anti-slop` | `anti-slop.toml` | read-only | **BLOCKER gate (Codex side).** Sends Codex's code to Claude for cross-model slop scoring. Same formula, same threshold. |
| `ui-validator` | `ui-validator.toml` | read-only | **BLOCKER gate (Codex side).** Auto-triggers on frontend files. Sends Codex's UI code to Claude for cross-model UI validation + browser testing. |

### Codex Orchestration Agents

These Codex agents handle workflow orchestration with built-in cross-model review.

| Agent | File | Mode | Purpose |
|-------|------|------|---------|
| `planner` | `planner.toml` | read-only | Planning with mandatory Claude review. Every plan goes through iterative cross-model review (max 5 rounds). Auto-escalates architecture tradeoffs to council. |
| `executor` | `executor.toml` | write | Implementation with anti-slop discipline. Code goes through anti-slop gate, devil's advocate, and gap analysis post-implementation. |
| `reviewer` | `reviewer.toml` | read-only | Strict review agent. Findings ordered by severity with file/line references. |
| `council` | `council.toml` | read-only | Multi-model deliberation. Facilitates structured debate between GPT-5.4 and Opus with rebuttal rounds and synthesis. |
| `default` | `default.toml` | write | General-purpose with anti-slop discipline baked in. |
| `backend` | `backend.toml` | write | Backend specialist with anti-slop discipline. Favors correctness, explicit contracts, and failure-mode handling. |
| `frontend` | `frontend.toml` | write | Frontend specialist with anti-slop discipline. Enforces accessibility, responsive behavior, and visual correctness. Uses shadcn/ui MCP for component reference. |

---

## Skills Reference (Claude Code)

### `/codex-review` -- Adversarial Plan Review

Send the current plan or implementation to Codex for adversarial review. Runs an iterative loop (max 5 rounds) where Codex critiques and Claude revises until the plan is approved.

```
# Invoke in Claude Code
/codex-review
/codex-review o4-mini    # optional model override
```

**Flow:** Capture plan --> Submit to Codex --> Parse VERDICT --> If REVISE: revise + resubmit --> Repeat until APPROVED or 5 rounds

### `/council` -- Multi-Model Deliberation

Structured debate between Claude Opus and GPT-5.4. Both models take positions, argue through rebuttal rounds, and synthesize a consensus (or identify irreconcilable tradeoffs).

```
# Invoke in Claude Code
/council Should we use microservices or a monolith?
/council Is server-side rendering worth the complexity for this app?
```

**Flow:**
1. Frame the question
2. Both models take clear positions (no hedging)
3. Up to 3 rebuttal rounds (each model must concede where the other is right)
4. Synthesis with validation
5. Council Decision: consensus, agreements, disagreements, confidence level

**Output includes:** Concession counts, resolved debates, remaining tradeoffs, and the key insight that emerged from debate (the thing neither model would have found alone).

### `/delegate` -- Team Coordinator Mode

Scan the agent/skill inventory, create a team, and delegate all work. You become the coordinator -- never implementing directly.

```
# Invoke in Claude Code
/delegate
```

**Flow:** Scan inventory --> Break task into work units --> Create team --> Spawn agents in parallel --> Coordinate --> Report

**Cross-model routing rules:**
- Reviews, security, QA, gap analysis --> always cross-model
- Frontend design, marketing copy --> always Claude (domain strength)
- Simple CRUD, bug fixes --> no cross-model needed

---

## Anti-Slop Scoring

The anti-slop gate hunts for 10 specific patterns of AI-generated code bloat. Each file is scored independently.

### Formula

```
SCORE = 10 - (critical_violations * 3) - (moderate_violations * 1) - (minor_violations * 0.5)

PASS = score >= 7
FAIL = score < 7 (BLOCKED -- must fix and rescore, max 3 rounds)
```

### The 10 Patterns

| # | Pattern | Severity | What It Catches |
|---|---------|----------|-----------------|
| 1 | Over-Engineered Abstractions | **Critical** (-3) | Factory/Builder/Strategy for something used once. Interfaces nobody implements. |
| 2 | Premature Helpers | **Critical** (-3) | Utility functions longer than the code they replace. Abstraction for 3 similar lines. |
| 3 | Comment-Restates-Code | Minor (-0.5) | `// increment counter` above `counter++`. Comments describing WHAT not WHY. |
| 4 | Wrapper-for-Wrapper | **Critical** (-3) | `fetchData()` calls `getData()` calls `api.get()`. Three layers of indirection for one HTTP call. |
| 5 | Kitchen-Sink Error Handling | Moderate (-1) | try/catch around code that cannot throw. Generic `catch(e) { console.log(e) }`. |
| 6 | Template Paste | **Critical** (-3) | Tutorial code pasted without adapting to the actual use case. Cookie-cutter structure. |
| 7 | Type Gymnastics | Moderate (-1) | `Omit<Pick<Partial<T>, K>, E>` where `{ name: string }` works. TypeScript harder to read than JavaScript. |
| 8 | Unnecessary State | Moderate (-1) | useState for derived values. Redux for a boolean. React context for a prop. |
| 9 | Dead Weight | Minor (-0.5) | Unused imports, always-true conditions, commented-out code, parameters never passed. |
| 10 | Verbose > Clear | Minor (-0.5) | 20 lines where 5 is both shorter AND clearer. |

### Scoring Examples

- **1 critical violation** = score 7 (barely passes)
- **2 critical violations** = score 4 (BLOCKED)
- **1 critical + 2 moderate** = score 5 (BLOCKED)
- **3 minor violations** = score 8.5 (passes)
- **Clean code** = score 10

---

## UI Validation Gate

When frontend files are changed (`.tsx`, `.jsx`, `.css`, `.vue`, `.svelte`), the UI validation gate **auto-triggers**. Like anti-slop, it's cross-model and uses the same scoring formula.

### Two-Phase Validation

```
Phase 1: Cross-Model Code Review
   Claude code --> Codex scores UI quality
   Codex code --> Claude scores UI quality

Phase 2: Browser Validation (agent-browser CLI)
   Desktop viewport (1920x1080) --> screenshot + console check
   Mobile viewport (390x844)    --> screenshot + console check
   Check: no layout breaks, no console errors, states render correctly
```

### The 10 UI Patterns

| # | Pattern | Severity | What It Catches |
|---|---------|----------|-----------------|
| 1 | Missing UI States | **Critical** (-3) | No loading, error, empty, or skeleton states. Users see blank screens. |
| 2 | No Accessibility | **Critical** (-3) | Missing ARIA labels, no keyboard nav, no focus management, bad contrast. |
| 3 | Not Responsive | **Critical** (-3) | Hardcoded widths, no mobile breakpoints, overflow, small touch targets. |
| 4 | Generic AI Aesthetics | **Critical** (-3) | Inter/Roboto fonts, default blue (#3B82F6), purple gradients on white, lorem ipsum. |
| 5 | Design System Bypass | Moderate (-1) | Raw HTML where tokens exist, inline styles, wrong spacing scale. |
| 6 | God Components | Moderate (-1) | 300+ line components mixing data fetching, logic, and presentation. |
| 7 | No User Feedback | Moderate (-1) | Async actions with no visual feedback. User clicks, nothing happens. |
| 8 | No Reduced-Motion | Minor (-0.5) | Animations without `prefers-reduced-motion`. Fails WCAG 2.3.3. |
| 9 | Inconsistent Spacing | Minor (-0.5) | Mix of arbitrary px values and design tokens. Visual rhythm is off. |
| 10 | No Error Boundaries | Minor (-0.5) | Async UI sections without error boundaries. One failure crashes the page. |

### Agents

| Agent | Side | Purpose |
|-------|------|---------|
| `ui-validator` | Codex (sends to Claude) | Validates Codex's frontend work via Opus |
| `codex-ui-validator` | Claude Code (sends to Codex) | Validates Claude's frontend work via GPT-5.4 |

---

## Model Strengths

The routing is asymmetric by design. Each model has genuine strengths the other lacks.

| Domain | Best Model | Why |
|--------|-----------|-----|
| Backend, architecture, systems | **GPT-5.4** | Stronger at logic, concurrency, API design, mathematical reasoning |
| Frontend design, UI/UX | **Opus** | Superior visual hierarchy, spacing, typography, anti-slop design sensibility |
| Marketing copy, content | **Opus** | More natural, human-sounding, persuasive writing |
| Code review, gap analysis | **Cross-model** | Different model = unbiased review, no self-confirmation |
| Security audit | **Cross-model** | Separate model will not overlook its own security assumptions |
| QA, testing | **Cross-model** | No confirmation bias from the code author |
| Architecture debate | **Cross-model** | GPT-5.4 favors microservices/event-driven; Opus favors pragmatic monoliths. The disagreement reveals the real decision. |

### Routing Rules

- **Both models** auto-delegate reviews, security, QA, and gap analysis (cross-model = unbiased)
- **Only Codex** auto-delegates design and marketing to Opus (domain strength)
- **Neither model** delegates simple CRUD, bug fixes, or explicitly assigned tasks

---

## Installation

### Prerequisites

You need active subscriptions to both AI coding tools:

| Tool | Subscription | Auth Command |
|------|-------------|--------------|
| [Claude Code](https://docs.claude.com/en/docs/claude-code) | Claude MAX or Anthropic API key | `claude auth login` |
| [Codex CLI](https://github.com/openai/codex) | Codex Pro or OpenAI API key | `codex login` |

Both CLIs must be installed, authenticated, and working before proceeding.

### Quick Install (Recommended)

```bash
git clone https://github.com/Dallionking/cross-model-agents.git
cd cross-model-agents
./scripts/install.sh
```

The installer is **interactive** and walks you through 5 phases:

1. **Prerequisites** -- checks that Claude Code and/or Codex CLI are installed and authenticated
2. **Core agents** -- symlinks agent files to `~/.claude/agents/` and `~/.codex/agents/` (with backup of existing agents). Use `--copy` flag for portable copies instead of symlinks.
3. **Pipeline enforcement** -- installs pipeline checkpoint scripts to `~/.local/bin/` and a git pre-commit hook to `~/.githooks/`
4. **Optional CLI tools** -- asks if you want `agent-browser` (for UI validation) and `shadcn/ui` CLI
5. **Optional MCP servers** -- lists each MCP with a description, asks if you want it, and guides API key setup

No MCPs are installed without your consent. Agents gracefully skip unavailable MCPs.

### What Gets Installed

| Component | Count | Location |
|-----------|-------|----------|
| Claude Code agents | 10 | `~/.claude/agents/` (symlinked) |
| Claude Code skills | 3 | `~/.claude/skills/` |
| Codex agents | 21 | `~/.codex/agents/` (symlinked) |
| Pipeline scripts | 8 | `~/.local/bin/` (symlinked) |
| Git pre-commit hook | 1 | `~/.githooks/pre-commit` |

### Optional MCP Servers

These are offered during install. All are optional -- agents work without them.

| MCP | API Key? | Purpose |
|-----|----------|---------|
| Auggie (codebase-retrieval) | No | Semantic codebase search |
| GitNexus | No | Dependency graphs, impact analysis |
| Ref | No | Framework/library documentation |
| Context7 | No | Library docs lookup |
| Sequential Thinking | No | Multi-step reasoning |
| shadcn/ui | No | UI component browsing |
| EXA | Yes | Semantic web search |
| Firecrawl | Yes | Web scraping/crawling |
| Greptile | Yes | AI code review, PR scoring |

### Manual Install

If you prefer to copy files yourself:

```bash
# Claude Code agents and skills (symlinks recommended)
for f in claude-code/agents/*.md; do ln -sf "$(pwd)/$f" ~/.claude/agents/; done
cp -r claude-code/skills/* ~/.claude/skills/

# Codex agents
mkdir -p ~/.codex/agents
for f in codex/agents/*.toml; do ln -sf "$(pwd)/$f" ~/.codex/agents/; done

# Pipeline scripts
mkdir -p ~/.local/bin
for f in scripts/pipeline/*.sh; do chmod +x "$f" && ln -sf "$(pwd)/$f" ~/.local/bin/; done

# Or use copies instead of symlinks:
# cp claude-code/agents/*.md ~/.claude/agents/
# cp codex/agents/*.toml ~/.codex/agents/
```

### Uninstall

```bash
./scripts/uninstall.sh
```

Removes all agents and skills. MCP servers are left intact (remove manually if needed).

### Post-Install

Restart both Claude Code and Codex CLI for the new agents/skills to take effect.

---

## Usage

### From Claude Code

**Adversarial review** -- send your plan to Codex for critique:
```
/codex-review
```

**Multi-model debate** -- Claude and Codex argue to consensus:
```
/council Should we use WebSockets or SSE for real-time updates?
```

**Delegate everything** -- become coordinator, agents do the work:
```
/delegate
```

**Spawn a specific Codex-powered agent:**
```
Use the codex-reviewer agent to review my auth implementation
Use the codex-security agent to audit this payment flow
Use the codex-architect agent to evaluate our database schema
```

### From Codex

**Delegate design to Claude** -- Codex orchestrates, Opus designs:
```
@claude-frontend-design Build the dashboard layout using our design system
```

**Delegate copy to Claude** -- Codex orchestrates, Opus writes:
```
@claude-marketing Write the launch email sequence for our new feature
```

**Get Claude's adversarial review:**
```
@claude-reviewer Review my API implementation plan
```

**Run a multi-model council:**
```
@council Should we use a queue or direct API calls for webhook processing?
```

**Plan with auto-review:**
```
@planner Build a user onboarding flow with email verification
```
The planner agent automatically sends the plan to Claude for iterative review before presenting it.

### Example: Full Pipeline in Practice

Here is what happens when you ask Codex to build a feature:

```
1. @planner drafts the plan
2. Plan auto-sent to Claude for review (up to 5 rounds)
3. @executor implements the approved plan
4. @anti-slop sends code to Claude for slop scoring
   --> Score: 6/10 (FAIL) -- "wrapper-for-wrapper in auth.ts"
   --> @executor fixes the violation
   --> @anti-slop re-scores: 8/10 (PASS)
5. @claude-devils-advocate challenges assumptions
6. @claude-gap-analyst checks for missing requirements
7. Commit + PR
8. Greptile reviews the PR
9. Merge
```

---

## Configuration

### Config Files

| File | Location | Purpose |
|------|----------|---------|
| Agent definitions (Claude) | `~/.claude/agents/*.md` | Markdown files defining each agent's role, workflow, and constraints |
| Skill definitions (Claude) | `~/.claude/skills/*/SKILL.md` | Skill files triggered by `/command` syntax |
| Agent definitions (Codex) | `~/.codex/agents/*.toml` | TOML files with model, sandbox_mode, and developer_instructions |
| Codex config | `~/.codex/config.toml` | Global Codex settings (model, reasoning effort, etc.) |
| Claude config | `~/.claude/settings.json` | Claude Code settings, hooks, MCP servers |
| Pipeline checkpoint | `/tmp/pipeline-state-{repo}-{branch}.json` | Tracks which gates have passed in the current session |
| Pipeline scripts | `~/.local/bin/pipeline-*.sh` | Enforcement scripts (symlinked from repo) |
| Git hooks | `~/.githooks/pre-commit` | Blocks commits without completed gates |
| Auto-routing rules | Your `CLAUDE.md` and `instructions.md` | Project or global instructions that trigger auto-delegation |

### Codex Agent TOML Format

Every Codex agent follows this structure:

```toml
model = "gpt-5.4"
model_reasoning_effort = "xhigh"
sandbox_mode = "read-only"  # or "workspace-write"
developer_instructions = """
Your agent instructions here.
"""
```

### Claude Code Agent Markdown Format

Claude Code agents are Markdown files with structured sections:

```markdown
# Agent Name

Role description.

## Workflow

### 1. Gather Context
### 2. Delegate to Codex
### 3. Report Findings

## Constraints
```

### Auto-Routing Configuration

To enable automatic cross-model delegation (agents trigger without manual invocation), add routing rules to your global config files. See [docs/auto-routing.md](docs/auto-routing.md) for the complete configuration.

**Key sections to add:**
- `~/.claude/CLAUDE.md` -- Cross-Model Auto-Delegation table
- `~/.codex/instructions.md` -- Mandatory delegation rules for design/marketing
- Both files -- Auto-Delegate Plan Mode (coordinator-only)

---

## MCP Requirements

### Required

| MCP Server | Purpose | Install |
|------------|---------|---------|
| `codex-mcp-server` | Allows Claude Code to invoke Codex CLI as a tool | `claude mcp add codex -- npx -y codex-mcp-server` |

### Optional (Enhance Agent Capabilities)

Agents will use these if available and skip gracefully if not:

| MCP Server | Purpose | Used By |
|------------|---------|---------|
| **Auggie** (codebase-retrieval) | Semantic codebase search. Catches cross-file references that grep misses. | planner, reviewer, council, gap-analyst, all Codex agents |
| **GitNexus** | Dependency graph analysis, impact assessment, cross-file reference tracing. | architect, planner, gap-analyst, all Codex agents |
| **EXA** | Web research for patterns, trends, CVEs, and real-world failures. | devils-advocate, architect, security, QA |
| **shadcn/ui** | Component library reference for frontend agents. | frontend, claude-frontend, claude-frontend-design |
| **Greptile** | Automated PR review and scoring (used in the PR gate). | Post-commit pipeline |

---

## How It Works Under the Hood

### Claude Code --> Codex

Claude Code agents delegate to Codex via the CLI:

```bash
codex exec \
  -m gpt-5.4 \
  -s read-only \
  --skip-git-repo-check \
  "<prompt with context>"
```

- `-m gpt-5.4` selects the model
- `-s read-only` prevents file modifications (use `workspace-write` for implementation agents)
- `--skip-git-repo-check` is used when not inside a git repo
- Authentication uses your Codex Pro subscription (no API key needed)

### Codex --> Claude

Codex agents delegate to Claude via the CLI:

```bash
env -u CLAUDECODE claude -p --model opus --dangerously-skip-permissions \
  "<prompt with context>"
```

- `env -u CLAUDECODE` -- unsets the env var to prevent nested Claude Code detection
- `-p` -- pipe mode (non-interactive)
- `--model opus` -- selects Claude Opus
- `--dangerously-skip-permissions` -- required for non-interactive execution
- Authentication uses your Claude MAX subscription (no API key needed)

### Council Protocol

The council protocol works the same from both sides:

```
Phase 0: Frame the question
Phase 1: Both models take clear, opinionated positions (no hedging)
Phase 2: Up to 3 rebuttal rounds
          - Each model must CONCEDE where the other is right
          - Each model must COUNTER-ARGUE where the other is wrong
          - Positions UPDATE after each round
Phase 3: Synthesis (merged recommendation + validation)
Phase 4: Council Decision with confidence level
          FULL CONSENSUS / PARTIAL CONSENSUS / DEADLOCK
```

---

## Test Results

All 26 agents have been tested bidirectionally. See [test-logs/TEST-REPORT.md](test-logs/TEST-REPORT.md) for the full report.

### Summary (2026-03-07)

| Direction | Tested | Passed | Result |
|-----------|--------|--------|--------|
| Claude Code --> Codex | 8 agents | 8 | **100%** |
| Codex --> Claude | 9 agents | 9 | **100%** |
| **Total** | **17 agents** | **17** | **100%** |

### Key Observations

- GPT-5.4 reviews were substantive with specific, actionable findings (not generic advice)
- Opus produced 11 detailed, opinionated design decisions for a single toast component
- Opus marketing copy was natural and in-brand (not generic marketing-speak)
- `codex exec` adds ~15s overhead per call (acceptable for quality gates)
- Running 4+ `claude -p` calls in parallel can stall; sequential is more reliable

---

## Project Structure

```
cross-model-agents/
  assets/
    banner.png                   # Repo banner image
  claude-code/
    agents/                    # Claude Code agent definitions (.md)
      codex-anti-slop.md
      codex-architect.md
      codex-backend.md
      codex-devils-advocate.md
      codex-frontend.md
      codex-gap-analyst.md
      codex-qa.md
      codex-reviewer.md
      codex-security.md
      codex-ui-validator.md
    skills/                    # Claude Code skills (slash commands)
      codex-review/SKILL.md
      council/SKILL.md
      delegate/SKILL.md
  codex/
    agents/                    # Codex agent definitions (.toml)
      anti-slop.toml
      backend.toml
      claude-architect.toml
      claude-devils-advocate.toml
      claude-frontend.toml
      claude-frontend-design.toml
      claude-gap-analyst.toml
      claude-marketing.toml
      claude-qa.toml
      claude-reviewer.toml
      claude-security.toml
      council.toml
      default.toml
      executor.toml
      explorer.toml
      frontend.toml
      planner.toml
      reviewer.toml
      security.toml
      tester.toml
      ui-validator.toml
  docs/
    auto-routing.md            # Auto-delegation configuration guide
  scripts/
    install.sh                 # One-command installation
    uninstall.sh               # Clean removal
    verify-install.sh            # Check installation integrity
    pipeline/                  # Pipeline enforcement scripts
      pipeline-init.sh           # Initialize checkpoint
      pipeline-gate.sh           # Record gate results
      pipeline-check.sh          # Verify gates passed
      pipeline-reset.sh          # Clean up after commit
      track-file-change.sh       # Track modified files
      post-edit-reminder.sh      # PostToolUse hook
      pre-commit-gate.sh         # PreToolUse commit gate
      stop-gate.sh               # Stop hook
  test-logs/                   # Bidirectional test results (gitignored)
    TEST-REPORT.md
  .github/
    ISSUE_TEMPLATE/
      bug_report.md
      feature_request.md
    PULL_REQUEST_TEMPLATE.md
    workflows/
      validate.yml             # CI: TOML/MD validation
  CODE_OF_CONDUCT.md
  CONTRIBUTING.md
  LICENSE
  README.md
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key things to know:
- Agent definitions are plain text (Markdown for Claude, TOML for Codex) -- no build step
- Agents are installed as **symlinks** by default -- changes to the source files are immediately reflected
- Run `scripts/verify-install.sh` to check that installed agents are in sync with the source
- The install script (`scripts/install.sh`) copies files to global config directories
- Test by running agents manually and checking that cross-model delegation works
- All agents should degrade gracefully when optional MCP tools are unavailable
- The anti-slop scoring formula is non-negotiable (it is the core quality gate)
- The pipeline enforcement scripts (`scripts/pipeline/`) gate commits -- do not weaken their checks

---

## License

[MIT](LICENSE)
