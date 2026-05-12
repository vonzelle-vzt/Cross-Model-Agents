#!/usr/bin/env node
// Cross-Model Adversarial Agents — Pipeline Enforcement (Node.js)
// Cross-platform pipeline CLI. Replaces the legacy bash scripts entirely.
//
// Usage (run `node pipeline.js help <cmd>` for per-command help):
//   init                                          Initialize checkpoint
//   gate <name> <status> [score] [round] [--violations file.json]  Record gate result
//   check                                         Verify all gates passed
//   reset [--all]                                 Clear checkpoint
//   track <file>                                  Track file change
//   post-edit <file>                              PostToolUse hook (returns JSON)
//   pre-commit                                    PreToolUse hook (returns JSON)
//   stop                                          Stop hook (returns JSON)
//   report [--json]                               Show gate status (text or JSON)
//   status [--json]                               Alias of report
//   log [--last N] [--gate X] [--event Y]         Query pipeline logs
//   publish                                       Post gate results to GitHub
//   fetch                                         Pull gate statuses from GitHub
//   bypass --reason "<text>"                      Audited override of commit gate (this commit only)
//   doctor                                        Health check (node, git, gh, hooks, config, MCP)
//   help [cmd]                                    Show help

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');

const VERSION = '3.0.0';

// --- One-shot caches ---

const cache = {};
function memo(key, fn) {
  if (cache[key] !== undefined) return cache[key];
  cache[key] = fn();
  return cache[key];
}

// --- Git helpers (cached) ---

function gitExec(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

const getRepoRoot = () => memo('repoRoot', () => gitExec('rev-parse --show-toplevel') || process.cwd());
const getRepoSlug = () => memo('repoSlug', () => path.basename(getRepoRoot()));
const getBranch   = () => memo('branch',   () => gitExec('rev-parse --abbrev-ref HEAD') || 'unknown');

// --- Config ---

function loadConfig() {
  return memo('config', () => {
    const p = path.join(getRepoRoot(), 'config.json');
    if (!fs.existsSync(p)) return {};
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
  });
}

// --- State file paths ---

function getPipelineDir() {
  const dir = path.join(getRepoRoot(), '.pipeline');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCheckpointPath() {
  const branch = getBranch().replace(/[\\/]/g, '-');
  return path.join(getPipelineDir(), `state-${branch}.json`);
}

function getLogDir() {
  const dir = path.join(getPipelineDir(), 'logs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getWarnMarkerPath(sessionId) {
  return path.join(getPipelineDir(), `.stop-warned-${sessionId}`);
}

function getBypassMarkerPath() {
  return path.join(getPipelineDir(), `bypass-${getBranch().replace(/[\\/]/g, '-')}.json`);
}

// --- File locking (race protection for parallel gate writers) ---

function withFileLock(filepath, fn, maxWaitMs = 5000) {
  const lockPath = filepath + '.lock';
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      try {
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        try {
          return fn();
        } finally {
          try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
        }
      } catch (e) {
        try { fs.closeSync(fd); } catch { /* ignore */ }
        try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
        throw e;
      }
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Stale lock detection: if older than 10s, take it
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > 10000) {
          try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
          continue;
        }
      } catch { /* ignore */ }
      // Spin wait
      const wait = 25 + Math.floor(Math.random() * 50);
      const waitEnd = Date.now() + wait;
      while (Date.now() < waitEnd) { /* busy-wait briefly */ }
    }
  }
  throw new Error(`Timed out acquiring lock: ${lockPath}`);
}

// --- State read/write (atomic) ---

