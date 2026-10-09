import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const allow = new Set([
  '.gitignore', '.github/workflows/ci.yml', 'CHANGELOG.md', 'README.md', 'LICENSE',
  'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'cordis.patch.yml',
  'docs/GETTING_STARTED.ja.md', 'locale/ja.json', 'source/en.json', 'source/provenance.json',
  'licenses/DeepSeek-Harness-MIT.txt', 'licenses/Codex-Subscription-MIT.txt',
  'lib/index.js', 'lib/client.js', 'scripts/build.mjs', 'scripts/check-publication.mjs',
  'tests/pack.test.mjs',
]);
let files;
if (fs.existsSync(path.join(root, '.git'))) {
  assert.equal(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' }).trim(), root);
  files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
} else {
  files = [...allow].filter(file => fs.existsSync(path.join(root, file)));
}
files = [...new Set(files)];
for (const file of files) assert.ok(allow.has(file), `Not on publication allowlist: ${file}`);
for (const file of allow) assert.ok(files.includes(file), `Required publication file missing: ${file}`);
const patterns = [
  [/\/(?:Users|home)\/[^/\s]+\//, 'machine-specific home path'],
  [/\b[A-Za-z]:\\Users\\[^\\\s]+\\/, 'machine-specific Windows home path'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/, 'GitHub credential'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, 'GitHub fine-grained credential'],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/, 'API credential'],
  [/-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----/, 'private key'],
];
for (const file of files) {
  const absolute = path.resolve(root, file);
  assert.ok(absolute.startsWith(root + path.sep));
  assert.ok(fs.lstatSync(absolute).isFile(), `Symlink/non-file not allowed: ${file}`);
  const text = fs.readFileSync(absolute, 'utf8');
  for (const [pattern, meaning] of patterns) assert.ok(!pattern.test(text), `${file}: possible ${meaning}`);
}
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const [name, entry] of Object.entries(lock.packages)) {
  if (entry.resolved) assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'), `Nonpublic dependency origin: ${name}`);
}
console.log(`Publication allowlist and basic privacy/credential scan passed: ${files.length} files.`);
console.log('This is a targeted check, not a guarantee that arbitrary secrets can never be present.');
