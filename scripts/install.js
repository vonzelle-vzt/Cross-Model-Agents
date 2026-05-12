#!/usr/bin/env node
// Cross-Model Adversarial Agents — Interactive Installer (Node.js)
// Run from the repo root: node scripts/install.js
//
// Installs agents + skills to ~/.claude/ and ~/.codex/
// Optionally sets up MCP servers and CLI tools with guided prompts.
//
// Cross-platform: Windows, macOS, Linux — zero dependencies beyond Node.js stdlib.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const readline = require('readline');

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const REPO_DIR = path.resolve(__dirname, '..');
const HOME = os.homedir();
const IS_WIN = process.platform === 'win32';

// Parse flags
const args = process.argv.slice(2);
let USE_COPY = false;
let UNATTENDED = false;       // --yes / -y
let MINIMAL = false;          // --minimal: agents + hook only, skip all MCP prompts
let SKIP_HOOK = false;        // --skip-hook
const FORCE_MCPS = new Set(); // --with codex,claude-code-mcp

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--copy') USE_COPY = true;
  else if (arg === '--yes' || arg === '-y' || arg === '--unattended') UNATTENDED = true;
  else if (arg === '--minimal') { MINIMAL = true; UNATTENDED = true; }
  else if (arg === '--skip-hook') SKIP_HOOK = true;
  else if (arg === '--with' && args[i + 1]) {
    for (const m of args[i + 1].split(',')) FORCE_MCPS.add(m.trim());
    i++;
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: node install.js [options]');
    console.log('  --copy            Use copies instead of symlinks');
    console.log('  --yes, -y         Unattended: accept defaults for all prompts');
    console.log('  --minimal         Unattended + skip all MCP server installs');
    console.log('  --skip-hook       Do not install the git pre-commit hook');
    console.log('  --with <list>     Pre-approve specific MCPs (comma-sep): codex,claude-code-mcp,exa,...');
    console.log('  --help, -h        Show this help');
    process.exit(0);
  }
}

// On Windows, default to copy because file symlinks require admin / Developer Mode.
// Directories still use junction (no admin needed) inside installFile().
if (IS_WIN) USE_COPY = true;

// ─────────────────────────────────────────────────────────────
// ANSI Colors
// ─────────────────────────────────────────────────────────────

const GREEN  = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const BLUE   = '\x1b[0;34m';
const RED    = '\x1b[0;31m';
const BOLD   = '\x1b[1m';
const NC     = '\x1b[0m';

function info(msg)  { console.log(`${BLUE}->${NC} ${msg}`); }
function ok(msg)    { console.log(`${GREEN}ok${NC} ${msg}`); }
function warn(msg)  { console.log(`${YELLOW}!${NC} ${msg}`); }
function fail(msg)  { console.log(`${RED}x${NC} ${msg}`); }

// ─────────────────────────────────────────────────────────────
// Readline helpers
// ─────────────────────────────────────────────────────────────

let rl;

