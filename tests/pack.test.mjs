import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const pkg = read('package.json');
const english = read('source/en.json');
const japanese = read('locale/ja.json');

function materialize(file) {
  let registration;
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { assert.equal(registration, undefined); registration = value; } } },
    navigator: { languages: ['en-US'], language: 'en-US' },
    document: { documentElement: { lang: 'en' }, querySelector: () => ({}) },
    console,
  };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { timeout: 1000, filename: path.basename(file) });
  assert.ok(registration);
  return { id: registration.id, exports: registration.factory(() => ({})) };
}
const actualRuntime = materialize(require.resolve('@deepseek-ai/dsh-client-locale/client')).exports;
const { id, exports: plugin } = materialize(path.join(root, 'lib/client.js'));
function createLocale(initialPreference) {
  const effects = [];
  let preference = initialPreference;
  const listeners = new Set();
  const host = {
    getSnapshot: () => ({ value: preference === undefined ? {} : { preference } }),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(field, value) { assert.equal(field, 'preference'); preference = value; for (const fn of listeners) fn(); },
  };
  const ctx = { effect(fn) { const dispose = fn(); if (typeof dispose === 'function') effects.push(dispose); }, emit() {} };
  ctx.locale = new actualRuntime.LocaleRuntime(ctx, host);
  for (const [namespace, dictionary] of Object.entries(english)) ctx.locale.register(namespace, 'en', dictionary);
  return { ctx, getPreference: () => preference, unload: () => effects.reverse().forEach(fn => fn()) };
}

test('registration id, bundle manifest and loader patch agree', () => {
  assert.equal(id, pkg.name);
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.deepEqual([...plugin.inject], ['locale']);
  assert.deepEqual(pkg.dsh.client.inject, ['@deepseek-ai/dsh-client-locale']);
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8');
  assert.ok(patch.includes("name: 'dsh-locale-ja'"));
  assert.ok(!/\bconfig:|\bpreference:/.test(patch), 'Installing must not overwrite user settings');
});
test('all 3,177 strings resolve through the real published LocaleRuntime', () => {
  const { ctx } = createLocale('ja');
  plugin.apply(ctx);
  assert.equal(ctx.locale.getSnapshot().active, 'ja');
  assert.equal(ctx.locale.getSnapshot().locales.find(l => l.id === 'ja').label, '日本語');
  let count = 0;
  for (const [namespace, entries] of Object.entries(japanese)) {
    for (const [key, value] of Object.entries(entries)) {
      assert.equal(ctx.locale.bind(namespace)(key), value, `${namespace}.${key}`);
      count++;
    }
  }
  assert.equal(count, 3177);
});
test('choosing Japanese persists; installation itself preserves the preference', () => {
  const { ctx, getPreference } = createLocale('en');
  plugin.apply(ctx);
  assert.equal(getPreference(), 'en');
  ctx.locale.setLocale('ja');
  assert.equal(getPreference(), 'ja');
  assert.equal(ctx.locale.bind('common')('cancel'), 'キャンセル');
  ctx.locale.setLocale('en');
  assert.equal(ctx.locale.bind('common')('cancel'), 'Cancel');
  ctx.locale.setLocale('ja');
  assert.equal(ctx.locale.bind('settings.locale')('language.title'), '言語');
});
test('interpolations and fallback for untranslated future keys work', () => {
  const { ctx } = createLocale('ja');
  ctx.locale.register('future.namespace', 'en', { example: 'Fallback {name}' });
  plugin.apply(ctx);
  assert.equal(ctx.locale.bind('future.namespace')('example', { name: 'TEST' }), 'Fallback TEST');
  const text = ctx.locale.bind('chat')('stats.cacheHit', { percent: 42 });
  assert.ok(text.includes('42%'));
  assert.ok(!text.includes('{percent}'));
});
test('unloading removes the pack and falls back safely', () => {
  const { ctx, unload, getPreference } = createLocale('ja');
  plugin.apply(ctx);
  unload();
  assert.equal(ctx.locale.getSnapshot().active, 'en');
  assert.equal(ctx.locale.getSnapshot().locales.some(l => l.id === 'ja'), false);
  assert.equal(ctx.locale.bind('common')('cancel'), 'Cancel');
  assert.equal(getPreference(), 'ja');
});
test('an already registered Japanese language is left untouched', () => {
  const { ctx } = createLocale('ja');
  ctx.locale.addLanguage({ id: 'ja', label: 'Existing Japanese', fallback: 'en' });
  ctx.locale.register('common', 'ja', { cancel: '既存の翻訳' });
  assert.doesNotThrow(() => plugin.apply(ctx));
  assert.equal(ctx.locale.bind('common')('cancel'), '既存の翻訳');
});
test('all keys and placeholder multisets match the original catalogs', () => {
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
  assert.deepEqual(Object.keys(japanese).sort(), Object.keys(english).sort());
  for (const [namespace, entries] of Object.entries(english)) {
    assert.deepEqual(Object.keys(japanese[namespace]).sort(), Object.keys(entries).sort());
    for (const [key, value] of Object.entries(entries)) {
      assert.deepEqual(placeholders(japanese[namespace][key]), placeholders(value), `${namespace}.${key}`);
    }
  }
});
test('no unsupported Japanese artwork or spreadsheet engine locale is selected', () => {
  assert.equal(japanese['settings.account'].onboardingArtworkLocale, 'en');
  assert.equal(japanese.sidebarExcel.language, 'en');
});
test('Codex Subscription translations are data only and do not install that plugin', () => {
  assert.equal(Object.keys(japanese['settings.codexSubscription']).length, 585);
  assert.ok(!Object.hasOwn(pkg.dependencies ?? {}, 'dsh-codex-subscription'));
});
test('full upstream license texts and copyright notices are preserved', () => {
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  for (const holder of ['akaitigo', 'DeepSeek', 'WSL043']) assert.ok(license.includes('Copyright (c) 2026 ' + holder));
  assert.ok(license.includes('THE SOFTWARE IS PROVIDED "AS IS"'));
  const bytes = fs.readFileSync(path.join(root, 'licenses/DeepSeek-Harness-MIT.txt'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), 'ebb4f09972aee8608be255debaf78451a68e95c290f55c240dec2ecfa16ea6be');
  assert.ok(fs.readFileSync(path.join(root, 'licenses/Codex-Subscription-MIT.txt'), 'utf8').includes('Copyright (c) 2026 WSL043'));
});
test('Host entry is inert; there are no package lifecycle install hooks', async () => {
  const host = await import('../lib/index.js');
  assert.equal(host.apply(), undefined);
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) assert.ok(!Object.hasOwn(pkg.scripts, hook));
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});