function readStateRaw() {
  const filepath = getCheckpointPath();
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function writeStateAtomic(state) {
  const filepath = getCheckpointPath();
  const tmp = filepath + `.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filepath);
}

function readState() { return readStateRaw(); }
function writeState(state) { writeStateAtomic(state); }

function mutateState(mutator) {
  return withFileLock(getCheckpointPath(), () => {
    const state = readStateRaw() || createInitialState();
    const next = mutator(state);
    writeStateAtomic(next || state);
    return next || state;
  });
}

function createInitialState() {
  return {
    session_id: crypto.randomBytes(6).toString('hex'),
    repo: getRepoSlug(),
    branch: getBranch(),
    changed_files: [],
    has_frontend_changes: false,
    gates: {},
    commit_allowed: false,
    created_at: new Date().toISOString()
  };
}

// --- Logging ---

function logEvent(event) {
  const logDir = getLogDir();
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `${date}.jsonl`);
  const entry = { timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
}

// --- Frontend / code detection ---

const FRONTEND_EXTENSIONS = new Set(['.tsx', '.jsx', '.css', '.scss', '.vue', '.svelte', '.module.css']);
const FRONTEND_DIRS = ['/components/', '/app/', '/pages/', '/views/', '/layouts/'];
const FRONTEND_DIR_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.vue', '.svelte', '.html']);
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java',
  '.css', '.scss', '.vue', '.svelte', '.html'
]);

function isFrontendFile(filePath) {
  const ext = path.extname(filePath);
  if (FRONTEND_EXTENSIONS.has(ext)) return true;
  if (FRONTEND_DIR_EXTENSIONS.has(ext)) {
    const normalized = filePath.replace(/\\/g, '/');
    return FRONTEND_DIRS.some(dir => normalized.includes(dir));
  }
  return false;
}

function isCodeFile(filePath) {
  return CODE_EXTENSIONS.has(path.extname(filePath));
}

// --- Commit allowed logic ---

function recalculateCommitAllowed(state) {
  const g = state.gates || {};
  const antiSlop = !!(g.anti_slop && g.anti_slop.status === 'passed');
  const uiVal = state.has_frontend_changes
    ? !!(g.ui_validation && g.ui_validation.status === 'passed')
    : true;
  const da = !!(g.devils_advocate && g.devils_advocate.status === 'completed');
  const ga = !!(g.gap_analysis && g.gap_analysis.status === 'completed');
  state.commit_allowed = antiSlop && uiVal && da && ga;
  return state;
}

// --- Bypass marker (audit-logged commit-gate override) ---

function readActiveBypass() {
  const p = getBypassMarkerPath();
  if (!fs.existsSync(p)) return null;
  try {
    const bypass = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Bypass marker expires after 30 minutes
    if (Date.now() - new Date(bypass.created_at).getTime() > 30 * 60 * 1000) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
      return null;
    }
    return bypass;
  } catch {
    return null;
  }
}

function consumeBypass() {
  const p = getBypassMarkerPath();
  if (fs.existsSync(p)) {
    try { fs.unlinkSync(p); } catch { /* ignore */ }
  }
}

// --- Argument parsing ---

function parseFlags(args, schema) {
  // schema: { boolFlags: ['--all'], valueFlags: ['--reason', '--violations'] }
  const positionals = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (schema.valueFlags && schema.valueFlags.includes(a)) {
      flags[a] = args[i + 1];
      i++;
    } else if (schema.boolFlags && schema.boolFlags.includes(a)) {
      flags[a] = true;
    } else if (a.startsWith('--')) {
      // Unknown flag — treat as boolean
      flags[a] = true;
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

// --- Subcommands ---

function cmdInit() {
  const existing = readState();
  if (existing) {
    process.exit(0);
  }
  const state = createInitialState();
  writeState(state);
  logEvent({ event: 'pipeline_init', session_id: state.session_id });
  console.log(`Pipeline checkpoint initialized: ${getCheckpointPath()}`);
}

function cmdGate(args) {
  const VALID_GATES = ['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'];
  const VALID_STATUSES = ['passed', 'failed', 'completed'];

  const { positionals, flags } = parseFlags(args, {
    valueFlags: ['--violations']
  });

  if (positionals.length < 2) {
    console.error('Usage: pipeline.js gate <gate_name> <status> [score] [round] [--violations file.json]');
    console.error(`  gate_name: ${VALID_GATES.join(', ')}`);
    console.error(`  status: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const [gateName, status] = positionals;
  let score = positionals[2] !== undefined ? parseFloat(positionals[2]) : null;
  const round = positionals[3] !== undefined ? parseInt(positionals[3], 10) : null;

  if (!VALID_GATES.includes(gateName)) {
    console.error(`ERROR: Invalid gate name '${gateName}'. Must be one of: ${VALID_GATES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_STATUSES.includes(status)) {
    console.error(`ERROR: Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  // Score bounds (0–10 inclusive)
  if (score !== null) {
    const cfg = loadConfig().scoring || {};
    const min = cfg.score_min !== undefined ? cfg.score_min : 0;
    const max = cfg.score_max !== undefined ? cfg.score_max : 10;
    if (Number.isNaN(score) || score < min || score > max) {
      console.error(`ERROR: score ${positionals[2]} out of bounds [${min},${max}]`);
      process.exit(1);
    }
  }

  // Optional violations file
  let violations = null;
  if (flags['--violations']) {
    try {
      violations = JSON.parse(fs.readFileSync(flags['--violations'], 'utf8'));
    } catch (e) {
      console.error(`ERROR: Could not read --violations file: ${e.message}`);
      process.exit(1);
    }
  }

  const state = mutateState((s) => {
    s.gates[gateName] = {
      status,
      score,
      round,
      violations,
      updated_at: new Date().toISOString()
    };
    recalculateCommitAllowed(s);
    return s;
  });

  logEvent({
    event: 'gate_result',
    gate: gateName,
    status,
    score,
    round,
    violation_count: violations && violations.files
      ? violations.files.reduce((n, f) => n + ((f.violations || []).length), 0)
      : null
  });
  console.log(`Gate '${gateName}' recorded: status=${status} score=${score} round=${round}`);
  console.log(`Commit allowed: ${state.commit_allowed}`);
}

function cmdCheck() {
  const state = readState();
  if (!state) {
    process.exit(0);
  }

  // Audited bypass
  const bypass = readActiveBypass();
  if (bypass) {
    console.log(`Pipeline check bypassed: reason="${bypass.reason}" by=${bypass.author}`);
    logEvent({ event: 'commit_bypassed', reason: bypass.reason, author: bypass.author });
    process.exit(0);
  }

  if (state.commit_allowed) {
    console.log('All pipeline gates passed. Commit allowed.');
    process.exit(0);
  }

  const missing = buildMissingGates(state);
  console.log('PIPELINE CHECK FAILED — commit not allowed.');
  console.log('');
  for (const msg of missing) console.log(`  ${msg}`);
  console.log('');
  console.log('Complete the required gates before committing,');
  console.log('or run: pipeline.js bypass --reason "<explanation>"');
  process.exit(2);
}

function buildMissingGates(state) {
  const missing = [];
  const g = state.gates || {};

  const antiSlop = g.anti_slop ? g.anti_slop.status : 'NOT RUN';
  if (antiSlop !== 'passed') {
    missing.push(`BLOCKED: anti_slop gate ${antiSlop}. Run the codex-anti-slop agent.`);
  }
  if (state.has_frontend_changes) {
    const uiVal = g.ui_validation ? g.ui_validation.status : 'NOT RUN';
    if (uiVal !== 'passed') {
      missing.push(`BLOCKED: ui_validation gate ${uiVal}. Run the codex-ui-validator agent. (frontend changes detected)`);
    }
  }
  const da = g.devils_advocate ? g.devils_advocate.status : 'NOT RUN';
  if (da !== 'completed') {
    missing.push(`BLOCKED: devils_advocate gate ${da}. Run the codex-devils-advocate agent.`);
  }
  const ga = g.gap_analysis ? g.gap_analysis.status : 'NOT RUN';
  if (ga !== 'completed') {
    missing.push(`BLOCKED: gap_analysis gate ${ga}. Run the codex-gap-analyst agent.`);
  }
  return missing;
}

function cmdReset(args) {
  const { flags } = parseFlags(args, { boolFlags: ['--all'] });
  if (flags['--all']) {
    const pipelineDir = getPipelineDir();
    const files = fs.readdirSync(pipelineDir)
      .filter(f => f.startsWith('state-') || f.startsWith('.stop-warned-') || f.startsWith('bypass-'));
    for (const f of files) {
      fs.unlinkSync(path.join(pipelineDir, f));
    }
    console.log('Cleared all pipeline state files.');
    return;
  }

  const filepath = getCheckpointPath();
  if (fs.existsSync(filepath)) {
    const state = readState();
    if (state && state.session_id) {
      const marker = getWarnMarkerPath(state.session_id);
      if (fs.existsSync(marker)) fs.unlinkSync(marker);
    }
    fs.unlinkSync(filepath);
    consumeBypass();
    logEvent({ event: 'pipeline_reset' });
    console.log(`Pipeline checkpoint cleared for ${getRepoSlug()}/${getBranch()}`);
  } else {
    console.log(`No pipeline checkpoint found for ${getRepoSlug()}/${getBranch()}`);
  }
}

function cmdTrack(args) {
  if (args.length < 1) {
    console.error('Usage: pipeline.js track <file_path>');
    process.exit(1);
  }
  const filePath = args[0];

  mutateState((s) => {
    if (!s.changed_files.includes(filePath)) s.changed_files.push(filePath);
    if (isFrontendFile(filePath)) s.has_frontend_changes = true;
    return s;
  });
}

function cmdPostEdit(args) {
  const filePath = args[0] || '';
  if (!filePath || !isCodeFile(filePath)) {
    console.log('{}');
    return;
  }
  try { cmdTrack([filePath]); } catch { /* non-fatal */ }

  const state = readState();
  const hasFrontend = (state && state.has_frontend_changes) || isFrontendFile(filePath);

  const gates = [
    '- Anti-slop gate (codex-anti-slop agent)',
    hasFrontend ? '- UI validation gate (codex-ui-validator agent) [frontend file detected]' : null,
    "- Devil's advocate (codex-devils-advocate agent)",
    '- Gap analysis (codex-gap-analyst agent)'
  ].filter(Boolean).join('\n');

  const message = `You modified ${filePath}. Pipeline gates REQUIRED before commit:\n${gates}\n\nRun these gates before attempting git commit.`;
  console.log(JSON.stringify({ additionalContext: message }));
}

function cmdPreCommit() {
  let hookInput = '';
  try { hookInput = fs.readFileSync(0, 'utf8'); } catch { /* no stdin */ }

  let command = '';
  try {
    const parsed = JSON.parse(hookInput);
    command = (parsed.tool_input && parsed.tool_input.command) || '';
  } catch { /* not JSON */ }

  const isGitCommit = /^\s*git\s+commit(\s|$)/.test(command) && !/--allow-empty/.test(command);
  if (!isGitCommit) {
    console.log('{}');
    return;
  }

  // Audited bypass (env var path — must include reason)
  if (process.env.SKIP_PIPELINE_CHECK === '1') {
    const reason = process.env.PIPELINE_BYPASS_REASON || '';
    const cfg = loadConfig().bypass || {};
    const minLen = cfg.min_reason_length !== undefined ? cfg.min_reason_length : 12;
    if (cfg.require_reason !== false && reason.trim().length < minLen) {
      const msg = `PIPELINE BYPASS BLOCKED: SKIP_PIPELINE_CHECK=1 requires PIPELINE_BYPASS_REASON="<at least ${minLen} chars>" or use \`pipeline.js bypass --reason "<text>"\`.`;
      logEvent({ event: 'commit_bypass_rejected', reason_provided: reason });
      console.log(JSON.stringify({ decision: 'deny', reason: msg }));
      return;
    }
    logEvent({ event: 'commit_bypassed', reason, source: 'env' });
    console.log('{}');
    return;
  }

  const bypass = readActiveBypass();
  if (bypass) {
    logEvent({ event: 'commit_bypassed', reason: bypass.reason, source: 'marker' });
    console.log('{}');
    return;
  }

  const state = readState();
  if (!state) {
    console.log('{}');
    return;
  }
  if (state.commit_allowed) {
    console.log('{}');
    return;
  }

  const g = state.gates || {};
  const lines = [];
  const antiSlop = g.anti_slop ? g.anti_slop.status : 'NOT RUN';
  if (antiSlop !== 'passed') lines.push(`- anti_slop: ${antiSlop}`);
  if (state.has_frontend_changes) {
    const uiVal = g.ui_validation ? g.ui_validation.status : 'NOT RUN';
    if (uiVal !== 'passed') lines.push(`- ui_validation: ${uiVal} (frontend changes detected)`);
  }
  const da = g.devils_advocate ? g.devils_advocate.status : 'NOT RUN';
  if (da !== 'completed') lines.push(`- devils_advocate: ${da}`);
  const ga = g.gap_analysis ? g.gap_analysis.status : 'NOT RUN';
  if (ga !== 'completed') lines.push(`- gap_analysis: ${ga}`);

  const reason = `PIPELINE GATE BLOCKED: Cannot commit without completing required gates.\n\nMissing gates:\n${lines.join('\n')}\n\nRun these agents before committing, or run:\n  pipeline.js bypass --reason "<explanation>"`;
  logEvent({ event: 'commit_blocked', missing_gates: lines });
  console.log(JSON.stringify({ decision: 'deny', reason }));
}

function cmdStop() {
  try { fs.readFileSync(0, 'utf8'); } catch { /* ok */ }
  const state = readState();
  if (!state || state.commit_allowed) {
    console.log('{}');
    return;
  }
  if (state.session_id) {
    const marker = getWarnMarkerPath(state.session_id);
    if (fs.existsSync(marker)) {
      console.log('{}');
      return;
    }
    fs.writeFileSync(marker, '', 'utf8');
  }

  const g = state.gates || {};
  const lines = [];
  lines.push(`- anti_slop: ${g.anti_slop ? g.anti_slop.status : 'NOT RUN'}`);
  if (state.has_frontend_changes) {
    lines.push(`- ui_validation: ${g.ui_validation ? g.ui_validation.status : 'NOT RUN'}`);
  }
  lines.push(`- devils_advocate: ${g.devils_advocate ? g.devils_advocate.status : 'NOT RUN'}`);
  lines.push(`- gap_analysis: ${g.gap_analysis ? g.gap_analysis.status : 'NOT RUN'}`);

  const warning = `WARNING: You have uncommitted code changes with incomplete pipeline gates. Gates status:\n${lines.join('\n')}\n\nConsider running the required gates before ending this session.`;
  console.log(JSON.stringify({ additionalContext: warning }));
}

function cmdReport(args) {
  const { flags } = parseFlags(args, { boolFlags: ['--json'] });
  const state = readState();

  if (flags['--json']) {
    const bypass = readActiveBypass();
    const payload = state
      ? { ...state, active_bypass: bypass, missing: state.commit_allowed ? [] : buildMissingGates(state) }
      : { active: false };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (!state) {
    console.log('No active pipeline checkpoint.');
    return;
  }

  const bypass = readActiveBypass();
  console.log(`Pipeline Status: ${state.repo}/${state.branch}`);
  console.log(`Session: ${state.session_id}`);
  console.log(`Created: ${state.created_at}`);
  console.log(`Changed files: ${state.changed_files.length}`);
  console.log(`Frontend changes: ${state.has_frontend_changes}`);
  console.log(`Commit allowed: ${state.commit_allowed}${bypass ? ' (BYPASSED)' : ''}`);
  if (bypass) {
    console.log(`Bypass: reason="${bypass.reason}" by=${bypass.author} at=${bypass.created_at}`);
  }
  console.log('');
  console.log('Gates:');

  const GATES = ['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'];
  for (const gate of GATES) {
    const g = state.gates[gate];
    // Show ui_validation if data exists, even when has_frontend_changes is false
    if (gate === 'ui_validation' && !state.has_frontend_changes && !g) {
      console.log(`  ${gate}: SKIPPED (no frontend changes)`);
      continue;
    }
    if (g) {
      const score = g.score !== null && g.score !== undefined ? ` (score: ${g.score})` : '';
      const round = g.round !== null && g.round !== undefined ? ` [round ${g.round}]` : '';
      const violations = g.violations && g.violations.files
        ? ` violations=${g.violations.files.reduce((n, f) => n + ((f.violations || []).length), 0)}`
        : '';
      console.log(`  ${gate}: ${g.status}${score}${round}${violations}`);
    } else {
      console.log(`  ${gate}: NOT RUN`);
    }
  }

  // Show recent log entries if available
  const logDir = path.join(getPipelineDir(), 'logs');
  if (fs.existsSync(logDir)) {
    const date = new Date().toISOString().slice(0, 10);
    const logFile = path.join(logDir, `${date}.jsonl`);
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
      const recent = lines.slice(-5);
      console.log('');
      console.log('Recent events:');
      for (const line of recent) {
        try {
          const entry = JSON.parse(line);
          const extra = [entry.gate, entry.status].filter(Boolean).join(' ');
          console.log(`  [${entry.timestamp}] ${entry.event}${extra ? ' — ' + extra : ''}`);
        } catch { /* skip malformed */ }
      }
    }
  }
}

function cmdLog(args) {
  const logDir = path.join(getPipelineDir(), 'logs');
  if (!fs.existsSync(logDir)) {
    console.log('No log files found.');
    return;
  }
  const { flags } = parseFlags(args, {
    valueFlags: ['--last', '--gate', '--event']
  });
  const count = flags['--last'] ? parseInt(flags['--last'], 10) : 20;
  const gateFilter = flags['--gate'] || null;
  const eventFilter = flags['--event'] || null;

  const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl')).sort();
  const allEntries = [];

  // Walk newest-first; stop early once we have enough
  for (let i = logFiles.length - 1; i >= 0; i--) {
    const file = logFiles[i];
    const lines = fs.readFileSync(path.join(logDir, file), 'utf8').trim().split('\n');
    for (let j = lines.length - 1; j >= 0; j--) {
      const line = lines[j];
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (gateFilter && entry.gate !== gateFilter) continue;
        if (eventFilter && entry.event !== eventFilter) continue;
        allEntries.push(entry);
        if (allEntries.length >= count) break;
      } catch { /* skip malformed */ }
    }
    if (allEntries.length >= count) break;
  }
  allEntries.reverse();

  if (allEntries.length === 0) {
    console.log('No matching log entries found.');
    return;
  }

  console.log(`Pipeline Log (last ${allEntries.length} entries):`);
  console.log('');
  for (const entry of allEntries) {
    const parts = [`[${entry.timestamp}]`, entry.event];
    if (entry.gate) parts.push(`gate=${entry.gate}`);
    if (entry.status) parts.push(`status=${entry.status}`);
    if (entry.score !== undefined && entry.score !== null) parts.push(`score=${entry.score}`);
    if (entry.round !== undefined && entry.round !== null) parts.push(`round=${entry.round}`);
    if (entry.missing_gates) parts.push(`blocked=[${entry.missing_gates.length}]`);
    if (entry.reason) parts.push(`reason="${entry.reason.slice(0, 60)}"`);
    console.log(`  ${parts.join(' ')}`);
  }
}

// --- GitHub commit status sync ---

function getGitHubRepo() {
  return memo('gh-repo', () => {
    const remote = gitExec('remote get-url origin');
    if (!remote) return null;
    const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
    if (!match) return null;
    return `${match[1]}/${match[2]}`;
  });
}

function getHeadSha() { return memo('head-sha', () => gitExec('rev-parse HEAD')); }

function ghApiPost(endpoint, fields) {
  const args = ['api', endpoint, '-X', 'POST'];
  for (const [k, v] of Object.entries(fields)) {
    args.push('-f', `${k}=${v}`);
  }
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function ghApiGet(endpoint) {
  try {
    return execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function cmdPublish() {
  const state = readState();
  if (!state) {
    console.log('No active pipeline checkpoint to publish.');
    return;
  }
  const repo = getGitHubRepo();
  if (!repo) {
    console.error('ERROR: Could not determine GitHub repo from git remote.');
    process.exit(1);
  }
  const sha = getHeadSha();
  if (!sha) {
    console.error('ERROR: Could not determine HEAD commit SHA.');
    process.exit(1);
  }

  const prefix = (loadConfig().github && loadConfig().github.status_context_prefix) || 'pipeline/';
  const GATES = ['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'];
  const g = state.gates || {};
  let published = 0;

  for (const gate of GATES) {
    if (gate === 'ui_validation' && !state.has_frontend_changes) continue;
    const gateData = g[gate];
    let ghState, description;

    if (!gateData) {
      ghState = 'pending';
      description = 'Not yet run';
    } else if (gateData.status === 'passed' || gateData.status === 'completed') {
      ghState = 'success';
      description = gateData.score !== null && gateData.score !== undefined
        ? `Score: ${gateData.score}` : 'Completed';
    } else if (gateData.status === 'failed') {
      ghState = 'failure';
      description = gateData.score !== null && gateData.score !== undefined
        ? `Score: ${gateData.score} (below threshold)` : 'Failed';
    } else {
      ghState = 'pending';
      description = `Status: ${gateData.status}`;
    }

    const context = `${prefix}${gate}`;
    const result = ghApiPost(`repos/${repo}/statuses/${sha}`, {
      state: ghState,
      description,
      context
    });

    if (result !== null) {
      console.log(`  ${gate}: ${ghState} (${description})`);
      published++;
    } else {
      console.error(`  ${gate}: FAILED to publish`);
    }
  }

  logEvent({ event: 'status_published', repo, sha: sha.slice(0, 8), gates_published: published });
  console.log(`\nPublished ${published} gate status(es) to ${repo}@${sha.slice(0, 8)}`);
}

function cmdFetch() {
  const repo = getGitHubRepo();
  if (!repo) {
    console.error('ERROR: Could not determine GitHub repo from git remote.');
    process.exit(1);
  }
  const sha = getHeadSha();
  if (!sha) {
    console.error('ERROR: Could not determine HEAD commit SHA.');
    process.exit(1);
  }
  const prefix = (loadConfig().github && loadConfig().github.status_context_prefix) || 'pipeline/';
  const result = ghApiGet(`repos/${repo}/commits/${sha}/status`);
  if (!result) {
    console.log('No commit statuses found (or gh CLI unavailable).');
    return;
  }
  let data;
  try { data = JSON.parse(result); } catch {
    console.error('ERROR: Failed to parse GitHub API response.');
    return;
  }

  const statuses = (data.statuses || []).filter(s => s.context && s.context.startsWith(prefix));
  if (statuses.length === 0) {
    console.log(`No pipeline statuses found for ${repo}@${sha.slice(0, 8)}`);
    return;
  }

  const GATE_MAP = { success: 'passed', failure: 'failed', pending: 'pending' };

  mutateState((s) => {
    console.log(`Fetching pipeline statuses from ${repo}@${sha.slice(0, 8)}:\n`);
    for (const status of statuses) {
      const gateName = status.context.replace(prefix, '');
      const localStatus = GATE_MAP[status.state] || status.state;
      let score = null;
      const scoreMatch = (status.description || '').match(/Score:\s*([\d.]+)/);
      if (scoreMatch) score = parseFloat(scoreMatch[1]);
      console.log(`  ${gateName}: ${status.state} — ${status.description || ''}`);

      if (['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'].includes(gateName)) {
        const mappedStatus = (gateName === 'devils_advocate' || gateName === 'gap_analysis')
          ? (status.state === 'success' ? 'completed' : localStatus)
          : localStatus;
        s.gates[gateName] = {
          status: mappedStatus,
          score,
          round: null,
          updated_at: new Date().toISOString(),
          source: 'github'
        };
      }
    }
    recalculateCommitAllowed(s);
    return s;
  });

  logEvent({ event: 'status_fetched', repo, sha: sha.slice(0, 8), statuses: statuses.length });
  const final = readState();
  console.log(`\nLocal state updated. Commit allowed: ${final.commit_allowed}`);
}

// --- Bypass (audited override) ---

function cmdBypass(args) {
  const { flags } = parseFlags(args, { valueFlags: ['--reason'] });
  const reason = (flags['--reason'] || '').trim();
  const cfg = loadConfig().bypass || {};
  const minLen = cfg.min_reason_length !== undefined ? cfg.min_reason_length : 12;
  if (cfg.require_reason !== false && reason.length < minLen) {
    console.error(`ERROR: --reason is required (min ${minLen} chars).`);
    console.error('Usage: pipeline.js bypass --reason "<explanation>"');
    process.exit(1);
  }
  const author = gitExec('config user.email') || process.env.USER || process.env.USERNAME || 'unknown';
  const marker = {
    reason,
    author,
    branch: getBranch(),
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  };
  fs.writeFileSync(getBypassMarkerPath(), JSON.stringify(marker, null, 2) + '\n', 'utf8');
  logEvent({ event: 'bypass_created', reason, author });
  console.log(`Pipeline bypass active for 30 minutes.`);
  console.log(`Reason: ${reason}`);
  console.log(`Author: ${author}`);
  console.log(`\nNext git commit will pass through unblocked. The bypass is logged.`);
}

// --- Doctor (health check) ---

function cmdDoctor() {
  let problems = 0;
  let warnings = 0;
  const pass = (m) => console.log(`  ok  ${m}`);
  const fail = (m) => { console.log(`  FAIL ${m}`); problems++; };
  const warn = (m) => { console.log(`  warn ${m}`); warnings++; };

  console.log('Pipeline Doctor — checking environment...\n');

  // Node version
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor >= 18) pass(`Node.js ${process.versions.node}`);
  else fail(`Node.js ${process.versions.node} — need >= 18`);

  // Git
  const gitVer = gitExec('--version');
  if (gitVer) pass(`Git: ${gitVer}`); else fail('git not found on PATH');

  // Repo
  if (gitExec('rev-parse --is-inside-work-tree') === 'true') {
    pass(`Inside git repo: ${getRepoRoot()}`);
  } else {
    fail('Not inside a git repository');
  }

  // Hooks path
  const hooksPath = gitExec('config --global core.hooksPath');
  const expected = path.join(require('os').homedir(), '.githooks');
  if (hooksPath && (hooksPath === expected || path.resolve(hooksPath) === path.resolve(expected))) {
    pass(`git core.hooksPath = ${hooksPath}`);
  } else if (hooksPath) {
    warn(`git core.hooksPath = ${hooksPath} (expected ${expected}) — pipeline pre-commit hook may not fire`);
  } else {
    fail(`git core.hooksPath not set — run: git config --global core.hooksPath "${expected}"`);
  }

  // Hook file exists
  const hookPath = path.join(expected, 'pre-commit');
  if (fs.existsSync(hookPath)) pass(`pre-commit hook installed at ${hookPath}`);
  else fail(`pre-commit hook missing at ${hookPath} — run scripts/install.js`);

  // gh CLI
  try {
    execSync('gh --version', { stdio: 'pipe' });
    pass('gh CLI available (publish/fetch supported)');
  } catch {
    warn('gh CLI not found — `pipeline.js publish/fetch` will not work');
  }

  // claude / codex CLI presence
  try { execSync('claude --version', { stdio: 'pipe' }); pass('claude CLI available'); }
  catch { warn('claude CLI not found — Claude Code agent invocation disabled'); }
  try { execSync('codex --version', { stdio: 'pipe' }); pass('codex CLI available'); }
  catch { warn('codex CLI not found — Codex agent invocation disabled'); }

  // Config validity
  const cfg = loadConfig();
  if (!cfg.providers) fail('config.json: missing providers{}');
  else pass(`config.json: providers configured (${Object.keys(cfg.providers).join(', ')})`);
  if (!cfg.routing) fail('config.json: missing routing{}');
  else pass('config.json: routing configured');
  if (!cfg.scoring) warn('config.json: missing scoring{} — using defaults');
  else pass(`config.json: pass_threshold=${cfg.scoring.pass_threshold}, max_rounds=${cfg.scoring.max_rounds}`);

  // Pipeline dir
  if (fs.existsSync(path.join(getRepoRoot(), '.pipeline'))) {
    pass('.pipeline/ directory present');
  } else {
    warn('.pipeline/ directory not yet created (run `pipeline.js init`)');
  }

  // .gitignore
  const gi = path.join(getRepoRoot(), '.gitignore');
  if (fs.existsSync(gi)) {
    const content = fs.readFileSync(gi, 'utf8');
    if (content.includes('.pipeline')) pass('.gitignore excludes .pipeline/');
    else warn('.gitignore does NOT exclude .pipeline/ — pipeline state may be committed');
  } else {
    warn('No .gitignore — pipeline state may be committed');
  }

  console.log('');
  if (problems > 0) {
    console.log(`Doctor result: ${problems} problem(s), ${warnings} warning(s).`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`Doctor result: clean (with ${warnings} warning(s)).`);
  } else {
    console.log('Doctor result: clean.');
  }
}

// --- Help ---

const HELP_TEXT = {
  init: 'init\n  Initialize a pipeline checkpoint for this repo+branch.',
  gate: 'gate <name> <status> [score] [round] [--violations file.json]\n' +
        '  Record a gate result.\n' +
        '  name: anti_slop | ui_validation | devils_advocate | gap_analysis\n' +
        '  status: passed | failed | completed\n' +
        '  --violations: JSON file with full violation details from the gate agent.',
  check: 'check\n  Verify all gates passed. Exit 0 = allowed, 2 = blocked.',
  reset: 'reset [--all]\n  Clear current branch checkpoint (or everything with --all).',
  track: 'track <file>\n  Track a changed file in the checkpoint.',
  'post-edit': 'post-edit <file>\n  PostToolUse hook — returns additionalContext JSON for Claude Code.',
  'pre-commit': 'pre-commit\n  PreToolUse hook — reads stdin, returns deny JSON if gates incomplete.',
  stop: 'stop\n  Stop hook — warns once per session about incomplete gates.',
  report: 'report [--json]\n  Show pipeline status. --json for machine-readable.',
  status: 'status [--json]\n  Alias of report.',
  log: 'log [--last N] [--gate name] [--event type]\n  Query pipeline logs (newest first).',
  publish: 'publish\n  Post each gate result as a GitHub commit status (requires gh CLI).',
  fetch: 'fetch\n  Pull pipeline-prefixed commit statuses from GitHub into local state.',
  bypass: 'bypass --reason "<text>"\n' +
          '  Create a 30-min audited bypass of the commit gate.\n' +
          '  Logged with author + branch + timestamp.',
  doctor: 'doctor\n  Health check: node, git, hooksPath, gh, CLIs, config, .pipeline/, .gitignore.'
};

function cmdHelp(args) {
  const sub = args[0];
  if (sub && HELP_TEXT[sub]) {
    console.log(HELP_TEXT[sub]);
    return;
  }
  printTopHelp();
}

function printTopHelp() {
  console.log(`Cross-Model Agents Pipeline CLI v${VERSION}`);
  console.log('');
  console.log('Usage: pipeline.js <command> [args]');
  console.log('');
  console.log('Commands:');
  for (const [name, text] of Object.entries(HELP_TEXT)) {
    const firstLine = text.split('\n')[0];
    console.log(`  ${firstLine}`);
  }
  console.log('');
  console.log('Run `pipeline.js help <command>` for details.');
  console.log('');
  console.log('Gate names: anti_slop, ui_validation, devils_advocate, gap_analysis');
  console.log('Statuses: passed, failed, completed');
}

// --- Main ---

const [,, command, ...args] = process.argv;

// Global -h / --help / -v
if (command === '-h' || command === '--help') { printTopHelp(); process.exit(0); }
if (command === '-v' || command === '--version') { console.log(VERSION); process.exit(0); }

switch (command) {
  case 'init':       cmdInit(); break;
  case 'gate':       cmdGate(args); break;
  case 'check':      cmdCheck(); break;
  case 'reset':      cmdReset(args); break;
  case 'track':      cmdTrack(args); break;
  case 'post-edit':  cmdPostEdit(args); break;
  case 'pre-commit': cmdPreCommit(); break;
  case 'stop':       cmdStop(); break;
  case 'report':
  case 'status':     cmdReport(args); break;
  case 'log':        cmdLog(args); break;
  case 'publish':    cmdPublish(); break;
  case 'fetch':      cmdFetch(); break;
  case 'bypass':     cmdBypass(args); break;
  case 'doctor':     cmdDoctor(); break;
  case 'help':       cmdHelp(args); break;
  default:
    printTopHelp();
    process.exit(command ? 1 : 0);
}
