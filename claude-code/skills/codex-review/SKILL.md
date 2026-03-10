---
version: 2.0.0
description: "Iterative adversarial plan review via Codex GPT-5.4"
requires: [codex-mcp-server]
---

# /codex-review — Adversarial Plan Review via Codex

## Description

Send the current plan or implementation to Codex GPT-5.4 for adversarial review. Runs an iterative review loop where Codex critiques and Claude revises until the plan is approved or 5 rounds are reached. Uses the Codex MCP server (subscription auth, no API key needed).

## User-invocable

Trigger: `/codex-review [optional-model-override]`

## Instructions

When the user invokes `/codex-review`, execute the following iterative adversarial review loop:

### Step 1: Capture the Plan

Gather the current plan, implementation proposal, or code changes being discussed. Write the content to a temp file:

```bash
UUID=$(uuidgen | tr '[:upper:]' '[:lower:]' | head -c 8)
PLAN_FILE="/tmp/claude-plan-${UUID}.md"
REVIEW_FILE="/tmp/codex-review-${UUID}.md"
```

### Step 2: Determine Model & Context

- Default model: `gpt-5.4`
- If user specified a model override (e.g., `/codex-review o4-mini`), use that model instead
- Detect if we're inside a git repo: `git rev-parse --git-dir 2>/dev/null`
- If NOT in a git repo and using CLI fallback, add `--skip-git-repo-check` to all `codex` commands

### Step 3: Submit to Codex for Review

Call the Codex MCP server (uses subscription auth — no API key needed):

```
mcp__codex__codex(
  prompt: "You are an adversarial reviewer. Your job is to find flaws, risks, and gaps in this plan.

## Plan to Review
<contents of PLAN_FILE>

## Review Focus Areas
1. Correctness: Will this achieve the stated goals? Are there logical errors?
2. Risks: Edge cases, data loss scenarios, failure modes, race conditions?
3. Missing Steps: Anything forgotten or assumed but not stated?
4. Alternatives: Is there a simpler or more robust approach?
5. Security: Auth gaps, injection vectors, access control issues?
6. Concurrency: Race conditions, deadlocks, ordering assumptions?
7. Schema/API: Breaking changes, backwards compatibility, migration safety?

## Response Format
For each finding:
- **Severity**: CRITICAL / WARNING / NIT
- **Location**: File, section, or step reference
- **Issue**: What's wrong
- **Suggestion**: How to fix it

End your review with exactly one of:
VERDICT: APPROVED
VERDICT: REVISE",
  model: "gpt-5.4",
  sandbox: "read-only"
)
```

> **CLI fallback:** If the Codex MCP server is unavailable, fall back to: `codex exec -m gpt-5.4 -s read-only --skip-git-repo-check "<prompt>"`

**Important notes:**
- The Codex MCP server authenticates via your Pro/MAX subscription (no OPENAI_API_KEY needed)
- Use `sandbox: "read-only"` for review tasks (no file writes)
- The MCP call returns Codex's response directly

### Step 4: Parse the VERDICT

Look for one of:
- `VERDICT: APPROVED` — Plan passes review
- `VERDICT: REVISE` — Plan needs changes, with specific feedback

### Step 5: Iterative Loop (max 5 rounds)

If `VERDICT: REVISE`:
1. Display Codex's feedback to the user
2. **Actively revise the plan** based on Codex's feedback
   - If a revision contradicts the user's explicit requirements, skip it and note it for the user
3. Write the revised plan to the same `PLAN_FILE`
4. Re-submit to Codex via `mcp__codex__codex(...)` with the revised plan content
5. Parse the new VERDICT
6. Repeat until APPROVED or 5 rounds reached

### Step 6: Present Results

Show the user:
- Final reviewed plan
- Summary of changes made across rounds
- Any skipped suggestions (contradicted user requirements)
- Final VERDICT status

### Step 7: Cleanup

Remove temp files:
```bash
rm -f /tmp/claude-plan-${UUID}.md /tmp/codex-review-${UUID}.md
```

## Notes

- This skill is read-only — it reviews plans, it does not modify code directly
- Each round's feedback and revisions are shown transparently to the user
- The skill works on any type of plan: architecture, implementation, migration, refactoring
- The MCP server handles git repo detection automatically; `--skip-git-repo-check` is only needed for CLI fallback
- For very large plans, consider splitting into sections to stay within prompt limits
