# Usage Guide

How to actually use Cross-Model Adversarial Agents in your day-to-day work — what each piece does, when to invoke it, and what gates block what.

For installation, see [README.md](../README.md#installation). For the product spec, see [PRD.md](./PRD.md). For changes, see [CHANGELOG.md](../CHANGELOG.md).

---

## The mental model

The system is a **chain of blocking gates** between "plan" and "merge". Each gate runs in the *other* model from the one that wrote the code, so Claude's blind spots get caught by Codex and vice versa.

```
Plan ─→ /codex-review ─→ Implement ─→ Anti-Slop ─→ UI Validation ─→
        Devil's Advocate ─→ Gap Analysis ─→ Commit ─→ GitHub Status ─→ PR ─→ Merge
```

Each `─→` is a gate. Gates record their result in `.pipeline/state-<branch>.json`. The git pre-commit hook reads that file and blocks `git commit` until every required gate has passed (or you've explicitly bypassed with a logged reason).

---

## 1. Plan Review — `/codex-review`

You write a plan. Codex reads it and tries to break it. Iterates up to 5 rounds until Codex says APPROVED or you bypass.

**Catches:** missing edge cases, wrong abstractions, things you didn't think about.

**When to use:** before writing code on any non-trivial task.

```
/codex-review
```

---

## 2. `/council` — Multi-Model Debate

For decisions, not code. Claude and Codex each take a position, rebut each other up to 3 rounds, then output **FULL CONSENSUS / PARTIAL CONSENSUS / DEADLOCK** with reasoning.

**When to use:** architectural forks where you genuinely don't know which path is right.

```
/council Should we use SSR or CSR for the dashboard?
/council Stripe Connect vs separate Stripe accounts per tenant?
/council Postgres JSONB column vs separate table for user preferences?
```

---

## 3. `/delegate` — Coordinator Mode

Scans the agent/skill inventory, creates a team via `TeamCreate`, spawns agents in worktree-isolated parallel runs. You stay coordinator and review their outputs.

**When to use:** large multi-file changes that fan out naturally (e.g., "audit every API route for auth", "add telemetry to all background jobs").

```
/delegate
```

---

## 4. Implementation

You (or Claude) write the code. No gate here, just edits. A `PostToolUse` hook fires after every file edit reminding you which gates still need to run on the changed files. The hook does *not* block — it nags.

---

## 5. Anti-Slop Gate — the headline feature

Every changed file is scored by a **worker model in the other provider** (gpt-5.4-mini if you wrote it in Claude; Haiku 4.5 if you wrote it in Codex). One worker per file, parallel fan-out.

Scoring formula:

```
SCORE = 10 − (critical × 3) − (moderate × 1) − (minor × 0.5)
PASS  = score ≥ 7
FAIL  = fix + rescore, max 2 rounds
```

The 10 patterns it hunts for:

| # | Pattern | Severity |
|---|---|---|
| 1 | Over-Engineered Abstractions | Critical (−3) |
| 2 | Premature Helpers | Critical (−3) |
| 3 | Comment-Restates-Code | Minor (−0.5) |
| 4 | Wrapper-for-Wrapper | Critical (−3) |
| 5 | Kitchen-Sink Error Handling | Moderate (−1) |
| 6 | Template Paste | Critical (−3) |
| 7 | Type Gymnastics | Moderate (−1) |
| 8 | Unnecessary State | Moderate (−1) |
| 9 | Dead Weight | Minor (−0.5) |
| 10 | Verbose > Clear | Minor (−0.5) |

**When it fires:** after implementation, before commit. **Blocks `git commit`** until passed.

```
Use the codex-anti-slop agent to score my changes.
```

---

## 6. UI Validation Gate

Auto-triggers when frontend files change (`.tsx`, `.jsx`, `.css`, `.vue`, `.svelte`). Same scoring formula, different 10 patterns:

| # | Pattern | Severity |
|---|---|---|
| 1 | Missing UI States (loading/error/empty/skeleton) | Critical (−3) |
| 2 | No Accessibility | Critical (−3) |
| 3 | Not Responsive | Critical (−3) |
| 4 | Generic AI Aesthetics (Inter + #3B82F6 + purple gradient) | Critical (−3) |
| 5 | Design System Bypass | Moderate (−1) |
| 6 | God Components | Moderate (−1) |
| 7 | No User Feedback on async actions | Moderate (−1) |
| 8 | No `prefers-reduced-motion` | Minor (−0.5) |
| 9 | Inconsistent Spacing | Minor (−0.5) |
| 10 | No Error Boundaries | Minor (−0.5) |

Plus a Phase 2: spins up `agent-browser` CLI to screenshot desktop (1920×1080) and mobile (390×844) viewports and read console errors.

---

## 7. Devil's Advocate — frontier model challenge

Runs at the **frontier tier** (Opus 4.7 or GPT-5.5, whichever is the *other* provider). One shot, no fan-out. Job: challenge every assumption in the implementation. "Why this approach? What happens if X? What about Y edge case?"

This is the gate that catches strategic-level mistakes, not stylistic ones.

```
Use the codex-devils-advocate agent to challenge this implementation.
```

---

## 8. Gap Analysis — spec vs implementation

Runs at the **fallback tier** (Sonnet 4.6 / GPT-5.4). Compares the original plan/spec to what was actually built, across 10 dimensions. Catches: forgotten requirements, scope drift, half-implemented features.

```
Use the codex-gap-analyst agent to check spec vs implementation.
```

---

## 9. Commit gate — the enforcement layer

Three mechanisms ensure ungated code cannot be committed:

| Layer | Mechanism | What it does |
|---|---|---|
| **Post-edit reminder** | Claude Code `PostToolUse` hook | Nags after each edit |
| **Commit gate** | Claude `PreToolUse` hook + git `pre-commit` hook | **Blocks `git commit`** |
| **Session check** | Claude Code `Stop` hook | Warns if you end the session with gates incomplete |

State lives in `.pipeline/state-<branch>.json` (project root, gitignored). Atomic writes + file locking prevent parallel gates from clobbering each other.

Inspect state any time:

```bash
node pipeline.js status            # human-readable
node pipeline.js status --json     # machine-readable
```

---

## 10. GitHub commit statuses

Once gates pass and you commit, publish the results so they appear on the PR:

```bash
node pipeline.js publish
```

Posts each gate as a GitHub commit status (`pipeline/anti_slop`, `pipeline/devils_advocate`, etc.). Greptile review runs on top of that. Then merge.

Pull GitHub statuses back into local state (useful when reviewing a PR on a different machine):

```bash
node pipeline.js fetch
```

---

## Bypass — for when you really must skip

Two paths, both audited:

```bash
# Recommended — explicit subcommand
node pipeline.js bypass --reason "hotfix for prod outage at 02:14 PT"
git commit -m "..."

# Or env-var on the commit itself
SKIP_PIPELINE_CHECK=1 PIPELINE_BYPASS_REASON="ci: shadow run, gates n/a" \
  git commit -m "..."
```

Rules:
- Reason is **mandatory** and must be ≥12 chars.
- 30-minute window per bypass.
- Logged to `.pipeline/logs/<date>.jsonl` with your email (from `git config user.email`), branch, reason, timestamp.

Query all bypasses on a repo:

```bash
node pipeline.js log --event commit_bypassed
```

---

## Model routing (config-driven)

| Gate | Tier | Why this tier |
|---|---|---|
| anti-slop, ui-validation | **worker** (Haiku 4.5 / gpt-5.4-mini) | Embarrassingly parallel per-file; doesn't need frontier IQ |
| devil's-advocate, architect | **frontier** (Opus 4.7 / GPT-5.5) | Strategic reasoning matters |
| gap-analysis | **fallback** (Sonnet 4.6 / GPT-5.4) | 10-dimension diff is mechanical; save the budget |

All of it lives in `config.json` under `routing.gates`. To add a new provider (Gemini, etc.), add one block to `providers{}` and reference it in `routing.gates.<gate>.scorer`. No code changes.

---

## A full session in practice

```
1. Open a new branch:    git checkout -b feature/auth
2. Draft a plan in chat.
3. /codex-review                              → APPROVED after 2 rounds
4. Implement (Claude does the edits).
5. Use the codex-anti-slop agent.             → 6/10 fail on auth.ts (wrapper-for-wrapper)
6. Fix it. Rescore.                           → 8/10 pass
7. Use the codex-devils-advocate agent.       → completed, no blockers
8. Use the codex-gap-analyst agent.           → completed, no blockers
9. node pipeline.js check                     → exit 0
10. git commit                                → unblocked
11. node pipeline.js publish                  → statuses appear on PR
12. Greptile reviews                          → green
13. Merge.
```

---

## Daily commands cheatsheet

```bash
# Health check the install
node pipeline.js doctor

# See what gates still need to run
node pipeline.js status

# Manually mark a gate result (rarely needed; agents do this)
node pipeline.js gate anti_slop passed 8.5 1

# Track a file you've changed
node pipeline.js track src/auth.ts

# View structured event log
node pipeline.js log --last 20

# Reset state on the current branch
node pipeline.js reset

# Reset everything
node pipeline.js reset --all
```

---

## Slash commands (Claude Code) cheatsheet

```
/codex-review           Adversarial review of the current plan (max 5 rounds)
/council <question>     Parallel Claude/Codex debate (max 3 rounds)
/delegate               Coordinator mode — spawn worktree-isolated agents
/pipeline-doctor        Run health check and walk through fixes
/pipeline-doctor --fix  Same, but apply remediations after confirmation
```

---

## Codex agents you can summon from Claude Code

```
Use the codex-reviewer agent to review my code.
Use the codex-devils-advocate agent to challenge my approach.
Use the codex-anti-slop agent to score this file.
Use the codex-ui-validator agent to score this component.
Use the codex-security agent to audit this auth flow.
Use the codex-gap-analyst agent to compare spec vs implementation.
Use the codex-architect agent for system design review.
Use the codex-frontend agent for frontend review.
Use the codex-backend agent for backend review.
Use the codex-qa agent for test coverage and quality review.
```

---

## Claude agents you can summon from Codex CLI

```
@claude-reviewer Review my implementation.
@claude-devils-advocate Challenge this approach.
@claude-architect Review this system design.
@claude-frontend-design Build this layout. (Opus design strength)
@claude-marketing Write this launch copy. (Opus copy strength)
@claude-gap-analyst Compare spec vs implementation.
@claude-security Audit this auth flow.
@claude-qa Review test coverage.
@claude-frontend Frontend review.
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `git commit` proceeds without gates | `node pipeline.js doctor` — likely `core.hooksPath` not set. Re-run installer. |
| Cross-model calls hang | Codex CLI or `codex-mcp-server` not installed. `node pipeline.js doctor` will say so. |
| Pre-commit hook never fires | `git config --global core.hooksPath ~/.githooks` (installer should have done this) |
| State seems stale after switching branches | `node pipeline.js reset` |
| Gate result inconsistent across machines | `node pipeline.js fetch` to pull GitHub statuses back into local state |
| Need to ship right now, gates failing | `node pipeline.js bypass --reason "<≥12 chars>"` then commit |

If `pipeline.js doctor` doesn't surface the issue, open one of the log files in `.pipeline/logs/<date>.jsonl` and grep for `"event":"error"`.
