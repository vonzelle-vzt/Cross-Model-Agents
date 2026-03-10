#!/usr/bin/env node
// Cross-Model Adversarial Agents — Pipeline Enforcement (Node.js)
// Replaces all 8 bash pipeline scripts with a single cross-platform tool.
//
// Usage:
//   node pipeline.js init                              Initialize checkpoint
//   node pipeline.js gate <name> <status> [score] [round]  Record gate result
//   node pipeline.js check                             Verify all gates passed
//   node pipeline.js reset [--all]                     Clear checkpoint
//   node pipeline.js track <file>                      Track file change
//   node pipeline.js post-edit <file>                  PostToolUse hook (returns JSON)
//   node pipeline.js pre-commit                        PreToolUse hook (returns JSON)
//   node pipeline.js stop                              Stop hook (returns JSON)
//   node pipeline.js report                            Show gate status summary
//   node pipeline.js log [--last N] [--gate] [--event]  Query pipeline logs
//   node pipeline.js publish                            Post gate results to GitHub
//   node pipeline.js fetch                              Pull gate statuses from GitHub

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

// --- Git helpers ---

function gitExec(args) {
  try {
    return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

function getRepoRoot() {
  return gitExec('rev-parse --show-toplevel') || process.cwd();
}

function getRepoSlug() {
  return path.basename(getRepoRoot());
}

function getBranch() {
  return gitExec('rev-parse --abbrev-ref HEAD') || 'unknown';
}

// --- State file path ---

function getPipelineDir() {
  const root = getRepoRoot();
  const dir = path.join(root, '.pipeline');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCheckpointPath() {
  const branch = getBranch().replace(/\//g, '-');
  return path.join(getPipelineDir(), `state-${branch}.json`);
}

function getLogDir() {
  const dir = path.join(getPipelineDir(), 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getWarnMarkerPath(sessionId) {
  return path.join(getPipelineDir(), `.stop-warned-${sessionId}`);
}

// --- State read/write ---

function readState() {
  const filepath = getCheckpointPath();
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  const filepath = getCheckpointPath();
  fs.writeFileSync(filepath, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

// --- Logging ---

function logEvent(event) {
  const logDir = getLogDir();
  const date = new Date().toISOString().slice(0, 10);
  const logFile = path.join(logDir, `${date}.jsonl`);
  const entry = { timestamp: new Date().toISOString(), ...event };
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf8');
}

// --- Frontend detection ---

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

// --- Subcommands ---

function cmdInit() {
  const existing = readState();
  if (existing) {
    process.exit(0);
  }

  const sessionId = crypto.randomBytes(6).toString('hex');
  const state = {
    session_id: sessionId,
    repo: getRepoSlug(),
    branch: getBranch(),
    changed_files: [],
    has_frontend_changes: false,
    gates: {},
    commit_allowed: false,
    created_at: new Date().toISOString()
  };
  writeState(state);
  logEvent({ event: 'pipeline_init', session_id: sessionId });
  console.log(`Pipeline checkpoint initialized: ${getCheckpointPath()}`);
}

function cmdGate(args) {
  const VALID_GATES = ['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'];
  const VALID_STATUSES = ['passed', 'failed', 'completed'];

  if (args.length < 2) {
    console.error('Usage: pipeline.js gate <gate_name> <status> [score] [round]');
    console.error(`  gate_name: ${VALID_GATES.join(', ')}`);
    console.error(`  status: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  const [gateName, status] = args;
  const score = args[2] !== undefined ? parseFloat(args[2]) : null;
  const round = args[3] !== undefined ? parseInt(args[3], 10) : null;

  if (!VALID_GATES.includes(gateName)) {
    console.error(`ERROR: Invalid gate name '${gateName}'. Must be one of: ${VALID_GATES.join(', ')}`);
    process.exit(1);
  }
  if (!VALID_STATUSES.includes(status)) {
    console.error(`ERROR: Invalid status '${status}'. Must be one of: ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }

  // Auto-initialize if needed
  let state = readState();
  if (!state) {
    cmdInit();
    state = readState();
  }

  state.gates[gateName] = {
    status,
    score,
    round,
    updated_at: new Date().toISOString()
  };

  recalculateCommitAllowed(state);
  writeState(state);

  logEvent({ event: 'gate_result', gate: gateName, status, score, round });
  console.log(`Gate '${gateName}' recorded: status=${status} score=${score} round=${round}`);
  console.log(`Commit allowed: ${state.commit_allowed}`);
}

function cmdCheck() {
  const state = readState();
  if (!state) {
    // No checkpoint = no pipeline active = allow
    process.exit(0);
  }

  if (state.commit_allowed) {
    console.log('All pipeline gates passed. Commit allowed.');
    process.exit(0);
  }

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

  console.log('PIPELINE CHECK FAILED \u2014 commit not allowed.');
  console.log('');
  for (const msg of missing) {
    console.log(`  ${msg}`);
  }
  console.log('');
  console.log('Complete the required gates before committing.');
  process.exit(2);
}

function cmdReset(args) {
  if (args[0] === '--all') {
    const pipelineDir = getPipelineDir();
    const files = fs.readdirSync(pipelineDir).filter(f => f.startsWith('state-') || f.startsWith('.stop-warned-'));
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

  // Auto-initialize if needed
  let state = readState();
  if (!state) {
    cmdInit();
    state = readState();
  }

  // Add file (deduplicated)
  if (!state.changed_files.includes(filePath)) {
    state.changed_files.push(filePath);
  }

  // Check if frontend file
  if (isFrontendFile(filePath)) {
    state.has_frontend_changes = true;
  }

  writeState(state);
}

function cmdPostEdit(args) {
  // Consume stdin (hook sends JSON but we use file_path arg)
  const filePath = args[0] || '';

  if (!filePath || !isCodeFile(filePath)) {
    console.log('{}');
    return;
  }

  // Track the file change
  try {
    cmdTrack([filePath]);
  } catch { /* non-fatal */ }

  // Check for frontend changes
  const state = readState();
  const hasFrontend = (state && state.has_frontend_changes) || isFrontendFile(filePath);

  // Build reminder
  let gates = '- Anti-slop gate (codex-anti-slop agent)';
  if (hasFrontend) {
    gates += '\\n- UI validation gate (codex-ui-validator agent) [frontend file detected]';
  }
  gates += '\\n- Devil\'s advocate (codex-devils-advocate agent)';
  gates += '\\n- Gap analysis (codex-gap-analyst agent)';

  const message = `You modified ${filePath}. Pipeline gates REQUIRED before commit:\\n${gates}\\n\\nRun these gates before attempting git commit.`;

  console.log(JSON.stringify({ additionalContext: message.replace(/\\n/g, '\n') }));
}

function cmdPreCommit() {
  // Read stdin for hook input
  let hookInput = '';
  try {
    hookInput = fs.readFileSync(0, 'utf8');
  } catch { /* no stdin */ }

  // Extract command from hook input
  let command = '';
  try {
    const parsed = JSON.parse(hookInput);
    command = (parsed.tool_input && parsed.tool_input.command) || '';
  } catch { /* not JSON */ }

  // Check if git commit (but not --allow-empty)
  const isGitCommit = /^\s*git\s+commit(\s|$)/.test(command) && !/--allow-empty/.test(command);
  if (!isGitCommit) {
    console.log('{}');
    return;
  }

  // Check for override
  if (process.env.SKIP_PIPELINE_CHECK === '1') {
    console.log('{}');
    return;
  }

  // Check pipeline state
  const state = readState();
  if (!state) {
    console.log('{}');
    return;
  }

  if (state.commit_allowed) {
    console.log('{}');
    return;
  }

  // Build missing gates list
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

  const reason = `PIPELINE GATE BLOCKED: Cannot commit without completing required gates.\n\nMissing gates:\n${lines.join('\n')}\n\nRun these agents before committing.`;

  logEvent({ event: 'commit_blocked', missing_gates: lines });
  console.log(JSON.stringify({ decision: 'deny', reason }));
}

function cmdStop() {
  // Consume stdin
  try { fs.readFileSync(0, 'utf8'); } catch { /* ok */ }

  const state = readState();
  if (!state || state.commit_allowed) {
    console.log('{}');
    return;
  }

  // Loop prevention
  if (state.session_id) {
    const marker = getWarnMarkerPath(state.session_id);
    if (fs.existsSync(marker)) {
      console.log('{}');
      return;
    }
    fs.writeFileSync(marker, '', 'utf8');
  }

  // Build gate status
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

function cmdReport() {
  const state = readState();
  if (!state) {
    console.log('No active pipeline checkpoint.');
    return;
  }

  console.log(`Pipeline Status: ${state.repo}/${state.branch}`);
  console.log(`Session: ${state.session_id}`);
  console.log(`Created: ${state.created_at}`);
  console.log(`Changed files: ${state.changed_files.length}`);
  console.log(`Frontend changes: ${state.has_frontend_changes}`);
  console.log(`Commit allowed: ${state.commit_allowed}`);
  console.log('');
  console.log('Gates:');

  const GATES = ['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'];
  for (const gate of GATES) {
    if (gate === 'ui_validation' && !state.has_frontend_changes) {
      console.log(`  ${gate}: SKIPPED (no frontend changes)`);
      continue;
    }
    const g = state.gates[gate];
    if (g) {
      const score = g.score !== null ? ` (score: ${g.score})` : '';
      const round = g.round !== null ? ` [round ${g.round}]` : '';
      console.log(`  ${gate}: ${g.status}${score}${round}`);
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
          console.log(`  [${entry.timestamp}] ${entry.event}${entry.gate ? ': ' + entry.gate : ''}${entry.status ? ' = ' + entry.status : ''}`);
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

  // Parse flags
  let count = 20;
  let gateFilter = null;
  let eventFilter = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--last' && args[i + 1]) { count = parseInt(args[i + 1], 10); i++; }
    if (args[i] === '--gate' && args[i + 1]) { gateFilter = args[i + 1]; i++; }
    if (args[i] === '--event' && args[i + 1]) { eventFilter = args[i + 1]; i++; }
  }

  // Read all log files, sorted by name (date)
  const logFiles = fs.readdirSync(logDir).filter(f => f.endsWith('.jsonl')).sort();
  const allEntries = [];

  for (const file of logFiles) {
    const lines = fs.readFileSync(path.join(logDir, file), 'utf8').trim().split('\n');
    for (const line of lines) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (gateFilter && entry.gate !== gateFilter) continue;
        if (eventFilter && entry.event !== eventFilter) continue;
        allEntries.push(entry);
      } catch { /* skip malformed */ }
    }
  }

  const entries = allEntries.slice(-count);
  if (entries.length === 0) {
    console.log('No matching log entries found.');
    return;
  }

  console.log(`Pipeline Log (last ${entries.length} entries):`);
  console.log('');
  for (const entry of entries) {
    const parts = [`[${entry.timestamp}]`, entry.event];
    if (entry.gate) parts.push(`gate=${entry.gate}`);
    if (entry.status) parts.push(`status=${entry.status}`);
    if (entry.score !== undefined && entry.score !== null) parts.push(`score=${entry.score}`);
    if (entry.round !== undefined && entry.round !== null) parts.push(`round=${entry.round}`);
    if (entry.missing_gates) parts.push(`blocked=[${entry.missing_gates.length}]`);
    console.log(`  ${parts.join(' ')}`);
  }
}

// --- GitHub commit status sync ---

function getGitHubRepo() {
  const remote = gitExec('remote get-url origin');
  if (!remote) return null;
  // Parse owner/repo from git remote URL
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!match) return null;
  return `${match[1]}/${match[2]}`;
}

function getHeadSha() {
  return gitExec('rev-parse HEAD');
}

function ghExec(apiArgs) {
  try {
    return execSync(`gh api ${apiArgs}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (e) {
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

  // Read config for status prefix
  let prefix = 'pipeline/';
  try {
    const configPath = path.join(getRepoRoot(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.github && config.github.status_context_prefix) {
        prefix = config.github.status_context_prefix;
      }
    }
  } catch { /* use default */ }

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
      description = gateData.score !== null ? `Score: ${gateData.score}` : 'Completed';
    } else if (gateData.status === 'failed') {
      ghState = 'failure';
      description = gateData.score !== null ? `Score: ${gateData.score} (below threshold)` : 'Failed';
    } else {
      ghState = 'pending';
      description = `Status: ${gateData.status}`;
    }

    const context = `${prefix}${gate}`;
    const body = JSON.stringify({ state: ghState, description, context });
    const result = ghExec(`repos/${repo}/statuses/${sha} -X POST --input - <<< '${body.replace(/'/g, "'\\''")}'`);

    if (result !== null) {
      console.log(`  ${gate}: ${ghState} (${description})`);
      published++;
    } else {
      // Try alternative approach with -f flags
      const result2 = ghExec(`repos/${repo}/statuses/${sha} -X POST -f state="${ghState}" -f description="${description}" -f context="${context}"`);
      if (result2 !== null) {
        console.log(`  ${gate}: ${ghState} (${description})`);
        published++;
      } else {
        console.error(`  ${gate}: FAILED to publish`);
      }
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

  // Read config for status prefix
  let prefix = 'pipeline/';
  try {
    const configPath = path.join(getRepoRoot(), 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (config.github && config.github.status_context_prefix) {
        prefix = config.github.status_context_prefix;
      }
    }
  } catch { /* use default */ }

  const result = ghExec(`repos/${repo}/commits/${sha}/status`);
  if (!result) {
    console.log('No commit statuses found (or gh CLI unavailable).');
    return;
  }

  let data;
  try {
    data = JSON.parse(result);
  } catch {
    console.error('ERROR: Failed to parse GitHub API response.');
    return;
  }

  const statuses = (data.statuses || []).filter(s => s.context && s.context.startsWith(prefix));
  if (statuses.length === 0) {
    console.log(`No pipeline statuses found for ${repo}@${sha.slice(0, 8)}`);
    return;
  }

  // Auto-initialize state if needed
  let state = readState();
  if (!state) {
    cmdInit();
    state = readState();
  }

  const GATE_MAP = { success: 'passed', failure: 'failed', pending: 'pending' };

  console.log(`Fetching pipeline statuses from ${repo}@${sha.slice(0, 8)}:\n`);
  for (const status of statuses) {
    const gateName = status.context.replace(prefix, '');
    const localStatus = GATE_MAP[status.state] || status.state;

    // Parse score from description if present
    let score = null;
    const scoreMatch = (status.description || '').match(/Score:\s*([\d.]+)/);
    if (scoreMatch) score = parseFloat(scoreMatch[1]);

    console.log(`  ${gateName}: ${status.state} — ${status.description || ''}`);

    // Update local state
    if (['anti_slop', 'ui_validation', 'devils_advocate', 'gap_analysis'].includes(gateName)) {
      const mappedStatus = gateName === 'devils_advocate' || gateName === 'gap_analysis'
        ? (status.state === 'success' ? 'completed' : localStatus)
        : localStatus;
      state.gates[gateName] = {
        status: mappedStatus,
        score,
        round: null,
        updated_at: new Date().toISOString(),
        source: 'github'
      };
    }
  }

  recalculateCommitAllowed(state);
  writeState(state);

  logEvent({ event: 'status_fetched', repo, sha: sha.slice(0, 8), statuses: statuses.length });
  console.log(`\nLocal state updated. Commit allowed: ${state.commit_allowed}`);
}

// --- Main ---

const [,, command, ...args] = process.argv;

switch (command) {
  case 'init':       cmdInit(); break;
  case 'gate':       cmdGate(args); break;
  case 'check':      cmdCheck(); break;
  case 'reset':      cmdReset(args); break;
  case 'track':      cmdTrack(args); break;
  case 'post-edit':  cmdPostEdit(args); break;
  case 'pre-commit': cmdPreCommit(); break;
  case 'stop':       cmdStop(); break;
  case 'report':     cmdReport(); break;
  case 'log':        cmdLog(args); break;
  case 'publish':    cmdPublish(); break;
  case 'fetch':      cmdFetch(); break;
  default:
    console.log('Cross-Model Agents Pipeline Enforcement');
    console.log('');
    console.log('Usage: node pipeline.js <command> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  init                              Initialize pipeline checkpoint');
    console.log('  gate <name> <status> [score] [round]  Record a gate result');
    console.log('  check                             Verify all gates passed');
    console.log('  reset [--all]                     Clear pipeline state');
    console.log('  track <file>                      Track a changed file');
    console.log('  post-edit <file>                  PostToolUse hook (JSON output)');
    console.log('  pre-commit                        PreToolUse hook (JSON output)');
    console.log('  stop                              Stop hook (JSON output)');
    console.log('  report                            Show pipeline status summary');
    console.log('  log [--last N] [--gate name] [--event type]  Query pipeline logs');
    console.log('  publish                           Post gate results as GitHub commit statuses');
    console.log('  fetch                             Pull gate statuses from GitHub into local state');
    console.log('');
    console.log('Gate names: anti_slop, ui_validation, devils_advocate, gap_analysis');
    console.log('Statuses: passed, failed, completed');
    process.exit(command ? 1 : 0);
}
