#!/usr/bin/env node
// Cross-Model Adversarial Agents — Cross-platform Uninstaller
//
// Usage:
//   node scripts/uninstall.js          # interactive
//   node scripts/uninstall.js --yes    # unattended (accept all default removals)
//   node scripts/uninstall.js --purge  # also remove the LEGACY global hook + global core.hooksPath
//   node scripts/uninstall.js --repo <path>   # disarm one repo wired by install-hooks.js

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const readline = require('readline');

const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

const GREEN  = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const RED    = '\x1b[0;31m';
const BOLD   = '\x1b[1m';
const NC     = '\x1b[0m';

let UNATTENDED = false;
let PURGE = false;
const REPOS = [];

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--yes' || arg === '-y') UNATTENDED = true;
  else if (arg === '--purge') PURGE = true;
  else if (arg === '--repo') {
    const value = argv[++i];
    if (!value) { console.error('ERROR: --repo requires a path'); process.exit(1); }
    REPOS.push(path.resolve(value));
  } else if (arg.startsWith('--repo=')) {
    REPOS.push(path.resolve(arg.slice('--repo='.length)));
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node uninstall.js [--yes] [--purge] [--repo <path> ...]');
    console.log('  --yes, -y     Unattended: remove agents/skills without prompting');
    console.log('  --purge       Also remove the LEGACY global hook (~/.githooks) + global core.hooksPath');
    console.log('  --repo <path> Disarm a repo wired by install-hooks.js: removes');
    console.log('                <repo>/.git/cross-model-hooks and unsets that repo\'s local');
    console.log('                core.hooksPath. Repeatable. Never touches global git config.');
    process.exit(0);
  }
}

function ok(m)   { console.log(`${GREEN}ok${NC} ${m}`); }
function warn(m) { console.log(`${YELLOW}!${NC} ${m}`); }
function fail(m) { console.log(`${RED}x${NC} ${m}`); }

const CLAUDE_AGENTS_OURS = [
  'codex-reviewer', 'codex-devils-advocate', 'codex-architect', 'codex-frontend',
  'codex-backend', 'codex-gap-analyst', 'codex-qa', 'codex-security',
  'codex-anti-slop', 'codex-ui-validator'
];

const CLAUDE_SKILLS_OURS = ['codex-review', 'council', 'delegate', 'pipeline-doctor'];

const CODEX_AGENTS_OURS = [
  'claude-reviewer', 'claude-devils-advocate', 'claude-architect',
  'claude-frontend', 'claude-frontend-design', 'claude-marketing',
  'claude-gap-analyst', 'claude-qa', 'claude-security',
  'anti-slop', 'ui-validator',
  'council', 'planner', 'executor', 'reviewer',
  'default', 'backend', 'frontend', 'explorer', 'tester', 'security'
];

async function confirm(prompt) {
  if (UNATTENDED) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise(res => rl.question(`${YELLOW}?${NC} ${prompt} [y/N] `, res));
  rl.close();
  return /^[Yy]/.test(ans.trim());
}

function rmIfExists(p) {
  try {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true });
    else fs.unlinkSync(p);
    return true;
  } catch { return false; }
}

