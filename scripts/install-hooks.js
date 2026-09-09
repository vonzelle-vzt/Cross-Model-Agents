#!/usr/bin/env node
'use strict';

// Both installers use this implementation. Hooks are enabled only in the target
// repository; its linked worktrees share the common Git directory and config.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function installHooks(repo = process.cwd(), pipeline = path.join(__dirname, 'pipeline.js')) {
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: 'pipe' }).trim();
  const root = git(['rev-parse', '--show-toplevel']);
  const common = fs.realpathSync(path.resolve(repo, git(['rev-parse', '--git-common-dir'])));
  const target = path.join(common, 'cross-model-hooks');
  let configured = '';
  try { configured = git(['config', '--path', '--get', 'core.hooksPath']); }
  catch (error) { if (error.status !== 1) throw error; }
  const candidate = configured ? path.resolve(root, configured) : path.join(common, 'hooks');
  const effective = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
  if (effective !== target) {
    if (configured) throw new Error(`Existing core.hooksPath ${configured} preserved. Integrate the pipeline with those hooks explicitly.`);
    const hooks = fs.existsSync(effective) ? fs.readdirSync(effective).filter(name => !name.endsWith('.sample')) : [];
    if (hooks.length || fs.existsSync(path.join(root, '.husky'))) {
      throw new Error(`Existing repository hooks preserved (${effective}). Integrate the pipeline with them explicitly.`);
    }
  }
  const owner = path.join(target, '.cross-model-managed');
  if (fs.existsSync(target) && !fs.existsSync(owner) && fs.readdirSync(target).length) {
    throw new Error(`Unmanaged hook directory preserved: ${target}`);
  }
  fs.mkdirSync(target, { recursive: true });
  const helper = `#!/usr/bin/env node
// Installed by cross-model-agents. Repository-local enforcement.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const pipeline = ${JSON.stringify(path.resolve(pipeline))};
const required = fs.existsSync(path.join(process.cwd(), '.pipeline-required'));
if (!fs.existsSync(pipeline)) {
  if (required) console.error('Required pipeline CLI missing. Reinstall Cross-Model-Agents.');
  process.exit(required ? 2 : 0);
}
if (process.env.SKIP_PIPELINE_CHECK === '1') {
  const reason = (process.env.PIPELINE_BYPASS_REASON || '').trim();
  const bypass = spawnSync(process.execPath, [pipeline, 'bypass', '--reason', reason], { stdio: 'inherit' });
  if (bypass.status !== 0) process.exit(bypass.status || 2);
}
const result = spawnSync(process.execPath, [pipeline, 'check', '--consume-bypass'], { stdio: 'inherit' });
process.exit(result.status === null ? 2 : result.status);
`;
  const shim = `#!/bin/sh
# Installed by cross-model-agents. Never changes the user's index.
if ! command -v node >/dev/null 2>&1; then
  if [ -e .pipeline-required ]; then
    echo 'Required pipeline cannot run: node is not on PATH.' >&2
    exit 2
  fi
  exit 0
fi
exec node "$(dirname "$0")/pipeline-precommit.js" "$@"
`;
  fs.writeFileSync(path.join(target, 'pipeline-precommit.js'), helper, { mode: 0o755 });
  fs.writeFileSync(path.join(target, 'pre-commit'), shim, { mode: 0o755 });
  fs.chmodSync(path.join(target, 'pre-commit'), 0o755);
  fs.writeFileSync(owner, 'cross-model-agents\n');
  git(['config', '--local', 'core.hooksPath', target]);
  return target;
}

module.exports = { installHooks };
if (require.main === module) {
  try { console.log(`Repository-local pipeline hooks: ${installHooks(process.argv[2])}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
