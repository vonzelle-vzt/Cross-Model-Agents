# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [3.2.0] — 2026-09-09

Enforcement release. Every change below follows from one finding: on a machine that believed it was protected, the
commit gate had never fired. `git config --global core.hooksPath` was unset, `~/.githooks` did not exist, and none of
the 31 agents or 4 skills were installed — while the README advertised a gate that blocks `git commit`.

The design hole that hid it: gate state lives in the gitignored `.pipeline/`, so every fresh checkout and every new
`git worktree` began with no state, and both `check` and `pre-commit` treated missing state as "nothing to enforce" and
exited 0. Enforcement was absent exactly where it was most needed.

### Added

- **`.pipeline-required` marker** — a repository opts into enforcement by committing this file at its root. With the
  marker, missing or invalid checkpoint state **blocks** the commit (`check` exits 2, the PreToolUse hook denies) instead
  of passing. Without it, behavior is unchanged byte-for-byte, so unmarked repos and non-VZT consumers are unaffected.
  The marker must be committed rather than merely staged: `git worktree add` checks out a commit, so an untracked marker
  is absent in exactly the worktrees the gate is meant to guard.
- **`scripts/install-hooks.js <repo>`** — installs the pre-commit shim into `<repo>/.git/cross-model-hooks/` and points
  that repository's **local** `core.hooksPath` at it. Refuses to replace an existing custom or husky-managed hook, and
  never writes global git config.
- **`uninstall.js --repo <path>`** (repeatable) — removes the repo-local hooks directory and unsets that repository's
  local `core.hooksPath`. Refuses any hooks directory lacking the `.cross-model-managed` sentinel, so it cannot delete
  hooks it did not write. Leaves the tracked `.pipeline-required` marker in place: deleting a committed file is a
  repository change, not an uninstall.
- **Content-bound approvals** — each recorded gate stores a fingerprint of the index and the working tree. A review can
  no longer be borrowed by different content: reviewing and then staging that same content still passes, while staging
  A, editing to B, reviewing B and committing A is refused.
- **CI runs `test-install-hooks.js` and `test-uninstall-hooks.js`** — both existed on disk and neither was executed by
  the workflow. An oracle nobody runs is not coverage.

### Changed

- **Hooks are installed per repository, never globally.** The previous installer ran
  `git config --global core.hooksPath ~/.githooks`. A global hooks path takes over every repository relying on the
  default `.git/hooks`, silently disabling existing `pre-commit` / `pre-push` hooks there. (A repository that sets its
  own local `core.hooksPath`, as husky v9 does, still wins over the global value.) Opting one repo in must never disarm
  another.
- **Scored gates enforce `scoring.pass_threshold`** — recording `anti_slop` or `ui_validation` as `passed` now requires a
  score at or above the threshold.
- **Frontend detection reads the real git diff** rather than trusting `track`, so the UI gate cannot be skipped by
  omitting a file.
- `status --json` and `publish` recompute rather than trusting a cached `commit_allowed`.
- README, `docs/USAGE.md` and `docs/PRD.md` corrected: hooks are repo-local, the marker is what makes missing state
  enforce, and the uninstaller's scope is stated rather than implied.

### Fixed

- **Uninstaller could leave a repository pointing at deleted hooks.** The `core.hooksPath` comparison was a resolved
  string compare; on macOS the stored value arrives as `/private/var/...` while `path.resolve()` yields `/var/...`, so
  the tool's own hooks directory read as a third party's — the pointer was left set and the directory removed anyway.
  Git silently runs no hooks in that state. Now compared through `realpath`.

### Known limitations

- **Orca does not execute the `setup:` block in a repository's `orca.yaml`.** It takes its setup command from
  `hookSettings.scripts.setup` in its own repo record, which is empty by default and is not settable from the `orca`
  CLI. Auto-initializing a new Orca worktree therefore requires setting that field in the Orca app UI. Enforcement does
  not depend on it: a worktree carrying the marker and no state fails closed.

---

## [3.1.0] — 2026-06-11

June 2026 model lineup refresh plus two enforcement-layer gaps closed: an opt-in blocking security gate and server-side CI verification of gate statuses.

### Added

