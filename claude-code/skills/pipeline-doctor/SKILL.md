---
version: 1.0.0
description: "Diagnose pipeline enforcement health and auto-fix common setup issues"
requires: []
---

# /pipeline-doctor — Pipeline Enforcement Health Check

## Description

Run `pipeline.js doctor`, parse its output, and either confirm the setup is healthy or walk the user through fixing each problem. Bridges the gap between a generic CLI health check and Claude actually understanding what each failure means for the user's workflow.

## User-invocable

Trigger: `/pipeline-doctor` or `/pipeline-doctor --fix`

When `--fix` is passed, you may execute the suggested remediation commands after confirming each one with the user.

## Process

1. **Run the doctor.**

   ```bash
   node scripts/pipeline.js doctor
   ```

   Capture stdout. Doctor exits non-zero on real problems; zero is clean.

2. **Categorize each line:**
   - `ok` lines → no action.
   - `warn` lines → mention to the user, but do not auto-fix unless the user opts in.
   - `FAIL` lines → mandatory fixes.

3. **For each FAIL, present the fix and ask:**

   | Doctor failure | Fix |
   |---|---|
   | `Node.js < 18` | Tell the user to upgrade Node — do not auto-install. |
   | `git not found on PATH` | Tell the user to install git — do not auto-install. |
   | `Not inside a git repository` | Offer `git init` (only if the user explicitly wants this directory tracked). |
   | `git core.hooksPath not set` | Offer to run: `git config --global core.hooksPath "$HOME/.githooks"` |
   | `pre-commit hook missing` | Offer to run: `node scripts/install.js --yes --skip-hook=false` |
   | `config.json: missing providers{}` | Open config.json with the user — this is project-specific. |
   | `.gitignore does NOT exclude .pipeline/` | Offer to append `.pipeline/` to `.gitignore`. |

4. **In `--fix` mode** — for each FAIL, after the user confirms (`y` to proceed), execute the fix command and re-run the doctor for the affected check.

5. **Final report:** Print a one-paragraph summary of:
   - What was healthy.
   - What was fixed in this session.
   - What still requires user action (e.g. installing git).

## Output format

Use a compact text report. No JSON unless the user passes `--json`.

```
Pipeline Doctor — Cross-Model Agents v3.0.0

[ok]    Node.js 20.19.6
[ok]    Git: git version 2.53.0
[fail]  git core.hooksPath not set
        → Fix: git config --global core.hooksPath "$HOME/.githooks"
[warn]  codex CLI not found
        → Cross-model delegation to Codex disabled until installed

2 problems, 1 warning. Run `/pipeline-doctor --fix` to apply suggested fixes.
```

## What to NEVER do

- Do not run `npm install -g <anything>` without explicit user confirmation.
- Do not modify `.gitignore` silently — show the diff first.
- Do not set `git config --global` flags without confirmation. These affect every repo on the user's machine.
- Do not auto-create a git repo (`git init`) in a directory the user didn't ask to initialize.

## Anti-slop reminders for this skill

- The skill is a wrapper around `pipeline.js doctor`. It must NOT re-implement the checks in Claude. Always shell out to the CLI and parse output.
- Output must be actionable: if you say "X is broken," you must also say what command fixes it.
- Do not invent failure modes the doctor didn't report.
