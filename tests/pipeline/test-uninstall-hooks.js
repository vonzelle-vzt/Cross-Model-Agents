#!/usr/bin/env node
// Regression tests for `uninstall.js --repo` — removing the repo-local hooks
// that install-hooks.js writes.
//
// WHY: --purge only ever knew the legacy global ~/.githooks layout, so a repo
// armed by install-hooks.js could not be disarmed by the uninstaller at all.
// The README documented that as a known gap; these tests are what let it stop
// being one. The dangerous failure here is not leaving hooks behind — it is
// deleting hooks we did not write, so that case is tested explicitly.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const INSTALL = path.join(ROOT, 'scripts', 'install-hooks.js');
const UNINSTALL = path.join(ROOT, 'scripts', 'uninstall.js');

let passed = 0;
const failures = [];
function check(name, fn) {
  try { fn(); console.log(`ok ${name}`); passed++; }
  catch (e) { console.log(`FAIL ${name}\n    ${e.message}`); failures.push(name); }
}
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();

// Every child runs under a THROWAWAY HOME.
//
// uninstall.js does far more than hooks: it also removes ~/.claude/agents/*,
// ~/.codex/agents/*, ~/.claude/skills/* and ~/.local/bin/pipeline.js. An earlier
// version of this file called it with --yes against the real HOME and wiped all
// 31 agents, 4 skills and the pipeline shim off the machine mid-session. A test
// for an uninstaller must never be able to uninstall anything but its own
// fixture, so HOME is redirected and those paths simply do not exist.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cma-uninstall-home-'));
const node = (...args) => execFileSync(process.execPath, args, {
  encoding: 'utf8',
  stdio: 'pipe',
  env: { ...process.env, HOME: FAKE_HOME, USERPROFILE: FAKE_HOME },
});

function mkrepo(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cma-uninstall-${label}-`));
  git(dir, 'init', '-q', '.');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, '.pipeline-required'), '');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  return dir;
}
const localHooksPath = (repo) => {
  try { return git(repo, 'config', '--local', 'core.hooksPath'); } catch { return ''; }
};

check('an armed repo is fully disarmed: hooks dir removed and local hooksPath cleared', () => {
  const repo = mkrepo('armed');
  node(INSTALL, repo);
  const hooks = path.join(repo, '.git', 'cross-model-hooks');
  if (!fs.existsSync(hooks)) throw new Error('precondition: install did not create the hooks dir');
  node(UNINSTALL, '--yes', '--repo', repo);
  if (fs.existsSync(hooks)) throw new Error('hooks dir survived uninstall');
  if (localHooksPath(repo) !== '') throw new Error(`local core.hooksPath still set: ${localHooksPath(repo)}`);
});

check('the tracked .pipeline-required marker is NOT deleted', () => {
  const repo = mkrepo('marker');
  node(INSTALL, repo);
  node(UNINSTALL, '--yes', '--repo', repo);
  if (!fs.existsSync(path.join(repo, '.pipeline-required'))) {
    throw new Error('uninstall deleted a tracked file; that is a repo change, not an uninstall');
  }
});

check('a hooks dir we did not write is preserved, and its hooksPath is left alone', () => {
  const repo = mkrepo('foreign');
  const hooks = path.join(repo, '.git', 'cross-model-hooks');
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho theirs\n');
  git(repo, 'config', '--local', 'core.hooksPath', hooks);
  node(UNINSTALL, '--yes', '--repo', repo);
  if (!fs.existsSync(path.join(hooks, 'pre-commit'))) throw new Error('deleted a foreign hook');
  if (localHooksPath(repo) === '') throw new Error('cleared a hooksPath that was not ours');
});

check('a repo that was never armed is a no-op, not an error', () => {
  const repo = mkrepo('bare');
  const out = node(UNINSTALL, '--yes', '--repo', repo);
  if (!/nothing to remove/i.test(out)) throw new Error(`expected a nothing-to-remove notice, got:\n${out}`);
});

check('the real HOME is never touched: no agents, skills or CLI removed', () => {
  // Proves the isolation above actually holds, not just that it was intended.
  const realHome = os.homedir();
  if (path.resolve(FAKE_HOME) === path.resolve(realHome)) throw new Error('fixture HOME is the real HOME');
  const repo = mkrepo('isolation');
  node(INSTALL, repo);
  const before = fs.existsSync(path.join(realHome, '.local', 'bin', 'pipeline.js'));
  node(UNINSTALL, '--yes', '--repo', repo);
  const after = fs.existsSync(path.join(realHome, '.local', 'bin', 'pipeline.js'));
  if (before !== after) throw new Error('uninstall reached outside the fixture and removed the real pipeline CLI');
});

check('global git config is never touched by --repo', () => {
  const before = (() => {
    try { return execFileSync('git', ['config', '--global', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch { return ''; }
  })();
  const repo = mkrepo('global');
  node(INSTALL, repo);
  node(UNINSTALL, '--yes', '--repo', repo);
  const after = (() => {
    try { return execFileSync('git', ['config', '--global', 'core.hooksPath'], { encoding: 'utf8' }).trim(); }
    catch { return ''; }
  })();
  if (before !== after) throw new Error(`global core.hooksPath changed: "${before}" -> "${after}"`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
