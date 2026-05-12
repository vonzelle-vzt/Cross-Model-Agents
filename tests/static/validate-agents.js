#!/usr/bin/env node
// Static validation for all agent definitions.
// Runs in CI — no API keys required.
//
// Checks:
//   1. TOML schema: required fields (model, sandbox_mode, developer_instructions)
//   2. Markdown structure: required sections (## Workflow or ## Instructions)
//   3. Scoring formula consistency across all gate agents
//   4. Cross-reference: install/uninstall scripts reference all agents
//   5. Agent versioning: version field in TOML, YAML frontmatter in MD

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const CLAUDE_AGENTS = path.join(ROOT, 'claude-code', 'agents');
const CODEX_AGENTS = path.join(ROOT, 'codex', 'agents');
const SKILLS_DIR = path.join(ROOT, 'claude-code', 'skills');

let failures = 0;
let passes = 0;

function ok(msg) { passes++; console.log(`  \u2713 ${msg}`); }
function fail(msg) { failures++; console.error(`  \u2717 ${msg}`); }

// --- 1. TOML Schema Validation ---

console.log('\n=== TOML Schema Validation ===\n');

const REQUIRED_TOML_FIELDS = ['model', 'sandbox_mode', 'developer_instructions'];

function parseTomlSimple(content) {
  // Lightweight TOML parser for top-level key = "value" and key = """multiline"""
  const result = {};
  const lines = content.split('\n');
  let inMultiline = null;
  let multilineValue = '';

  for (const line of lines) {
    if (inMultiline) {
      if (line.includes('"""')) {
        multilineValue += line.split('"""')[0];
        result[inMultiline] = multilineValue;
        inMultiline = null;
        multilineValue = '';
      } else {
        multilineValue += line + '\n';
      }
      continue;
    }

    const multiMatch = line.match(/^(\w+)\s*=\s*"""/);
    if (multiMatch) {
      const rest = line.slice(line.indexOf('"""') + 3);
      if (rest.includes('"""')) {
        result[multiMatch[1]] = rest.split('"""')[0];
      } else {
        inMultiline = multiMatch[1];
        multilineValue = rest + '\n';
      }
      continue;
    }

    const match = line.match(/^(\w+)\s*=\s*"([^"]*)"/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

const tomlFiles = fs.readdirSync(CODEX_AGENTS).filter(f => f.endsWith('.toml'));
for (const file of tomlFiles) {
  const content = fs.readFileSync(path.join(CODEX_AGENTS, file), 'utf8');
  const parsed = parseTomlSimple(content);

  for (const field of REQUIRED_TOML_FIELDS) {
    if (parsed[field] !== undefined && parsed[field] !== '') {
      ok(`${file}: has '${field}'`);
    } else {
      fail(`${file}: missing required field '${field}'`);
    }
  }

  // Validate model_reasoning_effort if present
  if (parsed.model_reasoning_effort) {
    const valid = ['low', 'medium', 'high', 'xhigh'];
    if (valid.includes(parsed.model_reasoning_effort)) {
      ok(`${file}: valid model_reasoning_effort '${parsed.model_reasoning_effort}'`);
    } else {
      fail(`${file}: invalid model_reasoning_effort '${parsed.model_reasoning_effort}' (expected: ${valid.join(', ')})`);
    }
  }

  // NOTE: Codex CLI >= 0.130 rejects unknown top-level `version` field on agent
  // role definitions, so we no longer require it here. Version information for
  // Codex-side agents lives in CHANGELOG.md.
}

// --- 2. Markdown Structure Validation ---

console.log('\n=== Markdown Structure Validation ===\n');

// Helper: parse YAML frontmatter from markdown content
function parseFrontmatter(content) {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  if (lines[0] !== '---') return { frontmatter: null, headingLine: 0 };

  const closeIdx = lines.indexOf('---', 1);
  if (closeIdx < 0) return { frontmatter: null, headingLine: 0 };

  const fm = {};
  for (let i = 1; i < closeIdx; i++) {
    const m = lines[i].match(/^(\w[\w-]*)\s*:\s*(.+)/);
    if (m) fm[m[1]] = m[2].trim();
  }

  // Find heading after frontmatter (skip blank lines)
  let headingLine = -1;
  for (let i = closeIdx + 1; i < lines.length; i++) {
    if (lines[i].startsWith('# ')) { headingLine = i; break; }
    if (lines[i].trim() !== '') break;
  }

  return { frontmatter: fm, headingLine };
}

const mdFiles = fs.readdirSync(CLAUDE_AGENTS).filter(f => f.endsWith('.md'));
for (const file of mdFiles) {
  const content = fs.readFileSync(path.join(CLAUDE_AGENTS, file), 'utf8');
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  const { frontmatter, headingLine } = parseFrontmatter(content);

  // Must have # heading (either line 1 or after frontmatter)
  if (frontmatter && headingLine >= 0) {
    ok(`${file}: has # heading (after frontmatter)`);
  } else if (lines[0] && lines[0].startsWith('# ')) {
    ok(`${file}: has # heading on line 1`);
  } else {
    fail(`${file}: missing # heading`);
  }

  // Must have YAML frontmatter with version
  if (frontmatter && frontmatter.version) {
    if (/^\d+\.\d+\.\d+$/.test(frontmatter.version)) {
      ok(`${file}: has valid version '${frontmatter.version}'`);
    } else {
      fail(`${file}: invalid version format '${frontmatter.version}' (expected semver x.y.z)`);
    }
  } else {
    fail(`${file}: missing YAML frontmatter with version`);
  }

  // Must have ## Workflow or ## Instructions section
  const hasWorkflow = content.includes('## Workflow');
  const hasInstructions = content.includes('## Instructions');
  if (hasWorkflow || hasInstructions) {
    ok(`${file}: has Workflow/Instructions section`);
  } else {
    fail(`${file}: missing ## Workflow or ## Instructions section`);
  }
}

// Skill SKILL.md files
if (fs.existsSync(SKILLS_DIR)) {
  const skillDirs = fs.readdirSync(SKILLS_DIR).filter(d =>
    fs.statSync(path.join(SKILLS_DIR, d)).isDirectory()
  );
  for (const dir of skillDirs) {
    const skillFile = path.join(SKILLS_DIR, dir, 'SKILL.md');
    if (fs.existsSync(skillFile)) {
      const content = fs.readFileSync(skillFile, 'utf8');
      const lines = content.split('\n');

      const { frontmatter: skillFm, headingLine: skillHL } = parseFrontmatter(content);

      if (skillFm && skillHL >= 0) {
        ok(`skills/${dir}/SKILL.md: has # heading (after frontmatter)`);
      } else if (lines[0] && lines[0].replace(/\r$/, '').startsWith('# ')) {
        ok(`skills/${dir}/SKILL.md: has # heading`);
      } else {
        fail(`skills/${dir}/SKILL.md: missing # heading`);
      }

      // Check version in frontmatter
      if (skillFm && skillFm.version) {
        if (/^\d+\.\d+\.\d+$/.test(skillFm.version)) {
          ok(`skills/${dir}/SKILL.md: has valid version '${skillFm.version}'`);
        } else {
          fail(`skills/${dir}/SKILL.md: invalid version format '${skillFm.version}'`);
        }
      } else {
        fail(`skills/${dir}/SKILL.md: missing YAML frontmatter with version`);
      }

      // Must have ## Instructions or ## Process section
      if (content.includes('## Instructions') || content.includes('## Process')) {
        ok(`skills/${dir}/SKILL.md: has ## Instructions/Process section`);
      } else {
        fail(`skills/${dir}/SKILL.md: missing ## Instructions or ## Process section`);
      }
    }
  }
}

// --- 3. Scoring Formula Consistency ---

console.log('\n=== Scoring Formula Consistency ===\n');

const SCORING_PATTERN = /10\s*[-\u2013]\s*\(?critical[_\s]*(?:violations?)?\s*\*\s*3\)?/i;
const GATE_FILES = [
  path.join(CLAUDE_AGENTS, 'codex-anti-slop.md'),
  path.join(CLAUDE_AGENTS, 'codex-ui-validator.md'),
  path.join(CODEX_AGENTS, 'anti-slop.toml'),
  path.join(CODEX_AGENTS, 'ui-validator.toml'),
];

const formulaMatches = [];
for (const filepath of GATE_FILES) {
  if (!fs.existsSync(filepath)) {
    fail(`${path.basename(filepath)}: file not found`);
    continue;
  }
  const content = fs.readFileSync(filepath, 'utf8');

  // Look for the scoring formula pattern
  if (SCORING_PATTERN.test(content)) {
    ok(`${path.basename(filepath)}: contains scoring formula`);
    formulaMatches.push(path.basename(filepath));
  } else {
    fail(`${path.basename(filepath)}: scoring formula not found`);
  }

  // Check pass threshold = 7
  if (/>=?\s*7/.test(content) || /score\s*>=?\s*7/i.test(content)) {
    ok(`${path.basename(filepath)}: pass threshold >= 7 present`);
  } else {
    fail(`${path.basename(filepath)}: pass threshold >= 7 not found`);
  }

  // Check max 3 rounds
  if (/max\s*3\s*round/i.test(content) || /3\s*round/i.test(content)) {
    ok(`${path.basename(filepath)}: max 3 rounds documented`);
  } else {
    fail(`${path.basename(filepath)}: max 3 rounds not documented`);
  }
}

if (formulaMatches.length === GATE_FILES.length) {
  ok(`Scoring formula consistent across all ${formulaMatches.length} gate files`);
} else {
  fail(`Scoring formula missing from ${GATE_FILES.length - formulaMatches.length} gate file(s)`);
}

// --- 4. Cross-Reference Validation ---

console.log('\n=== Cross-Reference Validation ===\n');

const uninstallPath = path.join(ROOT, 'scripts', 'uninstall.sh');
const installPath = path.join(ROOT, 'scripts', 'install.sh');

if (fs.existsSync(uninstallPath)) {
  const uninstallContent = fs.readFileSync(uninstallPath, 'utf8');

  for (const file of mdFiles) {
    const name = file.replace('.md', '');
    if (uninstallContent.includes(name)) {
      ok(`uninstall.sh: references ${name}`);
    } else {
      fail(`uninstall.sh: missing reference to ${name}`);
    }
  }

  for (const file of tomlFiles) {
    const name = file.replace('.toml', '');
    if (uninstallContent.includes(name)) {
      ok(`uninstall.sh: references ${name}`);
    } else {
      fail(`uninstall.sh: missing reference to ${name}`);
    }
  }
} else {
  fail('scripts/uninstall.sh not found');
}

// --- Summary ---

console.log('\n' + '='.repeat(50));
console.log(`\nResults: ${passes} passed, ${failures} failed`);

if (failures > 0) {
  console.error(`\n${failures} validation failure(s) found.`);
  process.exit(1);
} else {
  console.log('\nAll validations passed.');
}
