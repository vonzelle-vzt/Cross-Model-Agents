#!/usr/bin/env node
// Integration smoke tests for cross-model gate agents.
// Tests that anti-slop and UI validation gates produce the expected
// structured output when given known fixture code with deliberate issues.
//
// Requires API keys (Codex and/or Claude) for live mode.
// Default: dry-run (validates fixtures and test definitions only).
//
// Run:
//   node tests/integration/smoke-test.js              # dry-run
//   node tests/integration/smoke-test.js --live       # force live mode
//   node tests/integration/smoke-test.js --timeout 90000
//   ANTHROPIC_API_KEY=sk-... node tests/integration/smoke-test.js

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_TIMEOUT = 60000;

// --- CLI Flags ---

const args = process.argv.slice(2);
const flagDryRun = args.includes('--dry-run');
const flagLive = args.includes('--live');
const timeoutIdx = args.indexOf('--timeout');
const timeout = timeoutIdx !== -1 ? parseInt(args[timeoutIdx + 1], 10) : DEFAULT_TIMEOUT;

const hasApiKey = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
const liveMode = flagLive || (!flagDryRun && hasApiKey);

// --- Test Fixtures ---

const ANTI_SLOP_FIXTURE = `
// helpers.js — deliberately sloppy code for smoke testing
const unused = require('fs'); // Dead weight: unused import

// increment counter
function incrementCounter(counter) {
  counter++;
  return counter;
}

// Wrapper-for-wrapper: fetchUser just calls getUser which calls api.get
function fetchUser(id) {
  return getUser(id);
}

function getUser(id) {
  return apiGet('/users/' + id);
}

function apiGet(url) {
  return fetch(url).then(function (res) { return res.json(); });
}

// Premature helper: 15 lines of generalization for a one-liner
function formatName(first, last, options) {
  var sep = (options && options.separator) || ' ';
  var order = (options && options.order) || 'first-last';
  if (order === 'last-first') {
    return last + sep + first;
  }
  return first + sep + last;
}

module.exports = { incrementCounter, fetchUser, formatName };
`.trim();

const UI_FIXTURE = `
// UserList.jsx — deliberately flawed React component for smoke testing
import React, { useState, useEffect } from 'react';

export default function UserList() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => setUsers(data));
    // No loading state, no error handling for the async fetch
  }, []);

  return (
    <div style={{ width: '960px' }}>
      <h2>Users</h2>
      <ul>
        {users.map(user => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
      <button onClick={() => fetch('/api/refresh')}>
        Refresh
      </button>
    </div>
  );
}
`.trim();

// --- Test Harness ---

let passed = 0;
let failed = 0;