- **`security` pipeline gate** — fifth gate, recordable via `pipeline.js gate security completed` and published/fetched like the others. **Opt-in blocking**: set `routing.gates.security.blocking: true` in `config.json` to make `git commit` require a completed cross-model security audit. Routed to a new `security` tier (`providers.codex.security_model`).
- **`providers.codex.security_model: "gpt-5.2-codex"`** — OpenAI's strongest cybersecurity model, pinned for the security gate. The `codex-security` agent now delegates to it (falls back to `providers.codex.model` if unavailable on the user's plan) and records the gate on completion.
- **`providers.claude.escalation_model: "claude-fable-5"`** — optional escalation tier for the hardest long-horizon reviews (released 2026-06-09, $10/$50 per MTok). Any gate routed to it must fall back to `claude-opus-4-8` on `stop_reason: "refusal"` (Fable 5 safety classifiers decline cyber/bio-adjacent content — including some legitimate security-review prompts, which is why the security gate stays on the Codex side).
- **`.github/workflows/verify-gates.yml`** — server-side verification of `pipeline/*` commit statuses on PRs. Closes the `--no-verify` / uninstalled-hook hole: the local machine is no longer the only enforcement point. Ships with `ENFORCE: "false"` (report-only); flip to `"true"` to block merges.

### Changed

- **Claude provider `model` bumped `claude-opus-4-7` → `claude-opus-4-8`** — current Opus frontier, same API surface as 4.7 (no request changes needed).
- **Codex provider notes refreshed** — `gpt-5.5` confirmed still frontier per June 2026 Codex docs; `gpt-5.3-codex-spark` (near-instant preview) noted but not routed (ChatGPT Pro-only).
- `pipeline.js` gate lists (`gate`, `check`, `report`, `publish`, `fetch`, hooks, help) now include `security`.

---

## [3.0.0] — 2026-05-12

Major release. Cross-platform pipeline CLI hardening, 2026 model lineup, audited bypass, and removal of the broken legacy bash layer.

### Added

- **Per-gate model tiering** in `config.json` — `routing.gates.<gate>.tier` selects `frontier` / `fallback` / `worker` model from each provider. Anti-slop + UI gates now route to worker models (Haiku 4.5 / gpt-5.4-mini) for fan-out.
- **Provider worker_model and fallback_model fields** — Codex declares `gpt-5.4` (fallback) and `gpt-5.4-mini` (worker); Claude declares `claude-sonnet-4-6` (fallback) and `claude-haiku-4-5` (worker).
- **`pipeline.js doctor`** — health check for Node version, git, `core.hooksPath`, hook file, `gh` CLI, claude/codex CLIs, `config.json` schema, `.pipeline/` directory, `.gitignore` exclusion.
- **`pipeline.js bypass --reason "<text>"`** — 30-minute audited override of the commit gate. Logged to JSONL with author, branch, reason. Replaces unaudited `SKIP_PIPELINE_CHECK=1`.
- **`pipeline.js status [--json]`** — alias of `report`; `--json` flag emits full state for programmatic consumers (CI, IDE plugins, dashboard).
- **`pipeline.js gate --violations file.json`** — gate agents can now push their full structured-JSON violations into pipeline state, not just status/score.
- **Per-subcommand help** — `pipeline.js help <cmd>` and `pipeline.js --version`.
- **Atomic state writes + file locking** — `mutateState()` acquires a lockfile, reads, mutates, then writes via tmp + rename. Prevents race conditions when multiple gate agents write in parallel (per `concurrency.max_parallel_codex`).
- **Score bounds checking** — `gate <name> <status> <score>` now rejects scores outside `[score_min, score_max]` from `config.json`.
- **Cross-platform pre-commit hook** — POSIX `sh` shim (Git for Windows ships `sh`) that execs a Node helper at `~/.githooks/pipeline-precommit.js`. Replaces the bash-only hook.
- **Installer auto-sets `git core.hooksPath`** — `~/.githooks/`. Without this, the hook never fires. Previous releases shipped the hook file but did not configure git to use it.
- **`scripts/uninstall.js`** — cross-platform uninstaller (replaces bash-only `uninstall.sh`). `--purge` flag also removes the hook + clears `core.hooksPath`.
- **Unattended installer mode** — `install.js --yes`, `--minimal`, `--skip-hook`, `--with codex,exa,...`. Enables CI / Dockerfile installs and pre-approval of specific MCP servers.
- **API key env-var prefill** — when running install.js unattended, EXA / Firecrawl / Greptile keys are read from environment variables.
- **`pipeline-doctor` skill** — Claude Code slash command that runs `pipeline.js doctor`, categorizes failures, and walks the user through fixes.
- **`docs/PRD.md`** — product requirements document.
- **`config.json` v3** — adds `maintainer{}`, `bypass{}`, per-gate `task_budget` and `reasoning_effort`, `concurrency.max_fanout_workers`, `providers.codex_plugin_cc` (opt-in OpenAI official plugin as alternative backend).

