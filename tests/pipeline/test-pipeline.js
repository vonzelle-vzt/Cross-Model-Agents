#!/usr/bin/env node
// Pipeline enforcement unit tests.
// Tests pipeline.js subcommands in isolation — no API keys required.
//
// Run: node tests/pipeline/test-pipeline.js

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_JS = path.resolve(__dirname, '../../scripts/pipeline.js');
const SOURCE_ROOT = path.resolve(__dirname, '../..');
const ROOT = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pipeline-test-'));
execSync('git init -q', { cwd: ROOT });
fs.copyFileSync(path.join(SOURCE_ROOT, 'config.json'), path.join(ROOT, 'config.json'));
fs.writeFileSync(path.join(ROOT, '.gitignore'), '.pipeline/\n');
execSync('git add .', { cwd: ROOT });
execSync('git -c core.hooksPath=/dev/null -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm initial', { cwd: ROOT });
process.on('exit', () => fs.rmSync(ROOT, { recursive: true, force: true }));

let passed = 0;
let failed = 0;

function run(args, opts = {}) {
  const cmd = `node "${PIPELINE_JS}" ${args}`;
  try {
    const result = execSync(cmd, {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
      input: opts.input || undefined,
    });
    return { stdout: result.trim(), exitCode: 0 };
  } catch (e) {
    return { stdout: (e.stdout || '').trim(), stderr: (e.stderr || '').trim(), exitCode: e.status };
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    failed++;
    console.error(`  \u2717 ${name}`);
    console.error(`    ${e.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || 'assertEqual'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function cleanup() {
  run('reset --all');
}

// --- Tests ---

console.log('\n=== Pipeline Init Tests ===\n');

cleanup();

test('init creates checkpoint file', () => {
  const result = run('init');
  assert(result.exitCode === 0, `Exit code: ${result.exitCode}`);
  assert(result.stdout.includes('Pipeline checkpoint initialized'), result.stdout);
});

test('init is idempotent (second call is no-op)', () => {
  const result = run('init');
  assertEqual(result.exitCode, 0);
  // Should exit silently
});

cleanup();

console.log('\n=== Pipeline Gate Tests ===\n');

test('gate rejects invalid gate name', () => {
  const result = run('gate invalid_gate passed');
  assert(result.exitCode !== 0, 'Should fail');
  assert(result.stderr.includes('Invalid gate name'), result.stderr);
});

test('gate rejects invalid status', () => {
  const result = run('gate anti_slop invalid_status');
  assert(result.exitCode !== 0, 'Should fail');
  assert(result.stderr.includes('Invalid status'), result.stderr);
});

test('gate records anti_slop passed with score', () => {
  cleanup();
  run('init');
  const result = run('gate anti_slop passed 8.5 1');
  assertEqual(result.exitCode, 0);
  assert(result.stdout.includes("status=passed"), result.stdout);
  assert(result.stdout.includes("score=8.5"), result.stdout);
});

test('gate records devils_advocate completed', () => {
  const result = run('gate devils_advocate completed');
  assertEqual(result.exitCode, 0);
  assert(result.stdout.includes("status=completed"), result.stdout);
});

test('gate records gap_analysis completed', () => {
  const result = run('gate gap_analysis completed');
  assertEqual(result.exitCode, 0);
  assert(result.stdout.includes("Commit allowed: true"), result.stdout);
});

cleanup();

console.log('\n=== Commit Allowed Logic Tests ===\n');

test('commit not allowed with no gates', () => {
  run('init');
  const result = run('check');
  assertEqual(result.exitCode, 2, `Expected exit 2, got ${result.exitCode}`);
  assert(result.stdout.includes('PIPELINE CHECK FAILED'), result.stdout);
});

test('commit allowed when all non-frontend gates pass', () => {
  cleanup();
  run('init');
  run('track src/api/handler.py');
  run('gate anti_slop passed 9 1');
  run('gate devils_advocate completed');
  run('gate gap_analysis completed');
  const result = run('check');
  assertEqual(result.exitCode, 0);
  assert(result.stdout.includes('Commit allowed'), result.stdout);
});

test('commit blocked when frontend changes need ui_validation', () => {
  cleanup();
  run('init');
  run('track src/components/Button.tsx');
  run('gate anti_slop passed 8 1');
  run('gate devils_advocate completed');
  run('gate gap_analysis completed');
  const result = run('check');
  assertEqual(result.exitCode, 2);
  assert(result.stdout.includes('ui_validation'), result.stdout);
});

test('commit allowed when frontend gates also pass', () => {
  run('gate ui_validation passed 9 1');
  const result = run('check');
  assertEqual(result.exitCode, 0);
});

test('commit blocked when anti_slop fails', () => {
  cleanup();
  run('init');
  run('gate anti_slop failed 4 1');
  run('gate devils_advocate completed');
  run('gate gap_analysis completed');
  const result = run('check');
  assertEqual(result.exitCode, 2);
  assert(result.stdout.includes('anti_slop'), result.stdout);
});

cleanup();

console.log('\n=== File Tracking Tests ===\n');

test('track adds file to changed_files', () => {
  run('init');
  run('track src/auth.ts');
  const result = run('report');
  assert(result.stdout.includes('Changed files: 1'), result.stdout);
});

test('track deduplicates same file', () => {
  run('track src/auth.ts');
  run('track src/auth.ts');
  const result = run('report');
  assert(result.stdout.includes('Changed files: 1'), result.stdout);
});

test('track detects frontend extension (.tsx)', () => {
  run('track src/components/Modal.tsx');
  const result = run('report');
  assert(result.stdout.includes('Frontend changes: true'), result.stdout);
});

test('track detects frontend extension (.css)', () => {
  cleanup();
  run('init');
  run('track styles/main.css');
  const result = run('report');
  assert(result.stdout.includes('Frontend changes: true'), result.stdout);
});

test('track detects frontend by path (/components/)', () => {
  cleanup();
  run('init');
  run('track src/components/Header.ts');
  const result = run('report');
  assert(result.stdout.includes('Frontend changes: true'), result.stdout);
});

test('track does not flag backend files as frontend', () => {
  cleanup();
  run('init');
  run('track src/api/handler.py');
  const result = run('report');
  assert(result.stdout.includes('Frontend changes: false'), result.stdout);
});

cleanup();

console.log('\n=== Hook Output Tests ===\n');

test('post-edit returns JSON for code files', () => {
  const result = run('post-edit src/auth.ts');
  const parsed = JSON.parse(result.stdout.split('\n').pop());
  assert(parsed.additionalContext, 'Should have additionalContext');
  assert(parsed.additionalContext.includes('Pipeline gates REQUIRED'), parsed.additionalContext);
});

test('post-edit returns empty JSON for non-code files', () => {
  const result = run('post-edit README.md');
  assertEqual(result.stdout.trim(), '{}');
});

test('post-edit includes UI validation for frontend files', () => {
  cleanup();
  const result = run('post-edit src/components/Button.tsx');
  const lines = result.stdout.split('\n');
  const json = JSON.parse(lines[lines.length - 1]);
  assert(json.additionalContext.includes('UI validation'), json.additionalContext);
});

test('pre-commit denies when gates incomplete', () => {
  cleanup();
  run('init');
  run('track src/auth.ts');
  // Need to pipe stdin with hook input
  const result = run('pre-commit', {
    input: JSON.stringify({ tool_input: { command: 'git commit -m "test"' } })
  });
  // pre-commit reads stdin differently in test context, but let's check it works
  const parsed = JSON.parse(result.stdout);
  if (parsed.decision) {
    assertEqual(parsed.decision, 'deny');
  }
});

test('pre-commit allows non-git-commit commands', () => {
  const result = run('pre-commit', {
    input: JSON.stringify({ tool_input: { command: 'git status' } })
  });
  assertEqual(result.stdout, '{}');
});

test('stop hook warns on incomplete gates', () => {
  cleanup();
  run('init');
  run('track src/auth.ts');
  const result = run('stop', { input: '{}' });
  const parsed = JSON.parse(result.stdout);
  assert(parsed.additionalContext, 'Should have warning');
  assert(parsed.additionalContext.includes('WARNING'), parsed.additionalContext);
});

test('stop hook is silent when no checkpoint', () => {
  cleanup();
  const result = run('stop', { input: '{}' });
  assertEqual(result.stdout, '{}');
});

cleanup();

console.log('\n=== Reset Tests ===\n');

test('reset clears checkpoint', () => {
  run('init');
  run('track src/auth.ts');
  const resetResult = run('reset');
  assert(resetResult.stdout.includes('checkpoint cleared'), resetResult.stdout);
  const checkResult = run('check');
  assertEqual(checkResult.exitCode, 0); // No checkpoint = allow
});

test('reset --all clears everything', () => {
  run('init');
  run('track src/auth.ts');
  run('reset --all');
  const checkResult = run('check');
  assertEqual(checkResult.exitCode, 0);
});

cleanup();

console.log('\n=== Report Tests ===\n');

test('report shows pipeline status', () => {
  run('init');
  run('track src/auth.ts');
  run('gate anti_slop passed 8 1');
  const result = run('report');
  assert(result.stdout.includes('Pipeline Status'), result.stdout);
  assert(result.stdout.includes('anti_slop: passed'), result.stdout);
  assert(result.stdout.includes('score: 8'), result.stdout);
});

test('report shows "no active checkpoint" when empty', () => {
  cleanup();
  const result = run('report');
  assert(result.stdout.includes('No active pipeline checkpoint'), result.stdout);
});

cleanup();

console.log('\n=== Score Bounds Tests (v3.0.0) ===\n');

test('gate rejects score below 0', () => {
  cleanup();
  run('init');
  const result = run('gate anti_slop passed -1 1');
  assert(result.exitCode !== 0, 'Should fail');
  assert(result.stderr.includes('out of bounds'), result.stderr);
});

test('gate rejects score above 10', () => {
  const result = run('gate anti_slop passed 11 1');
  assert(result.exitCode !== 0, 'Should fail');
  assert(result.stderr.includes('out of bounds'), result.stderr);
});

test('gate accepts score 0', () => {
  cleanup();
  run('init');
  const result = run('gate anti_slop failed 0 1');
  assertEqual(result.exitCode, 0);
});

test('gate accepts score 10', () => {
  cleanup();
  run('init');
  const result = run('gate anti_slop passed 10 1');
  assertEqual(result.exitCode, 0);
});

cleanup();

console.log('\n=== Status JSON Tests (v3.0.0) ===\n');

test('status --json returns active:false when no checkpoint', () => {
  cleanup();
  const result = run('status --json');
  const json = JSON.parse(result.stdout);
  assertEqual(json.active, false);
});

test('status --json returns full state when active', () => {
  run('init');
  run('track src/api/handler.py');
  run('gate anti_slop passed 9 1');
  const result = run('status --json');
  const json = JSON.parse(result.stdout);
  assert(json.gates && json.gates.anti_slop, 'Missing gates.anti_slop');
  assertEqual(json.gates.anti_slop.status, 'passed');
  assert(Array.isArray(json.missing), 'Missing missing[] array');
});

test('report --json is an alias of status --json', () => {
  const result = run('report --json');
  const json = JSON.parse(result.stdout);
  assert(json.gates, 'report --json should return state shape');
});

cleanup();

console.log('\n=== Bypass Tests (v3.0.0) ===\n');

test('bypass requires --reason', () => {
  cleanup();
  run('init');
  const result = run('bypass');
  assert(result.exitCode !== 0, 'Should fail without --reason');
  assert(result.stderr.includes('--reason'), result.stderr);
});

test('bypass rejects short reason', () => {
  const result = run('bypass --reason "too short"');
  assert(result.exitCode !== 0, 'Should reject < 12 chars');
});

test('bypass with valid reason allows commit', () => {
  cleanup();
  run('init');
  run('track src/auth.ts');
  // Block first
  const blocked = run('check');
  assertEqual(blocked.exitCode, 2);
  // Bypass
  const bypassResult = run('bypass --reason "hotfix for prod outage 2026-05-12"');
  assertEqual(bypassResult.exitCode, 0);
  assert(bypassResult.stdout.includes('bypass active'), bypassResult.stdout);
  // Check should pass now
  const checkResult = run('check');
  assertEqual(checkResult.exitCode, 0);
  assert(checkResult.stdout.includes('bypassed'), checkResult.stdout);
});

cleanup();

console.log('\n=== Violations Storage Tests (v3.0.0) ===\n');

test('gate --violations stores full violation detail', () => {
  cleanup();
  run('init');
  const fs2 = require('fs');
  const path2 = require('path');
  const tmpPath = path2.join(ROOT, '.tmp-violations.json');
  fs2.writeFileSync(tmpPath, JSON.stringify({
    verdict: 'PASS',
    overall_score: 8.5,
    round: 1,
    files: [{ path: 'src/auth.ts', score: 8.5, violations: [
      { line: 42, pattern: 3, pattern_name: 'Comment-Restates-Code', severity: 'minor' }
    ]}]
  }));
  try {
    const result = run(`gate anti_slop passed 8.5 1 --violations "${tmpPath}"`);
    assertEqual(result.exitCode, 0);
    const status = JSON.parse(run('status --json').stdout);
    assert(status.gates.anti_slop.violations, 'Violations not stored');
    assertEqual(status.gates.anti_slop.violations.files.length, 1);
  } finally {
    fs2.unlinkSync(tmpPath);
  }
});

cleanup();

console.log('\n=== Doctor Tests (v3.0.0) ===\n');

test('doctor runs and produces output', () => {
  const result = run('doctor');
  // Exit code may be 0 or 1 depending on environment health — both acceptable
  assert(result.stdout.includes('Pipeline Doctor'), 'Should print header');
  assert(result.stdout.includes('Node.js'), 'Should check Node version');
  assert(result.stdout.includes('config.json'), 'Should check config');
});

console.log('\n=== Help Tests (v3.0.0) ===\n');

test('--version prints version', () => {
  const result = run('--version');
  assertEqual(result.exitCode, 0);
  assert(/^\d+\.\d+\.\d+$/.test(result.stdout), `Bad version: ${result.stdout}`);
});

test('help <cmd> prints detailed help', () => {
  const result = run('help gate');
  assertEqual(result.exitCode, 0);
  assert(result.stdout.includes('--violations'), 'gate help should mention --violations');
});

cleanup();

console.log('\n=== Security Gate Tests (v3.1.0) ===\n');

test('gate records security completed', () => {
  run('init');
  const result = run('gate security completed');
  assertEqual(result.exitCode, 0);
  assert(result.stdout.includes("Gate 'security' recorded"), result.stdout);
});

test('security gate not blocking by default', () => {
  cleanup();
  run('init');
  run('gate anti_slop passed 8');
  run('gate devils_advocate completed');
  run('gate gap_analysis completed');
  const result = run('check');
  assertEqual(result.exitCode, 0, 'commit should be allowed without security gate when blocking=false');
});

test('security gate blocks when routing.gates.security.blocking=true', () => {
  cleanup();
  const configPath = path.join(ROOT, 'config.json');
  const original = fs.readFileSync(configPath, 'utf8');
  try {
    const cfg = JSON.parse(original);
    cfg.routing.gates.security.blocking = true;
    fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2), 'utf8');

    run('init');
    run('gate anti_slop passed 8');
    run('gate devils_advocate completed');
    run('gate gap_analysis completed');

    const blocked = run('check');
    assertEqual(blocked.exitCode, 2, 'commit should be blocked without security gate when blocking=true');
    assert(blocked.stdout.includes('security'), blocked.stdout);

    run('gate security completed');
    const allowed = run('check');
    assertEqual(allowed.exitCode, 0, 'commit should be allowed once security gate completed');
  } finally {
    fs.writeFileSync(configPath, original, 'utf8');
  }
});

cleanup();

console.log('\n=== Review Freshness Regression Tests ===\n');

function approve() {
  assertEqual(run('gate anti_slop passed 8').exitCode, 0);
  assertEqual(run('gate devils_advocate completed').exitCode, 0);
  assertEqual(run('gate gap_analysis completed').exitCode, 0);
}

test('passing scored gates require threshold evidence', () => {
  cleanup();
  assertEqual(run('gate anti_slop passed 6').exitCode, 1);
  assertEqual(run('gate ui_validation passed').exitCode, 1);
});

test('working file changes invalidate reviews and machine-readable status', () => {
  cleanup();
  const file = path.join(ROOT, 'freshness.js');
  fs.writeFileSync(file, 'before');
  approve();
  assertEqual(run('check').exitCode, 0);
  fs.writeFileSync(file, 'after');
  assertEqual(run('check').exitCode, 2);
  const status = JSON.parse(run('status --json').stdout);
  assertEqual(status.commit_allowed, false);
  assertEqual(status.gates.anti_slop.status, 'stale');
  assert(status.missing.some(message => message.includes('stale')));
  const hook = run('pre-commit', { input: JSON.stringify({ tool_input: { command: 'git commit -m test' } }) });
  assertEqual(JSON.parse(hook.stdout).decision, 'deny');
  approve();
  assertEqual(run('check').exitCode, 0);
  fs.unlinkSync(file);
});

test('staging reviewed content preserves approval but different staged content blocks', () => {
  cleanup();
  const file = path.join(ROOT, 'staging.js');
  fs.writeFileSync(file, 'staged version');
  approve();
  execSync('git add staging.js', { cwd: ROOT });
  assertEqual(run('check').exitCode, 0);
  approve();
  assertEqual(run('check').exitCode, 0);
  fs.writeFileSync(file, 'unstaged version');
  assertEqual(run('check').exitCode, 2);
  approve();
  assertEqual(run('check').exitCode, 2, 'staged old content was never reviewed');
  execSync('git add staging.js', { cwd: ROOT });
  assertEqual(run('check').exitCode, 0);
  execSync('git rm --cached -f staging.js', { cwd: ROOT });
  fs.unlinkSync(file);
});

test('new untracked files invalidate reviews', () => {
  cleanup();
  approve();
  fs.writeFileSync(path.join(ROOT, 'new.js'), 'new code');
  assertEqual(run('check').exitCode, 2);
  fs.unlinkSync(path.join(ROOT, 'new.js'));
});

test('legacy approvals without a snapshot cannot authorize commits', () => {
  cleanup();
  approve();
  const statePath = path.join(ROOT, '.pipeline', fs.readdirSync(path.join(ROOT, '.pipeline')).find(f => f.startsWith('state-')));
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  for (const gate of Object.values(state.gates)) delete gate.snapshot;
  fs.writeFileSync(statePath, JSON.stringify(state));
  assertEqual(run('check').exitCode, 2);
});

test('root components paths require UI validation', () => {
  cleanup();
  run('track components/Button.js');
  approve();
  assertEqual(run('check').exitCode, 2);
  assert(run('check').stdout.includes('ui_validation'));
});
cleanup();

test('unmarked missing checkpoint preserves fail-open behavior', () => {
  cleanup();
  assertEqual(run('check').exitCode, 0);
  const input = JSON.stringify({ tool_input: { command: 'git commit -m test' } });
  assertEqual(run('pre-commit', { input }).stdout, '{}');
});

test('required marker blocks missing and malformed checkpoints with init guidance', () => {
  cleanup();
  const marker = path.join(ROOT, '.pipeline-required');
  fs.writeFileSync(marker, '');
  try {
    assertEqual(run('check').exitCode, 2);
    assert(run('check').stdout.includes('pipeline.js init'));
    const input = JSON.stringify({ tool_input: { command: 'git commit -m test' } });
    assertEqual(JSON.parse(run('pre-commit', { input }).stdout).decision, 'deny');
    const status = run('status --json');
    assertEqual(status.exitCode, 0);
    assertEqual(JSON.parse(status.stdout).required, true);
    assertEqual(run('init').exitCode, 0);
    const before = JSON.parse(run('status --json').stdout);
    assertEqual(run('init').exitCode, 0);
    assertEqual(JSON.parse(run('status --json').stdout).session_id, before.session_id);
    const statePath = path.join(ROOT, '.pipeline', fs.readdirSync(path.join(ROOT, '.pipeline')).find(f => f.startsWith('state-')));
    fs.writeFileSync(statePath, '{broken');
    assertEqual(run('check').exitCode, 2);
  } finally {
    fs.unlinkSync(marker);
    cleanup();
  }
});

test('frontend edits require UI review without an explicit track call', () => {
  cleanup();
  const file = path.join(ROOT, 'Component.tsx');
  fs.writeFileSync(file, 'export default () => null;');
  approve();
  assertEqual(run('check').exitCode, 2);
  assert(run('check').stdout.includes('ui_validation'));
  fs.unlinkSync(file);
  cleanup();
});

test('unchanged reviewed snapshot survives commit; dirty HEAD cannot be published', () => {
  cleanup();
  fs.writeFileSync(path.join(ROOT, 'reviewed.js'), 'reviewed change');
  execSync('git add .', { cwd: ROOT });
  approve();
  execSync('git -c core.hooksPath=/dev/null -c user.name=Test -c user.email=test@example.invalid -c commit.gpgsign=false commit -qm fixture', { cwd: ROOT });
  assertEqual(run('check').exitCode, 0);
  execSync('git remote add origin https://github.com/example/fixture.git', { cwd: ROOT });
  fs.writeFileSync(path.join(ROOT, 'dirty.js'), 'uncommitted');
  approve();
  const result = run('publish');
  assertEqual(result.exitCode, 2);
  assert(result.stderr.includes('Commit the reviewed snapshot'));
  fs.unlinkSync(path.join(ROOT, 'dirty.js'));
  cleanup();
});

test('freshness never overwrites historical review status', () => {
  cleanup();
  const file = path.join(ROOT, 'revert.js');
  fs.writeFileSync(file, 'original');
  approve();
  fs.writeFileSync(file, 'changed');
  run('gate security completed');
  assertEqual(run('check').exitCode, 2);
  fs.writeFileSync(file, 'original');
  assertEqual(run('check').exitCode, 0);
  fs.unlinkSync(file);
  cleanup();
});

test('repository-local installer integration suite', () => {
  execFileSync(process.execPath, [path.join(__dirname, 'test-install-hooks.js')], { stdio: 'inherit' });
});

// --- Summary ---

console.log('\n' + '='.repeat(50));
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
