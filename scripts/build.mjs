import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const pkg = read('package.json');
const english = read('source/en.json');
const japanese = read('locale/ja.json');
const provenance = read('source/provenance.json');
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
const sorted = Object.fromEntries(Object.keys(japanese).sort().map(namespace => [namespace, japanese[namespace]]));
assert.deepEqual(Object.keys(japanese).sort(), Object.keys(english).sort(), 'Namespace parity');
assert.deepEqual(Object.keys(provenance.namespaces).sort(), Object.keys(english).sort(), 'Provenance parity');
let count = 0;
for (const [namespace, entries] of Object.entries(english)) {
  assert.deepEqual(Object.keys(japanese[namespace]).sort(), Object.keys(entries).sort(), `Key parity: ${namespace}`);
  assert.equal(provenance.namespaces[namespace].keys, Object.keys(entries).length, `Provenance count: ${namespace}`);
  for (const [key, source] of Object.entries(entries)) {
    const target = japanese[namespace][key];
    assert.equal(typeof target, 'string', `${namespace}.${key}: must be text`);
    assert.deepEqual(placeholders(target), placeholders(source), `${namespace}.${key}: placeholders`);
    if (source.trim()) assert.ok(target.trim(), `${namespace}.${key}: empty translation`);
    count++;
  }
}
assert.equal(count, 3177);
assert.equal(Object.keys(japanese).length, 57);
// These select shipped assets/engine dictionaries, not visible display text.
assert.equal(japanese['settings.account'].onboardingArtworkLocale, 'en');
assert.equal(japanese.sidebarExcel.language, 'en');

const code = `// SPDX-License-Identifier: MIT\n// Copyright (c) 2026 akaitigo\n// Copyright (c) 2026 DeepSeek (Harness UI source strings)\n// Copyright (c) 2026 WSL043 (Codex Subscription UI source strings)\n// Keep LICENSE and THIRD_PARTY_NOTICES.md with redistributed copies.\n// Generated from locale/ja.json; no extra runtime dependencies.\nwindow.__ModuleLoader__.load({\n  id: ${JSON.stringify(pkg.name)},\n  factory: () => {\n    const dictionaries = ${JSON.stringify(sorted, null, 2)};\n    return {\n      inject: ['locale'],\n      apply(ctx) {\n        // Prefer an existing official/other Japanese pack rather than collide.\n        if (ctx.locale.getSnapshot().locales.some(language => language.id.toLowerCase() === 'ja')) return;\n        for (const [namespace, dictionary] of Object.entries(dictionaries)) {\n          ctx.effect(\n            () => ctx.locale.register(namespace, 'ja', dictionary),\n            'locale-ja: ' + namespace\n          );\n        }\n        ctx.effect(\n          () => ctx.locale.addLanguage({ id: 'ja', label: '日本語', fallback: 'en' }),\n          'locale-ja: language'\n        );\n      }\n    };\n  }\n});\n`;
new vm.Script(code, { filename: 'lib/client.js' });
const target = path.join(root, 'lib/client.js');
if (process.argv.includes('--check')) {
  assert.equal(fs.readFileSync(target, 'utf8'), code, 'Committed bundle differs from source; run npm run build');
  console.log(`Checked reproducible bundle: ${count} strings, 57 namespaces.`);
} else {
  // Observe any existing output before regenerating it.
  if (fs.existsSync(target)) fs.readFileSync(target, 'utf8');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code);
  console.log(`Built ${count} strings in 57 namespaces.`);
}