### Changed

- **`scoring.max_rounds` reduced 3 → 2.** GPT-5.5's mid-task self-correction (released 2026-04-23) means round 3 rarely changes verdicts.
- **`concurrency.max_parallel_claude` raised 2 → 3** to absorb Opus 4.7's new tokenizer overhead (~1.35× tokens on same text).
- **Codex provider `model` bumped `gpt-5.4` → `gpt-5.5`** (released 2026-04-23). Reasoning effort kept at `xhigh`.
- **Claude provider `model` pinned to `claude-opus-4-7`** (released 2026-04-16) with `claude-sonnet-4-6` as `fallback_model`.
- **Pre-commit logic** — `SKIP_PIPELINE_CHECK=1` alone no longer bypasses. Must be paired with `PIPELINE_BYPASS_REASON="<at least 12 chars>"`, or use the `bypass` subcommand.
- **`cmdLog`** — now walks newest-first and stops early when `--last N` is satisfied, instead of reading every log file.
- **`cmdPublish`** — uses `gh api -f key=value` directly (cross-platform) instead of bash herestring redirection that failed on Windows.
- **Git command results** are memoized (`getRepoRoot`, `getBranch`, `getRepoSlug`, `getGitHubRepo`, `getHeadSha`) instead of shelling out on every helper call.
- **`cmdReport`** — `ui_validation` is now shown when data exists, even if `has_frontend_changes` is false (e.g., after `pipeline.js fetch` pulled a UI status from GitHub on a branch with no tracked frontend files).
- **CODE_OF_CONDUCT.md** — significantly expanded: project-specific expectations (AI attribution, anti-slop discipline, no model wars, security disclosure path), explicit reporting procedure, enforcement guidelines (Mozilla ladder), conflicts of interest section, amendment policy. Maintainer set to **VZT Tech Consulting**; contact email **vonzelle@vzttechconsulting.com**.

### Removed

- **`scripts/pipeline/*.sh`** — all 8 legacy bash pipeline scripts. They read state from `/tmp/pipeline-state-<repo>-<branch>.json` while `pipeline.js` wrote to `<repo>/.pipeline/state-<branch>.json` — the two halves were silently incompatible. With `pipeline.js` as the single source of truth, this category of bug cannot recur.
- **Legacy pre-commit fallback** that called `~/.local/bin/pipeline-check.sh` and silently passed when state was missing.
- **`fast_model: "gpt-5.3-codex-spark"`** — superseded by GPT-5.4 mini as the worker tier.

### Fixed

- Race condition: two parallel gate agents writing state could lose updates. Lockfile + atomic rename fixes this.
- `cmdPublish` was unreachable on Windows because it relied on bash `<<<` herestring; the `-f` fallback path always fired (correct result, wasted call).
- Pre-commit hook never fired out of the box because `install.js` wrote the hook file but never set `git config --global core.hooksPath`.
- `cmdReport` could hide `ui_validation` results pulled in by `fetch` when no frontend files were tracked locally.

### Security

- Bypasses are now mandatory-logged with the developer's email (from `git config user.email`) — no more silent overrides.
- Pre-commit hook helper validates the bypass reason length before allowing the commit through.

### Branding

- All references to `sigma-algo.com` removed.
- Maintainer email updated to `vonzelle@vzttechconsulting.com` (Code of Conduct, `config.json` maintainer block, installer summary).

---

## [2.0.0] — 2026-03-09

Initial open-source-ready release. See `README.md` "Architecture" section for full description.

### Added

- 10 Claude Code agents (`.md`), 21 Codex agents (`.toml`), 3 skills (`/codex-review`, `/council`, `/delegate`).
- Pipeline enforcement: post-edit reminders, commit gate, stop-hook session check.
- Anti-slop scoring (10 patterns), UI validation gate (10 patterns).
- MCP-first cross-model communication with CLI fallback.
- `scripts/pipeline.js` cross-platform pipeline CLI.
- `scripts/install.js` cross-platform installer.
- `scripts/dashboard.html` single-file observability dashboard.
- Static + pipeline + integration test suites.
- GitHub commit status publish/fetch.

### Models (at the time of v2.0.0)

- Claude Opus 4.6
- OpenAI Codex GPT-5.4
- (Both have since been superseded — see v3.0.0.)

---

## [1.0.0] — 2026-02-15

Pre-release internal version with bash-only pipeline scripts. Not publicly distributed.