async function main() {
  console.log('');
  console.log(`${BOLD}Uninstalling Cross-Model Adversarial Agents${NC}`);
  console.log('');

  if (!(await confirm('Remove installed agents, skills, and pipeline CLI?'))) {
    console.log('Aborted.');
    process.exit(0);
  }

  // Claude agents
  const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
  for (const name of CLAUDE_AGENTS_OURS) {
    if (rmIfExists(path.join(claudeAgentsDir, `${name}.md`))) ok(`Removed ${name}.md`);
  }

  // Claude skills
  const claudeSkillsDir = path.join(HOME, '.claude', 'skills');
  for (const s of CLAUDE_SKILLS_OURS) {
    if (rmIfExists(path.join(claudeSkillsDir, s))) ok(`Removed skill: ${s}`);
  }

  // Codex agents
  const codexAgentsDir = path.join(HOME, '.codex', 'agents');
  for (const name of CODEX_AGENTS_OURS) {
    if (rmIfExists(path.join(codexAgentsDir, `${name}.toml`))) ok(`Removed ${name}.toml`);
  }

  // Pipeline CLI in ~/.local/bin
  const localBin = path.join(HOME, '.local', 'bin', 'pipeline.js');
  if (rmIfExists(localBin)) ok('Removed ~/.local/bin/pipeline.js');

  // Repo-local hooks written by install-hooks.js.
  //
  // These are deliberately NOT covered by --purge. --purge knows only the legacy
  // global ~/.githooks layout, and a repo-local install is per repository with no
  // registry of which repos were armed — so there is nothing to enumerate and
  // guessing would mean walking the disk. The caller names the repo.
  for (const repo of REPOS) {
    const hooksDir = path.join(repo, '.git', 'cross-model-hooks');
    const sentinel = path.join(hooksDir, '.cross-model-managed');
    if (!fs.existsSync(hooksDir)) {
      warn(`${repo}: no repo-local cross-model hooks — nothing to remove`);
      continue;
    }
    // The sentinel is what proves we wrote this directory. Without it we are
    // looking at somebody else's hooks and must not delete them.
    if (!fs.existsSync(sentinel)) {
      warn(`${repo}: ${hooksDir} is not managed by cross-model-agents — left untouched`);
      continue;
    }
    // Unset the pointer BEFORE deleting the directory, so an interrupted run
    // can never leave the repo pointing at hooks that no longer exist — git
    // silently runs no hooks in that state, which is the same silent
    // non-enforcement this whole feature exists to prevent.
    try {
      const current = execSync(`git -C "${repo}" config --local core.hooksPath`, { stdio: 'pipe' })
        .toString().trim();
      // Compare through realpath. On macOS a temp/checkout path reaches git as
      // /private/var/... while path.resolve() yields /var/..., and a plain
      // string compare then reads our OWN hooks dir as "someone else's" — which
      // left core.hooksPath pointing at a directory this run then deleted. Git
      // runs no hooks at all in that state, silently: the exact failure this
      // whole feature exists to prevent, reintroduced by the uninstaller.
      const same = (a, b) => {
        try { return fs.realpathSync(a) === fs.realpathSync(b); }
        catch { return path.resolve(a) === path.resolve(b); }
      };
      if (current && same(current, hooksDir)) {
        execSync(`git -C "${repo}" config --local --unset core.hooksPath`, { stdio: 'pipe' });
        ok(`${repo}: cleared local core.hooksPath`);
      } else if (current) {
        warn(`${repo}: local core.hooksPath points elsewhere (${current}) — left as is`);
      }
    } catch {
      // Not set, or not a git repo. Nothing to clear either way.
    }
    if (rmIfExists(hooksDir)) ok(`${repo}: removed ${hooksDir}`);
    if (fs.existsSync(path.join(repo, '.pipeline-required'))) {
      warn(`${repo}: .pipeline-required left in place — it is a TRACKED file, so removing it is a repo change, not an uninstall. To stop requiring review here: git -C "${repo}" rm .pipeline-required`);
    }
  }
  if (!REPOS.length) {
    warn('No --repo given: repo-local hooks from install-hooks.js were NOT removed. Pass --repo <path> for each armed repo.');
  }

  // Pre-commit hook + hooksPath
  if (PURGE) {
    const hook = path.join(HOME, '.githooks', 'pre-commit');
    const helper = path.join(HOME, '.githooks', 'pipeline-precommit.js');
    if (fs.existsSync(hook)) {
      const content = fs.readFileSync(hook, 'utf8');
      if (content.includes('cross-model-agents') || content.includes('pipeline-precommit.js')) {
        rmIfExists(hook);
        ok('Removed pre-commit hook');
      } else {
        warn('Pre-commit hook is not ours — left untouched');
      }
    }
    if (rmIfExists(helper)) ok('Removed pipeline-precommit.js');

    try {
      const current = execSync('git config --global core.hooksPath', { stdio: 'pipe' })
        .toString().trim();
      if (current === path.join(HOME, '.githooks')) {
        execSync('git config --global --unset core.hooksPath');
        ok('Cleared git core.hooksPath');
      }
    } catch {
      // not set
    }
  } else {
    warn('Pre-commit hook left in place. Use --purge to remove it.');
  }

  console.log('');
  console.log(`${BOLD}Uninstall complete.${NC}`);
  warn('MCP servers were NOT removed. Remove manually with:');
  console.log('  claude mcp remove <server-name>');
  console.log('  Or edit ~/.codex/config.toml [mcp_servers]');
  console.log('');
}

main().catch((err) => {
  fail(err.message);
  process.exit(1);
});
