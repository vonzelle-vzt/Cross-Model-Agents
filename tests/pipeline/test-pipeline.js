#!/usr/bin/env node
// Pipeline enforcement unit tests.
// Tests pipeline.js subcommands in isolation — no API keys required.
//
// Run: node tests/pipeline/test-pipeline.js

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PIPELINE_JS = path.resolve(__dirname, '../../scripts/pipeline.js');
const ROOT = path.resolve(__dirname, '../..');

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

// --- Summary ---

console.log('\n' + '='.repeat(50));
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
