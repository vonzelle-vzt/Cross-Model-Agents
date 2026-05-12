# Product Requirements Document — Cross-Model Adversarial Agents

**Version:** 3.0.0
**Status:** Shipping
**Last updated:** 2026-05-12
**Maintainer:** VZT Tech Consulting · vonzelle@vzttechconsulting.com

---

## 1. Problem

When a single AI coding model plans, implements, and reviews the same task, it inherits its own blind spots at every step. These show up as:

- "AI slop" — over-engineered abstractions, wrapper-for-wrapper chains, comments restating code, premature helpers.
- Generic AI aesthetics in frontend code — Inter/Roboto fonts, default blue (#3B82F6), purple-on-white gradients, no responsive states.
- Self-confirming security audits where the same biases that wrote the code wrote the review.
- Gaps between spec and implementation that the implementer cannot see because it wrote both.

Existing tools either (a) run a single model multiple times (no real second opinion) or (b) require manual copy-paste between chat windows (high friction).

## 2. Solution

A bidirectional adversarial review system between **Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5** and **OpenAI GPT-5.5 / GPT-5.4**, with cross-model calls happening automatically over MCP. Each model acts as the other's reviewer, devil's advocate, and gate scorer. Pipeline enforcement blocks `git commit` until all required gates have passed.

The product is **infrastructure, not a chat product** — it ships as agents (`.md`/`.toml`), skills (slash commands), and a single cross-platform CLI (`pipeline.js`). It hooks into Claude Code and Codex CLI natively.

## 3. Target users

- **Solo developers** using AI coding assistants who want a structurally different second opinion.
- **Teams** enforcing cross-model quality gates in AI-assisted workflows.
- **Security-sensitive shops** that need an independent reviewer with different training data.

## 4. Goals (v3.0.0)

| # | Goal | Measure |
|---|---|---|
| G1 | Block ungated commits with zero workflow friction once installed | Pre-commit hook fires reliably on macOS/Linux/Windows |
| G2 | Cross-model calls work without leaving the editor | MCP-first, CLI fallback. Zero copy-paste. |
| G3 | Scale to many-file PRs | Per-file gate scoring fans out across worker models (Haiku 4.5 / gpt-5.4-mini) |
| G4 | Audit trail for every gate result and bypass | Structured JSONL logs + GitHub commit statuses |
| G5 | Provider-agnostic | Adding a new model (Gemini, Deepseek) is one entry in `config.json` |

## 5. Non-goals

- Not a chat product.
- Not a Greptile/Sourcegraph replacement (we publish *to* Greptile as a final gate).
- Not a CI service — runs on the developer's machine and on local hooks.
- Not bundling proprietary models. Users provide their own Anthropic + OpenAI subscriptions.

## 6. Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Developer machine                                             │
│                                                                │
│  Claude Code (Opus 4.7)  ←──MCP──→  Codex CLI (GPT-5.5)        │
│         │                                  │                   │
│         │ writes/edits files               │ writes/edits      │
│         ▼                                  ▼                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │   Pipeline CLI (scripts/pipeline.js)                     │  │
│  │   - init / track / gate / check / publish / fetch        │  │
│  │   - bypass --reason / doctor / status --json             │  │
│  │   - Atomic state writes with file lock                   │  │
│  └──────────────────────────────────────────────────────────┘  │
│                          │                                     │
│                          ▼                                     │
│            .pipeline/state-<branch>.json                       │
│            .pipeline/logs/<date>.jsonl                         │
│                                                                │
│  ~/.githooks/pre-commit → pipeline-precommit.js → exit 0/1     │
└────────────────────────────────────────────────────────────────┘
        │                                          │
        │                                          ▼
        │                              GitHub commit statuses
        │                              (pipeline/anti_slop ...)
        ▼
   Developer sees gate failures in PR before review
```

## 7. The pipeline (gates)

Every implementation passes through gates in order. Each blocker must pass before commit.

| Stage | Gate | Tier | Model (default) | Pass criterion |
|---|---|---|---|---|
| 1 | Plan | — | Opus 4.7 frontier | n/a (human approval) |
| 2 | Cross-model plan review | frontier | Codex / GPT-5.5 | VERDICT: APPROVED |
| 3 | Implementation | frontier | Opus 4.7 or GPT-5.5 | code written |
| 4 | **Anti-slop** | worker (fan-out) | Haiku 4.5 / gpt-5.4-mini per file | score ≥ 7 |
| 5 | **UI validation** (if frontend) | worker (fan-out) | Haiku 4.5 / gpt-5.4-mini | score ≥ 7 |
| 6 | **Devil's advocate** | frontier | Codex / GPT-5.5 (xhigh) | completed |
| 7 | **Gap analysis** | fallback | Sonnet 4.6 / GPT-5.4 | completed |
| 8 | Commit allowed | — | — | all gates pass |
| 9 | GitHub commit statuses published | — | — | gh API |
| 10 | PR opened | — | — | — |
| 11 | Greptile PR scoring | — | Greptile (external) | score ≥ threshold |
| 12 | Merge | — | — | — |

Gates 4 and 5 are **embarrassingly parallel** — one worker per file. v3.0.0 introduces tier-based routing so frontier models are only used where they matter (devil's advocate, architect), and worker models handle volume work.

## 8. Scoring model

**Anti-slop formula:**

```
SCORE = 10 − (critical_violations × 3) − (moderate_violations × 1) − (minor_violations × 0.5)
PASS  = score ≥ 7
FAIL  = score < 7 → fix + rescore, up to max_rounds (default: 2 in v3.0.0)
```

`max_rounds` was reduced from 3 → 2 in v3.0.0 because GPT-5.5 / Opus 4.7 self-correct mid-loop and round 3 rarely changes verdicts.

The **10 anti-slop patterns** and **10 UI patterns** are listed in the README.

## 9. CLI surface

```
pipeline.js init                          Initialize checkpoint
pipeline.js gate <name> <status> [score] [round] [--violations file.json]
pipeline.js check                          Verify all gates passed
pipeline.js track <file>                   Track a changed file
pipeline.js report [--json]                Show status
pipeline.js status [--json]                Alias of report
pipeline.js log [--last N] [--gate X] [--event Y]   Query logs
pipeline.js publish                        Post results as GitHub commit statuses
pipeline.js fetch                          Pull GitHub statuses into local state
pipeline.js bypass --reason "<text>"       Audited 30-minute commit-gate override
pipeline.js doctor                         Health check
pipeline.js reset [--all]                  Clear state
pipeline.js post-edit <file>               PostToolUse hook (JSON)
pipeline.js pre-commit                     PreToolUse hook (JSON)
pipeline.js stop                           Stop hook (JSON)
pipeline.js help [cmd]                     Help
```

## 10. Bypass policy (audit-logged)

`SKIP_PIPELINE_CHECK=1` alone **no longer bypasses** the gate. The developer must:

- Set `PIPELINE_BYPASS_REASON="<at least 12 chars>"`, **or**
- Run `pipeline.js bypass --reason "<text>"` (creates a 30-minute marker)

Every bypass is logged with `author`, `reason`, `branch`, and `timestamp` to `.pipeline/logs/<date>.jsonl` and is queryable via `pipeline.js log --event commit_bypassed`.

## 11. Configuration

Central config is `config.json` (project root). Schema:

- `providers{}` — model registry (Codex, Claude, optional codex-plugin-cc)
- `routing{}` — which provider does which work
- `routing.gates{}` — **per-gate tier + task_budget + reasoning_effort** (new in v3.0.0)
- `scoring{}` — threshold, max_rounds, weights, score bounds
- `concurrency{}` — max parallel agents, fan-out worker cap
- `mcp_servers{}` — MCP server definitions
- `bypass{}` — bypass reason length, audit settings
- `github{}` — commit status prefix

Adding a new provider is a one-line change in `providers{}` + a reference in `routing` / `routing.gates`.

## 12. Cross-platform support

| OS | Install | Hook | Pipeline CLI | Status |
|---|---|---|---|---|
| macOS | `install.sh` or `install.js` | `~/.githooks/pre-commit` (sh shim → node helper) | Node 18+ | ✅ |
| Linux | `install.sh` or `install.js` | same | Node 18+ | ✅ |
| Windows | `install.js` | same (Git for Windows ships sh) | Node 18+ | ✅ (v3.0.0) |

v3.0.0 removed all legacy bash pipeline scripts (`scripts/pipeline/*.sh`) — they read from `/tmp/pipeline-state-*.json`, incompatible with the JS CLI's `<repo>/.pipeline/` location, and were silently disabling gates when the JS path wasn't found.

## 13. Success metrics

- **Adoption:** install completes without manual intervention on a clean Windows/macOS/Linux box.
- **Friction:** `git commit` overhead under 200ms when gates pass.
- **Detection:** anti-slop catches at least 80% of known-bad fixture patterns in `tests/integration/smoke-test.js`.
- **Audit:** every bypass leaves a log entry visible in the dashboard.

## 14. Open risks

| Risk | Mitigation |
|---|---|
| Opus 4.7 new tokenizer (~1.35× more tokens) blows through budgets | v3.0.0 raised `max_parallel_claude` 2→3; `task_budget` per gate caps thinking |
| OpenAI's official `codex-plugin-cc` overlaps with this product | We bundle it as an optional alternative backend (`providers.codex_plugin_cc.enabled: true`) — composition, not competition |
| `gh` CLI not installed → `publish`/`fetch` silently no-op | Doctor surfaces this as a warning |
| User has another pre-commit hook | v3.0.0 installer detects existing non-ours hook and refuses to overwrite |

## 15. Roadmap (post-v3.0.0)

- **v3.1**: Worker fan-out wired into anti-slop / UI agents (currently config-only; agent prompts still need updates).
- **v3.2**: Codex image generation in UI validator — render component from JSX, diff against Playwright screenshot.
- **v3.3**: Add Gemini and Deepseek to `providers{}` as additional reviewers.
- **v3.4**: Dashboard subscribes to live JSONL log tail via WebSocket-less polling.