function initReadline() {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function ask(prompt, opts = {}) {
  // opts.mcpName for selective auto-approve via --with
  if (MINIMAL) return false;
  if (UNATTENDED) {
    if (opts.mcpName && FORCE_MCPS.has(opts.mcpName)) {
      console.log(`${YELLOW}?${NC} ${prompt} [auto: yes]`);
      return true;
    }
    if (opts.defaultYes) {
      console.log(`${YELLOW}?${NC} ${prompt} [auto: yes]`);
      return true;
    }
    console.log(`${YELLOW}?${NC} ${prompt} [auto: no]`);
    return false;
  }
  const ans = await question(`${YELLOW}?${NC} ${prompt} [y/N] `);
  return /^[Yy]/.test(ans.trim());
}

async function askInput(prompt, opts = {}) {
  if (UNATTENDED) {
    if (opts.env && process.env[opts.env]) return process.env[opts.env];
    return '';
  }
  const ans = await question(`  ${prompt}`);
  return ans.trim();
}

// ─────────────────────────────────────────────────────────────
// Utility functions
// ─────────────────────────────────────────────────────────────

function commandExists(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getCommandVersion(cmd) {
  try {
    return execSync(`${cmd} --version`, { stdio: 'pipe' }).toString().trim();
  } catch {
    return 'installed';
  }
}

function mkdirp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Install a file: symlink (or junction for dirs) on Unix, copy on Windows.
 * If USE_COPY is true, always copy.
 * On Windows, symlinks require admin, so we try junction for dirs and fall back to copy.
 */
function installFile(src, dest) {
  // Remove existing target
  try {
    const stat = fs.lstatSync(dest);
    if (stat.isSymbolicLink() || stat.isFile()) {
      fs.unlinkSync(dest);
    } else if (stat.isDirectory()) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  } catch {
    // dest does not exist, that's fine
  }

  if (USE_COPY) {
    const srcStat = fs.statSync(src);
    if (srcStat.isDirectory()) {
      copyDirRecursive(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  } else {
    // Try symlink
    try {
      const srcStat = fs.statSync(src);
      if (srcStat.isDirectory()) {
        // On Windows, use junction for directories (no admin needed)
        if (IS_WIN) {
          fs.symlinkSync(src, dest, 'junction');
        } else {
          fs.symlinkSync(src, dest);
        }
      } else {
        fs.symlinkSync(src, dest);
      }
    } catch (err) {
      if (err.code === 'EPERM' || err.code === 'EACCES') {
        warn(`Symlink failed (permission denied). Falling back to copy for: ${path.basename(dest)}`);
        const srcStat = fs.statSync(src);
        if (srcStat.isDirectory()) {
          copyDirRecursive(src, dest);
        } else {
          fs.copyFileSync(src, dest);
        }
      } else {
        throw err;
      }
    }
  }
}

function copyDirRecursive(src, dest) {
  mkdirp(dest);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function globFiles(dir, ext) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function getSubDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function runClaudeMcpList() {
  try {
    return execSync('claude mcp list', { stdio: 'pipe' }).toString();
  } catch {
    return '';
  }
}

function installMcpClaude(name, cmd, mcpArgs) {
  if (!claudeOk) return;
  const list = runClaudeMcpList();
  if (list.includes(name)) {
    ok(`${name} already configured in Claude Code`);
    return true;
  }
  try {
    const fullCmd = `claude mcp add ${name} -- ${cmd} ${mcpArgs}`;
    execSync(fullCmd, { stdio: 'pipe' });
    ok(`Added ${name} to Claude Code`);
    return true;
  } catch {
    fail(`Failed to add ${name}`);
    return false;
  }
}

function installMcpClaude_url(name, url, headerKey, headerValue) {
  if (!claudeOk) return;
  const list = runClaudeMcpList();
  if (list.includes(name)) {
    ok(`${name} already configured in Claude Code`);
    return true;
  }
  try {
    let fullCmd = `claude mcp add ${name} --url "${url}"`;
    if (headerKey && headerValue) {
      fullCmd += ` --header "${headerKey}: ${headerValue}"`;
    }
    execSync(fullCmd, { stdio: 'pipe' });
    ok(`Added ${name} to Claude Code`);
    return true;
  } catch {
    fail(`Failed to add ${name}`);
    return false;
  }
}

function printCodexNote(name) {
  if (!codexOk) return;
  info(`For Codex: Add [${name}] to ~/.codex/config.toml under [mcp_servers]`);
}

// ─────────────────────────────────────────────────────────────
// Counters
// ─────────────────────────────────────────────────────────────

let claudeOk = false;
let codexOk = false;
let claudeAgentCount = 0;
let codexAgentCount = 0;
let skillCount = 0;
const mcpInstalled = [];

// ─────────────────────────────────────────────────────────────
// Main installer
// ─────────────────────────────────────────────────────────────

async function main() {
  initReadline();

  console.log('');
  console.log(`${BOLD}Cross-Model Adversarial Agents${NC}`);
  console.log('Bidirectional review between Claude Code (Opus) and Codex CLI (GPT-5.4)');
  console.log('');

  // ─────────────────────────────────────────────────────────
  // Phase 1: Prerequisite Checks
  // ─────────────────────────────────────────────────────────

  console.log(`${BOLD}Phase 1: Prerequisites${NC}`);
  console.log('');

  if (commandExists('claude')) {
    ok(`Claude Code found: ${getCommandVersion('claude')}`);
    claudeOk = true;
  } else {
    fail('Claude Code not found');
    console.log('  Install: https://docs.claude.com/en/docs/claude-code');
    console.log('  Then run: claude auth login');
  }

  if (commandExists('codex')) {
    ok(`Codex CLI found: ${getCommandVersion('codex')}`);
    codexOk = true;
  } else {
    fail('Codex CLI not found');
    console.log('  Install: npm install -g @openai/codex');
    console.log('  Then run: codex login');
  }

  console.log('');

  if (!claudeOk && !codexOk) {
    fail('Neither CLI is installed. Install at least one to continue.');
    rl.close();
    process.exit(1);
  }

  if (!claudeOk || !codexOk) {
    warn('Only one CLI detected. Cross-model features require both.');
    console.log('  You can still install agents for the available CLI.');
    console.log('');
    const cont = await ask('Continue with partial install?', { defaultYes: true });
    if (!cont) {
      console.log('Exiting. Install both CLIs and try again.');
      rl.close();
      process.exit(0);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Phase 2: Core Install (Agents + Skills + Pipeline)
  // ─────────────────────────────────────────────────────────

  console.log('');
  console.log(`${BOLD}Phase 2: Installing Agents${NC}`);
  console.log('');

  // --- Claude Code agents ---
  if (claudeOk) {
    const claudeAgentsDir = path.join(HOME, '.claude', 'agents');
    const claudeSkillsDir = path.join(HOME, '.claude', 'skills');
    mkdirp(claudeAgentsDir);
    mkdirp(claudeSkillsDir);

    // Backup existing agents
    const existingAgents = globFiles(claudeAgentsDir, '.md').filter((f) => path.basename(f).startsWith('codex-'));
    if (existingAgents.length > 0) {
      const backupDir = path.join(claudeAgentsDir, `.backup-${timestamp()}`);
      mkdirp(backupDir);
      for (const agentFile of existingAgents) {
        fs.copyFileSync(agentFile, path.join(backupDir, path.basename(agentFile)));
      }
      info(`Backed up existing agents to ${backupDir}`);
    }

    // Install Claude Code agents
    const srcClaudeAgents = globFiles(path.join(REPO_DIR, 'claude-code', 'agents'), '.md');
    claudeAgentCount = srcClaudeAgents.length;
    for (const agentFile of srcClaudeAgents) {
      installFile(agentFile, path.join(claudeAgentsDir, path.basename(agentFile)));
    }
    const method = USE_COPY ? 'Copied' : 'Symlinked';
    ok(`${method} ${claudeAgentCount} Claude Code agents -> ${claudeAgentsDir}`);

    // Install skills
    const skillDirs = getSubDirs(path.join(REPO_DIR, 'claude-code', 'skills'));
    for (const skillDir of skillDirs) {
      const skillName = path.basename(skillDir);
      const destSkillDir = path.join(claudeSkillsDir, skillName);
      mkdirp(destSkillDir);
      const skillFiles = globFiles(skillDir, '.md');
      for (const skillFile of skillFiles) {
        installFile(skillFile, path.join(destSkillDir, path.basename(skillFile)));
      }
      skillCount++;
    }
    if (skillCount > 0) {
      ok(`Installed ${skillCount} Claude Code skills -> ${claudeSkillsDir}`);
    }
  }

  // --- Codex agents ---
  if (codexOk) {
    const codexAgentsDir = path.join(HOME, '.codex', 'agents');
    mkdirp(codexAgentsDir);

    // Backup existing agents
    const existingClaude = globFiles(codexAgentsDir, '.toml').filter(
      (f) => path.basename(f).startsWith('claude-') || path.basename(f) === 'anti-slop.toml' || path.basename(f) === 'ui-validator.toml'
    );
    if (existingClaude.length > 0) {
      const backupDir = path.join(codexAgentsDir, `.backup-${timestamp()}`);
      mkdirp(backupDir);
      for (const agentFile of existingClaude) {
        fs.copyFileSync(agentFile, path.join(backupDir, path.basename(agentFile)));
      }
      info(`Backed up existing agents to ${backupDir}`);
    }

    // Install Codex agents
    const srcCodexAgents = globFiles(path.join(REPO_DIR, 'codex', 'agents'), '.toml');
    codexAgentCount = srcCodexAgents.length;
    for (const agentFile of srcCodexAgents) {
      installFile(agentFile, path.join(codexAgentsDir, path.basename(agentFile)));
    }
    const method = USE_COPY ? 'Copied' : 'Symlinked';
    ok(`${method} ${codexAgentCount} Codex agents -> ${codexAgentsDir}`);
  }

  // --- Pipeline enforcement (single Node.js script, no legacy bash) ---
  const pipelineJs = path.join(REPO_DIR, 'scripts', 'pipeline.js');
  const localBin = path.join(HOME, '.local', 'bin');
  mkdirp(localBin);

  if (fs.existsSync(pipelineJs)) {
    installFile(pipelineJs, path.join(localBin, 'pipeline.js'));
    ok(`Pipeline CLI installed -> ${path.join(localBin, 'pipeline.js')}`);
  }

  // --- Git pre-commit hook (cross-platform, Node-only) ---
  if (SKIP_HOOK) {
    info('Pre-commit hook installation skipped (--skip-hook).');
    console.log('');
    // Fall through to MCP phases below
  } else {
  const githooksDir = path.join(HOME, '.githooks');
  mkdirp(githooksDir);
  const preCommitPath = path.join(githooksDir, 'pre-commit');
  const preCommitJsPath = path.join(githooksDir, 'pipeline-precommit.js');

  // Always (re)write the JS helper so it points at the right pipeline.js
  const jsHelper = [
    '#!/usr/bin/env node',
    '// Pipeline pre-commit hook (cross-platform). Installed by cross-model-agents.',
    "'use strict';",
    "const { spawnSync } = require('child_process');",
    "const path = require('path');",
    "const fs = require('fs');",
    "const os = require('os');",
    '',
    "// Audited bypass — SKIP_PIPELINE_CHECK=1 must be paired with PIPELINE_BYPASS_REASON",
    "if (process.env.SKIP_PIPELINE_CHECK === '1') {",
    "  const reason = (process.env.PIPELINE_BYPASS_REASON || '').trim();",
    "  if (reason.length < 12) {",
    "    console.error('Pipeline bypass requires PIPELINE_BYPASS_REASON=\"<at least 12 chars>\" (or run: pipeline.js bypass --reason \"<text>\")');",
    "    process.exit(1);",
    "  }",
    "  console.log(`Pipeline check skipped (reason: ${reason})`);",
    "  process.exit(0);",
    "}",
    '',
    "const pipeline = path.join(os.homedir(), '.local', 'bin', 'pipeline.js');",
    "if (!fs.existsSync(pipeline)) {",
    "  // No pipeline installed = allow commit (defensive: don't block users without the tool)",
    "  process.exit(0);",
    "}",
    "const r = spawnSync(process.execPath, [pipeline, 'check'], { stdio: 'inherit' });",
    "process.exit(r.status === null ? 1 : r.status);",
    '',
  ].join('\n');

  fs.writeFileSync(preCommitJsPath, jsHelper);
  if (!IS_WIN) {
    try { fs.chmodSync(preCommitJsPath, 0o755); } catch { /* ignore */ }
  }

  // Pre-commit shim — bash on Unix, posix `#!/bin/sh` everywhere (Git for Windows ships sh)
  const hookContent = [
    '#!/bin/sh',
    '# Pipeline enforcement pre-commit hook. Installed by cross-model-agents.',
    '# Delegates to a Node.js helper for full cross-platform behavior.',
    '',
    'if ! command -v node >/dev/null 2>&1; then',
    '  echo "WARNING: node not on PATH — pipeline check skipped." >&2',
    '  exit 0',
    'fi',
    `exec node "$HOME/.githooks/pipeline-precommit.js" "$@"`,
    '',
  ].join('\n');

  if (fs.existsSync(preCommitPath)) {
    // Detect whether existing hook is ours; if so, replace cleanly.
    const existing = fs.readFileSync(preCommitPath, 'utf8');
    if (existing.includes('cross-model-agents') || existing.includes('pipeline-precommit.js')) {
      fs.writeFileSync(preCommitPath, hookContent);
      ok('Updated existing cross-model-agents pre-commit hook');
    } else {
      warn(`Found non-pipeline pre-commit hook at ${preCommitPath} — left untouched`);
      info(`Merge manually or back up and re-run installer.`);
    }
  } else {
    fs.writeFileSync(preCommitPath, hookContent);
    ok(`Installed git pre-commit hook -> ${preCommitPath}`);
  }
  if (!IS_WIN) {
    try { fs.chmodSync(preCommitPath, 0o755); } catch { /* ignore */ }
  }

  // CRITICAL: set core.hooksPath so the hook actually fires
  try {
    const currentHooksPath = execSync('git config --global core.hooksPath', { stdio: 'pipe' })
      .toString().trim();
    if (currentHooksPath && path.resolve(currentHooksPath) !== path.resolve(githooksDir)) {
      warn(`git core.hooksPath is already set to "${currentHooksPath}" — pipeline hook will NOT fire.`);
      info(`To enable: git config --global core.hooksPath "${githooksDir}"`);
    } else if (!currentHooksPath) {
      execSync(`git config --global core.hooksPath "${githooksDir}"`, { stdio: 'pipe' });
      ok(`git core.hooksPath set to ${githooksDir}`);
    } else {
      ok(`git core.hooksPath already = ${githooksDir}`);
    }
  } catch {
    // core.hooksPath unset throws on read; set it
    try {
      execSync(`git config --global core.hooksPath "${githooksDir}"`, { stdio: 'pipe' });
      ok(`git core.hooksPath set to ${githooksDir}`);
    } catch (e) {
      fail(`Failed to set git core.hooksPath — run manually: git config --global core.hooksPath "${githooksDir}"`);
    }
  }

  console.log('');
  } // end if !SKIP_HOOK

  // ─────────────────────────────────────────────────────────
  // Phase 3: Optional CLI Tools
  // ─────────────────────────────────────────────────────────

  console.log(`${BOLD}Phase 3: Optional CLI Tools${NC}`);
  console.log('');
  console.log('These tools enhance the cross-model workflow but are not required.');
  console.log('');

  // agent-browser
  if (commandExists('agent-browser')) {
    ok('agent-browser already installed (used by UI validation gate)');
  } else {
    console.log('  agent-browser -- Browser automation for UI validation gate');
    console.log('  The UI validator uses this to capture screenshots and test responsive layouts.');
    if (await ask('Install agent-browser CLI?', { mcpName: 'agent-browser' })) {
      info('Installing agent-browser...');
      try {
        execSync('npm install -g agent-browser', { stdio: 'inherit' });
        ok('agent-browser installed');
      } catch {
        fail('Install failed. Run: npm install -g agent-browser');
      }
    }
  }

  // shadcn CLI
  console.log('  shadcn/ui v4 CLI -- Install and manage UI components');
  console.log('  Used by frontend agents for component scaffolding.');
  console.log('  Available via npx (no global install needed): npx shadcn@latest add <component>');
  ok('shadcn CLI available on-demand via npx');

  console.log('');

  // ─────────────────────────────────────────────────────────
  // Phase 4: Optional MCP Servers
  // ─────────────────────────────────────────────────────────

  console.log(`${BOLD}Phase 4: MCP Servers (Optional)${NC}`);
  console.log('');
  console.log('MCP servers give agents access to external tools. Install only what you need.');
  console.log('Agents gracefully skip unavailable MCPs -- nothing breaks without them.');
  console.log('');

  // --- Cross-Model Communication ---

  console.log(`${BOLD}Cross-Model Communication${NC}`);
  console.log('');
  console.log('  These MCP servers enable cross-model delegation without CLI shell-outs.');
  console.log('  They reduce latency, improve reliability, and remove --dangerously-skip-permissions.');
  console.log('');

  // codex-mcp-server
  console.log('  codex-mcp-server -- Wraps Codex CLI as an MCP server');
  console.log('  Allows Claude Code agents to call Codex via structured MCP tool calls.');
  if (await ask('Install codex-mcp-server?', { mcpName: 'codex' })) {
    installMcpClaude('codex', 'npx', '-y codex-mcp-server');
    mcpInstalled.push('codex-mcp-server');
  }
  console.log('');

  // claude-code-mcp
  console.log('  claude-code-mcp -- Wraps Claude Code as an MCP server');
  console.log('  Allows Codex agents to call Claude via structured MCP tool calls.');
  if (await ask('Install claude-code-mcp?', { mcpName: 'claude-code-mcp' })) {
    if (codexOk) {
      info('For Codex, add to ~/.codex/config.toml:');
      console.log('    [mcp_servers."claude-code-mcp"]');
      console.log('    command = "npx"');
      console.log('    args = ["-y", "@anthropic-ai/claude-code-mcp@latest"]');
    }
    mcpInstalled.push('claude-code-mcp');
  }
  console.log('');

  // --- Codebase Intelligence ---

  console.log(`${BOLD}Codebase Intelligence${NC}`);
  console.log('');

  // Auggie
  console.log('  Auggie (codebase-retrieval) -- Semantic codebase search');
  console.log('  Indexes your entire repo. Finds cross-file references grep misses.');
  if (await ask('Install Auggie MCP?', { mcpName: 'auggie' })) {
    if (commandExists('auggie')) {
      ok('auggie CLI already installed');
      installMcpClaude('codebase-retrieval', 'auggie', '--mcp --mcp-auto-workspace');
    } else {
      info('Install auggie first: npm install -g auggie');
      info('Then run: claude mcp add codebase-retrieval -- auggie --mcp --mcp-auto-workspace');
    }
    mcpInstalled.push('auggie');
  }
  console.log('');

  // GitNexus
  console.log('  GitNexus -- Dependency graphs and impact analysis');
  console.log('  Maps what depends on what. Shows what breaks when you change something.');
  if (await ask('Install GitNexus MCP?', { mcpName: 'gitnexus' })) {
    installMcpClaude('gitnexus', 'npx', '-y gitnexus@latest mcp');
    printCodexNote('gitnexus');
    mcpInstalled.push('gitnexus');
  }
  console.log('');

  // --- Research & Documentation ---

  console.log(`${BOLD}Research & Documentation${NC}`);
  console.log('');

  // EXA
  console.log('  EXA -- Semantic web search for research and patterns');
  console.log('  Agents use this to research design patterns, best practices, and real-world examples.');
  if (await ask('Install EXA MCP?', { mcpName: 'exa' })) {
    const exaKey = await askInput('Enter your EXA API key (get one at https://exa.ai): ', { env: 'EXA_API_KEY' });
    if (exaKey) {
      installMcpClaude_url('exa', 'https://mcp.exa.ai/mcp', 'Authorization', `Bearer ${exaKey}`);
      info('For Codex, add to ~/.codex/config.toml:');
      console.log('    [mcp_servers.exa]');
      console.log('    url = "https://mcp.exa.ai/mcp"');
      console.log('    bearer_token_env_var = "EXA_API_KEY"');
      console.log('');
      console.log(`    Then set: export EXA_API_KEY=${exaKey}`);
      mcpInstalled.push('exa');
    } else {
      warn('Skipped -- no API key provided');
    }
  }
  console.log('');

  // Ref
  console.log('  Ref -- Documentation search across frameworks and libraries');
  console.log('  Free, no API key needed.');
  if (await ask('Install Ref MCP?', { mcpName: 'ref' })) {
    installMcpClaude_url('ref', 'https://api.ref.tools/mcp?apiKey=ref-a867514653e7d2c73d9e');
    info('For Codex, add to ~/.codex/config.toml:');
    console.log('    [mcp_servers."ref"]');
    console.log('    url = "https://api.ref.tools/mcp?apiKey=ref-a867514653e7d2c73d9e"');
    mcpInstalled.push('ref');
  }
  console.log('');

  // Context7
  console.log('  Context7 -- Library documentation lookup');
  console.log('  Free, no API key needed. Gives agents access to framework docs.');
  if (await ask('Install Context7 MCP?', { mcpName: 'context7' })) {
    installMcpClaude('context7', 'npx', '-y @upstash/context7-mcp');
    printCodexNote('context7');
    mcpInstalled.push('context7');
  }
  console.log('');

  // Firecrawl
  console.log('  Firecrawl -- Web scraping and crawling');
  console.log('  Agents use this to scrape documentation, research URLs, and crawl sites.');
  if (await ask('Install Firecrawl MCP?', { mcpName: 'firecrawl' })) {
    const fcKey = await askInput('Enter your Firecrawl API key (get one at https://firecrawl.dev): ', { env: 'FIRECRAWL_API_KEY' });
    if (fcKey) {
      installMcpClaude('firecrawl', 'npx', '-y firecrawl-mcp');
      info(`Set the env var: export FIRECRAWL_API_KEY=${fcKey}`);
      mcpInstalled.push('firecrawl');
    } else {
      warn('Skipped -- no API key provided');
    }
  }
  console.log('');

  // --- Code Review ---

  console.log(`${BOLD}Code Review${NC}`);
  console.log('');

  // Greptile
  console.log('  Greptile -- AI-powered code review and PR scoring');
  console.log('  Used in the PR review gate at the end of the pipeline.');
  if (await ask('Install Greptile MCP?', { mcpName: 'greptile' })) {
    const greptileKey = await askInput('Enter your Greptile API key (get one at https://greptile.com): ', { env: 'GREPTILE_API_KEY' });
    if (greptileKey) {
      installMcpClaude_url('greptile', 'https://api.greptile.com/mcp', 'Authorization', `Bearer ${greptileKey}`);
      info('For Codex, add to ~/.codex/config.toml:');
      console.log('    [mcp_servers."greptile"]');
      console.log('    url = "https://api.greptile.com/mcp"');
      console.log('    bearer_token_env_var = "GREPTILE_API_KEY"');
      console.log('');
      console.log(`    Then set: export GREPTILE_API_KEY=${greptileKey}`);
      mcpInstalled.push('greptile');
    } else {
      warn('Skipped -- no API key provided');
    }
  }
  console.log('');

  // --- UI Components ---

  console.log(`${BOLD}UI Components${NC}`);
  console.log('');

  console.log('  shadcn/ui MCP -- Browse and discover UI components');
  console.log('  Free, no API key. Lets agents browse the shadcn/ui component library.');
  if (await ask('Install shadcn/ui MCP?', { mcpName: 'shadcn-ui' })) {
    installMcpClaude('shadcn-ui', 'npx', '-y @jpisnice/shadcn-ui-mcp-server');
    printCodexNote('shadcn-ui');
    mcpInstalled.push('shadcn-ui');
  }
  console.log('');

  // --- Reasoning ---

  console.log(`${BOLD}Reasoning${NC}`);
  console.log('');

  console.log('  Sequential Thinking -- Structured multi-step reasoning');
  console.log('  Free, no API key. Helps agents with complex multi-step analysis.');
  if (await ask('Install Sequential Thinking MCP?', { mcpName: 'sequential-thinking' })) {
    installMcpClaude('sequential-thinking', 'npx', '-y @modelcontextprotocol/server-sequential-thinking');
    printCodexNote('sequential-thinking');
    mcpInstalled.push('sequential-thinking');
  }
  console.log('');

  // ─────────────────────────────────────────────────────────
  // Phase 5: Summary
  // ─────────────────────────────────────────────────────────

  console.log('');
  console.log(`${BOLD}----------------------------------------${NC}`);
  console.log(`${BOLD}Installation Complete${NC}`);
  console.log(`${BOLD}----------------------------------------${NC}`);
  console.log('');

  console.log(`  ${GREEN}Agents:${NC}`);
  if (claudeAgentCount > 0) {
    const method = USE_COPY ? 'copied' : 'symlinked';
    console.log(`    ${claudeAgentCount} Claude Code agents (${method}) -> ~/.claude/agents/`);
  }
  if (codexAgentCount > 0) {
    const method = USE_COPY ? 'copied' : 'symlinked';
    console.log(`    ${codexAgentCount} Codex agents (${method}) -> ~/.codex/agents/`);
  }
  if (skillCount > 0) {
    console.log(`    ${skillCount} Claude Code skills -> ~/.claude/skills/`);
  }
  console.log('');

  if (mcpInstalled.length > 0) {
    console.log(`  ${GREEN}MCP Servers:${NC}`);
    for (const mcp of mcpInstalled) {
      console.log(`    ok ${mcp}`);
    }
    console.log('');
  }

  console.log(`  ${YELLOW}Next Steps:${NC}`);
  console.log('    1. Restart Claude Code and Codex CLI for changes to take effect');
  console.log("    2. Test: In Claude Code, try 'Use the codex-reviewer agent to review my code'");
  console.log("    3. Test: In Codex, try '@claude-reviewer Review my implementation'");
  console.log('');

  console.log(`  ${BLUE}Pipeline:${NC}`);
  console.log('    Plan -> Anti-Slop Gate -> UI Validation -> Devil\'s Advocate -> Gap Analysis -> Commit -> PR -> Merge');
  console.log('');
  console.log('  Docs: https://github.com/vonzelle-vzt/Cross-Model-Agents');
  console.log('');

  rl.close();
}

// ─────────────────────────────────────────────────────────────
// Run
// ─────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(`${RED}Fatal error:${NC} ${err.message}`);
  if (rl) rl.close();
  process.exit(1);
});
