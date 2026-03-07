# /codex-review — Adversarial Plan Review via Codex

## Description

Send the current plan or implementation to Codex CLI (GPT-5.4) for adversarial review. Runs an iterative review loop where Codex critiques and Claude revises until the plan is approved or 5 rounds are reached. Uses the Codex CLI directly (subscription auth, no API key needed).

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
- If NOT in a git repo, add `--skip-git-repo-check` to all `codex` commands

### Step 3: Submit to Codex for Review

Run via the Codex CLI (uses subscription auth — no API key needed):

```bash
codex exec \
  -m gpt-5.4 \
  -s read-only \
  --skip-git-repo-check \
  "$(cat <<'PROMPT'
You are an adversarial reviewer. Your job is to find flaws, risks, and gaps in this plan.

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
VERDICT: REVISE
PROMPT
)"
```

**Important CLI notes:**
- Always include `--skip-git-repo-check` since we may not be in a git repo
- The Codex CLI authenticates via your Pro/MAX subscription (no OPENAI_API_KEY needed)
- Use `-s read-only` for review tasks (no file writes)
- Capture output by redirecting or reading stdout

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
4. Re-submit to Codex with `codex exec --resume <session>` if session ID is available, otherwise fresh exec
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
- If inside a git repo, you can omit `--skip-git-repo-check`
- The `codex exec` timeout is ~10 minutes; for very large plans, consider splitting into sections