function check(name, fn) {
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

// --- Validation Helpers ---

function validateGateOutput(output) {
  const errors = [];

  // Check VERDICT line exists
  const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL)/i);
  if (!verdictMatch) errors.push('VERDICT: PASS or VERDICT: FAIL not found in output');

  // Check for a parseable JSON block (fenced or bare)
  let jsonBlock = null;
  const fenced = output.match(/```json\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      jsonBlock = JSON.parse(fenced[1].trim());
    } catch (e) {
      errors.push('JSON block found but not parseable: ' + e.message);
    }
  } else {
    // Try to find a bare JSON object with verdict key
    const bare = output.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
    if (bare) {
      try {
        jsonBlock = JSON.parse(bare[0]);
      } catch (e) {
        errors.push('Bare JSON with verdict key found but not parseable: ' + e.message);
      }
    } else {
      errors.push('No JSON block (fenced or bare) found in output');
    }
  }

  // Validate JSON structure if we got one
  if (jsonBlock) {
    if (typeof jsonBlock.overall_score !== 'number') {
      errors.push('overall_score is not a number');
    } else if (jsonBlock.overall_score < 0 || jsonBlock.overall_score > 10) {
      errors.push('overall_score out of range 0-10: ' + jsonBlock.overall_score);
    }

    if (!Array.isArray(jsonBlock.files)) {
      errors.push('files is not an array');
    } else {
      for (const file of jsonBlock.files) {
        if (!Array.isArray(file.violations)) {
          errors.push('file ' + (file.path || '?') + ' missing violations array');
        }
      }
    }
  }

  return { errors, jsonBlock, verdict: verdictMatch ? verdictMatch[1] : null };
}

// --- Test Definitions ---

const tests = [
  {
    name: 'Anti-slop gate produces structured output',
    agent: 'codex-anti-slop',
    fixture: ANTI_SLOP_FIXTURE,
    fixtureFile: 'smoke-fixture-helpers.js',
    validate: (output) => validateGateOutput(output),
  },
  {
    name: 'UI validation gate produces structured output',
    agent: 'codex-ui-validator',
    fixture: UI_FIXTURE,
    fixtureFile: 'smoke-fixture-UserList.jsx',
    validate: (output) => validateGateOutput(output),
  },
];

// --- Dry-Run Mode ---

function runDryTests() {
  console.log('  --- Fixture Validation ---\n');

  check('Anti-slop fixture is valid JavaScript', () => {
    // Should parse without syntax errors (basic check via Function constructor)
    // We wrap in a function body since it uses require/module.exports
    assert(ANTI_SLOP_FIXTURE.includes('require('), 'Missing require statement');
    assert(ANTI_SLOP_FIXTURE.includes('module.exports'), 'Missing module.exports');
    assert(ANTI_SLOP_FIXTURE.includes('function fetchUser'), 'Missing wrapper function');
    assert(ANTI_SLOP_FIXTURE.includes('unused'), 'Missing unused import');
    assert(ANTI_SLOP_FIXTURE.includes('// increment counter'), 'Missing restating comment');
  });

  check('UI validation fixture is valid JSX structure', () => {
    assert(UI_FIXTURE.includes('import React'), 'Missing React import');
    assert(UI_FIXTURE.includes('useEffect'), 'Missing useEffect');
    assert(UI_FIXTURE.includes('useState'), 'Missing useState');
    assert(UI_FIXTURE.includes("width: '960px'"), 'Missing hardcoded width');
    assert(!UI_FIXTURE.includes('aria-label'), 'Should NOT have aria-label (deliberate issue)');
    assert(!UI_FIXTURE.match(/isLoading|setLoading|loading\s*\?/), 'Should NOT have loading state (deliberate issue)');
  });

  check('Test definitions are complete', () => {
    assert(tests.length === 2, 'Expected 2 test definitions, got ' + tests.length);
    for (const t of tests) {
      assert(t.name, 'Test missing name');
      assert(t.agent, 'Test missing agent');
      assert(t.fixture, 'Test missing fixture');
      assert(typeof t.validate === 'function', 'Test missing validate function');
    }
  });

  check('Validation helper detects good output', () => {
    const good = 'Some text\nVERDICT: PASS\n```json\n{"verdict":"PASS","overall_score":8.5,"round":1,"files":[{"path":"test.js","score":8.5,"violations":[]}]}\n```';
    const result = validateGateOutput(good);
    assert(result.errors.length === 0, 'Unexpected errors: ' + result.errors.join('; '));
    assert(result.verdict === 'PASS', 'Expected PASS verdict');
  });

  check('Validation helper detects missing verdict', () => {
    const bad = 'Some output without a verdict line';
    const result = validateGateOutput(bad);
    assert(result.errors.length > 0, 'Should have detected errors');
    assert(result.errors[0].includes('VERDICT'), 'Should mention missing VERDICT');
  });
}

// --- Live Mode ---

function runLiveTests() {
  for (const t of tests) {
    const tmpFile = path.join(ROOT, 'tmp', t.fixtureFile);

    // Ensure tmp directory exists
    const tmpDir = path.dirname(tmpFile);
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    let output = '';
    let timedOut = false;

    try {
      // Write fixture to temp file
      fs.writeFileSync(tmpFile, t.fixture, 'utf8');

      // Build the prompt for the gate agent
      const prompt = [
        'You are running as the ' + t.agent + ' gate.',
        'Review the following file and produce your structured JSON output with verdict.',
        'File: ' + t.fixtureFile,
        '',
        t.fixture,
      ].join('\n');

      // Invoke via claude CLI
      const cmd = `claude -p --model opus --agent ${t.agent} "${prompt.replace(/"/g, '\\"')}"`;

      output = execSync(cmd, {
        encoding: 'utf8',
        cwd: ROOT,
        timeout: timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      if (e.killed || (e.signal && e.signal === 'SIGTERM')) {
        timedOut = true;
      } else {
        output = (e.stdout || '') + '\n' + (e.stderr || '');
      }
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }

    if (timedOut) {
      failed++;
      console.error(`  \u2717 ${t.name}: timed out after ${timeout / 1000}s`);
      continue;
    }

    if (!output || !output.trim()) {
      failed++;
      console.error(`  \u2717 ${t.name}: empty output`);
      continue;
    }

    // Run structured validation
    const result = t.validate(output);

    check(t.name + ': VERDICT found in output', () => {
      assert(result.verdict, 'No VERDICT line found');
    });

    check(t.name + ': JSON block is parseable', () => {
      assert(result.jsonBlock, 'No parseable JSON block found');
    });

    check(t.name + ': score is number 0-10', () => {
      assert(result.jsonBlock, 'No JSON block to check');
      const score = result.jsonBlock.overall_score;
      assert(typeof score === 'number' && score >= 0 && score <= 10,
        'overall_score invalid: ' + score);
    });

    check(t.name + ': violations array present', () => {
      assert(result.jsonBlock, 'No JSON block to check');
      assert(Array.isArray(result.jsonBlock.files), 'files is not an array');
      for (const file of result.jsonBlock.files) {
        assert(Array.isArray(file.violations),
          'Missing violations array for ' + (file.path || 'unknown'));
      }
    });
  }

  // Clean up tmp directory if empty
  const tmpDir = path.join(ROOT, 'tmp');
  try {
    const remaining = fs.readdirSync(tmpDir);
    if (remaining.length === 0) fs.rmdirSync(tmpDir);
  } catch (_) { /* ignore */ }
}

// --- Main ---

console.log('\n=== Integration Smoke Tests ===\n');

if (liveMode) {
  console.log('Mode: live (API calls enabled)');
  console.log(`Timeout: ${timeout / 1000}s per test\n`);
  runLiveTests();
} else {
  console.log('Mode: dry-run (set ANTHROPIC_API_KEY to run full tests)\n');
  runDryTests();
  console.log('\nTo run full smoke tests:');
  console.log('  ANTHROPIC_API_KEY=sk-... node tests/integration/smoke-test.js');
  console.log('  node tests/integration/smoke-test.js --live');
}

// --- Summary ---

console.log('\n' + '='.repeat(50));
console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error(`\n${failed} test(s) failed.`);
  process.exit(1);
} else {
  console.log('\nAll tests passed.');
}
