#!/usr/bin/env node
// Cross-Model Adversarial Agents — Cross-platform Uninstaller
//
// Usage:
//   node scripts/uninstall.js          # interactive
//   node scripts/uninstall.js --yes    # unattended (accept all default removals)
//   node scripts/uninstall.js --purge  # also remove the pre-commit hook + core.hooksPath

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

for (const arg of process.argv.slice(2)) {
  if (arg === '--yes' || arg === '-y') UNATTENDED = true;
  else if (arg === '--purge') PURGE = true;
  else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node uninstall.js [--yes] [--purge]');
    console.log('  --yes, -y  Unattended: remove agents/skills without prompting');
    console.log('  --purge    Also remove pre-commit hook + git core.hooksPath setting');
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
