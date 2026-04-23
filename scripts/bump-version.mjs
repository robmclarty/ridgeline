#!/usr/bin/env node
/**
 * Version bumper — backend for the `/version` skill.
 *
 * Accepts raw arguments matching the `/version` skill's `$ARGUMENTS`:
 *
 *   patch | minor | major    → standard bump
 *
 * Pre-flight:
 *   - working tree must be clean (a release commit must contain only the
 *     version bump + CHANGELOG; mixing in WIP is the bug we're refusing to
 *     ship).
 *
 * Always emits exactly one JSON object to stdout — the skill consumes this
 * directly. The `mode` field tells the caller what happened:
 *
 *   { mode: 'bump',  old, new, since, files: [...], changed_count }
 *   { mode: 'error', error_type, message }
 *
 * `since` on a successful bump is the SHA of the previous release commit.
 * The regex matches both the current `vX.Y.Z` convention and the legacy
 * `chore: bump version to X.Y.Z` convention, so the transition is seamless.
 * The skill uses this SHA as the left boundary for the CHANGELOG commit
 * range. If no prior release exists, `since` is null.
 *
 * Exit codes:
 *   0  script ran to completion — includes expected failures (dirty_tree,
 *      usage). The JSON's `mode` field signals success vs. failure, so the
 *      skill can read it. Non-zero would make the slash-command preflight
 *      swallow stdout and never hand control to the skill body, hiding the
 *      error from the user.
 *   2  unexpected runtime crash — JSON still on stdout if possible
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PKG_PATH = join(REPO_ROOT, 'package.json');

function emit(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function emit_error(error_type, message) {
  emit({ mode: 'error', error_type, message });
  process.exit(0);
}

function parse_args(argv) {
  const args = argv.slice(2);
  if (args.length === 0) return { error: 'no arguments — pass `patch`, `minor`, or `major`.' };
  if (args.length > 1) return { error: `too many arguments: ${args.join(' ')}` };
  const [a] = args;
  if (!['patch', 'minor', 'major'].includes(a)) {
    return { error: `unknown argument: ${a} (expected patch|minor|major)` };
  }
  return { bump_type: a };
}

function check_clean_tree() {
  let out;
  try {
    out = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    return { ok: false, runtime_error: `git status failed: ${err.message}` };
  }
  const trimmed = out.trim();
  if (trimmed === '') return { ok: true };
  return { ok: false, dirty_files: trimmed.split('\n') };
}

// Find the SHA of the previous release commit. Matches both conventions:
//   - new: `vX.Y.Z` (the tag-style subject adopted going forward)
//   - legacy: `chore: bump version to X.Y.Z` (everything before the switch)
// Returns null if no prior release exists.
function find_previous_release_sha() {
  try {
    const pattern = '^(v[0-9]+\\.[0-9]+\\.[0-9]+|chore: bump version to [0-9]+\\.[0-9]+\\.[0-9]+)$';
    const out = execFileSync(
      'git',
      ['log', '-E', `--grep=${pattern}`, '-1', '--pretty=%H'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    const sha = out.trim();
    return sha === '' ? null : sha;
  } catch {
    return null;
  }
}

function bump_semver(current, type) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`unparseable semver: ${current}`);
  const [_, ma, mi, pa] = m;
  const major = Number(ma);
  const minor = Number(mi);
  const patch = Number(pa);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`unknown bump type: ${type}`);
}

function detect_indent(text) {
  const m = text.match(/^([ \t]+)"/m);
  return m ? m[1] : 2;
}

async function read_pkg_version() {
  const text = await readFile(PKG_PATH, 'utf8');
  const pkg = JSON.parse(text);
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
    throw new Error('package.json is missing a `version` field');
  }
  return { text, pkg };
}

async function write_pkg_version(new_version) {
  const { text, pkg } = await read_pkg_version();
  if (pkg.version === new_version) return false;
  pkg.version = new_version;
  const indent = detect_indent(text);
  const trailing = text.endsWith('\n') ? '\n' : '';
  await writeFile(PKG_PATH, `${JSON.stringify(pkg, null, indent)}${trailing}`);
  return true;
}

async function mode_bump(bump_type) {
  const tree = check_clean_tree();
  if (!tree.ok) {
    if (tree.runtime_error) emit_error('runtime', tree.runtime_error);
    const lines = tree.dirty_files.map((l) => `  ${l}`).join('\n');
    emit_error(
      'dirty_tree',
      `working tree is not clean — refusing to bump.\n` +
        `  a release commit must contain only the version bump + CHANGELOG.\n` +
        `  uncommitted changes:\n${lines}`,
    );
  }

  const { pkg } = await read_pkg_version();
  const current = pkg.version;
  const since = find_previous_release_sha();
  const next = bump_semver(current, bump_type);
  const changed = await write_pkg_version(next);
  const files = [{ rel: 'package.json', kind: 'root_pkg', changed }];
  emit({
    mode: 'bump',
    old: current,
    new: next,
    since,
    files,
    changed_count: files.filter((f) => f.changed).length,
  });
}

async function main() {
  const parsed = parse_args(process.argv);
  if (parsed.error) emit_error('usage', parsed.error);
  await mode_bump(parsed.bump_type);
}

main().catch((err) => {
  try {
    emit({ mode: 'error', error_type: 'runtime', message: err.stack ?? err.message });
  } catch {
    process.stderr.write(`bump-version: orchestrator error: ${err.stack ?? err.message}\n`);
  }
  process.exit(2);
});
