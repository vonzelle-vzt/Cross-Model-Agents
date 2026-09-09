#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { installHooks } = require('../../scripts/install-hooks');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-hook-test-'));
const savedGlobal = process.env.GIT_CONFIG_GLOBAL;
process.env.GIT_CONFIG_GLOBAL = path.join(root, 'global-config');
fs.writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[user]\n name = Test\n email = test@example.invalid\n');
const originalGlobal = fs.readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8');
let count = 0;
function repo(name) {
  const cwd = path.join(root, name);
  fs.mkdirSync(cwd);
  execFileSync('git', ['init', '-q', cwd]);
  return cwd;
}
function check(name, fn) { fn(); count++; console.log(`ok ${name}`); }
try {
  check('installs locally, repeats safely, leaves global config unchanged', () => {
    const cwd = repo('plain');
    const target = installHooks(cwd);
    assert.equal(installHooks(cwd), target);
    assert.equal(execFileSync('git', ['config', '--local', 'core.hooksPath'], { cwd, encoding: 'utf8' }).trim(), target);
    assert.equal(fs.readFileSync(process.env.GIT_CONFIG_GLOBAL, 'utf8'), originalGlobal);
  });
  check('existing default hooks and Husky are preserved', () => {
    for (const type of ['default-hook', 'husky']) {
      const cwd = repo(type);
      const file = type === 'husky' ? path.join(cwd, '.husky') : path.join(cwd, '.git/hooks/pre-push');
      fs.writeFileSync(file, 'existing');
      assert.throws(() => installHooks(cwd), /preserved/);
      assert.equal(fs.readFileSync(file, 'utf8'), 'existing');
    }
  });
  check('existing custom hooksPath is preserved', () => {
    const cwd = repo('custom');
    execFileSync('git', ['config', '--local', 'core.hooksPath', '.custom-hooks'], { cwd });
    assert.throws(() => installHooks(cwd), /preserved/);
    assert.equal(execFileSync('git', ['config', '--local', 'core.hooksPath'], { cwd, encoding: 'utf8' }).trim(), '.custom-hooks');
  });
  check('real git commit blocks marked missing state and audits explicit bypass', () => {
    const cwd = repo('enforced');
    installHooks(cwd);
    fs.writeFileSync(path.join(cwd, '.pipeline-required'), '');
    fs.writeFileSync(path.join(cwd, '.gitignore'), '.pipeline/\n');
    execFileSync('git', ['add', '.'], { cwd });
    const commit = env => spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
    assert.notEqual(commit().status, 0);
    execFileSync(process.execPath, [path.resolve(__dirname, '../../scripts/pipeline.js'), 'init'], { cwd });
    assert.notEqual(commit().status, 0);
    assert.notEqual(commit({ SKIP_PIPELINE_CHECK: '1', PIPELINE_BYPASS_REASON: 'short' }).status, 0);
    assert.equal(commit({ SKIP_PIPELINE_CHECK: '1', PIPELINE_BYPASS_REASON: 'Isolated hook integration test' }).status, 0);
    const logs = fs.readdirSync(path.join(cwd, '.pipeline/logs')).map(f => fs.readFileSync(path.join(cwd, '.pipeline/logs', f), 'utf8')).join('');
    assert(logs.includes('commit_bypassed'));
    fs.writeFileSync(path.join(cwd, 'second.txt'), 'second');
    execFileSync('git', ['add', 'second.txt'], { cwd });
    assert.notEqual(commit().status, 0, 'bypass must not authorize the next commit');
  });
  check('linked worktree inherits hook and marker and blocks without state', () => {
    const cwd = path.join(root, 'enforced');
    const worktree = path.join(root, 'linked');
    execFileSync('git', ['worktree', 'add', '-q', '-b', 'linked', worktree], { cwd });
    assert.equal(installHooks(worktree), installHooks(cwd));
    fs.writeFileSync(path.join(worktree, 'new.txt'), 'new');
    execFileSync('git', ['add', 'new.txt'], { cwd: worktree });
    const result = spawnSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-m', 'must block'], { cwd: worktree });
    assert.notEqual(result.status, 0);
  });
  check('missing pipeline blocks marked repositories', () => {
    const cwd = repo('missing-cli');
    const target = installHooks(cwd, path.join(root, 'missing.js'));
    fs.writeFileSync(path.join(cwd, '.pipeline-required'), '');
    assert.equal(spawnSync(process.execPath, [path.join(target, 'pipeline-precommit.js')], { cwd }).status, 2);
  });
  console.log(`${count} installer integration tests passed`);
} finally {
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  fs.rmSync(root, { recursive: true, force: true });
}
