# Changelog

All notable changes to this project will be documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
