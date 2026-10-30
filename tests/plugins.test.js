import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { snapToGrid } from '../src/boards.js';
import { API_VERSION } from '../src/plugins.js';

test('aimantation : seulement sur papier quadrillé', () => {
  assert.deepEqual(snapToGrid(null, { x: 13, y: 47 }), { x: 13, y: 47 });
  assert.deepEqual(snapToGrid('white', { x: 13, y: 47 }), { x: 13, y: 47 });
  assert.deepEqual(snapToGrid('small', { x: 13, y: 47 }), { x: 19, y: 38 });
  assert.deepEqual(snapToGrid('seyes', { x: 44, y: 46 }), { x: 30, y: 60 });
});

// API factice : enregistre ce que chaque plugin déclare.
function fakeApi(id) {
  const seen = { types: {}, tools: {}, actions: {}, overlays: {} };
  const api = {
    version: API_VERSION, id, palette: {}, draw: {}, color: {}, width: 5,
    defineObject: (n, d) => { seen.types[n] = d; },
    defineTool: (n, d) => { seen.tools[n] = d; return `plugin:${id}.${n}`; },
    defineAction: (n, d) => { seen.actions[n] = d; },
    useTool() {}, toolActive: () => false, add: (t, d) => ({ type: t, ...d }), remove() {}, objects: () => [],
    objectAt: () => null, snap: (p) => p, toast() {}, render() {}, refreshHud() {},
    wheel() {}, changed() {}, prompt: async () => null, screen: async () => null,
    defineOverlay: (n, d) => { seen.overlays[n] = d; },
    size: { w: 1280, h: 720 }, pointer: null, drawing: true,
  };
  return { api, seen };
}

test('chaque plugin du dépôt se charge et déclare ce qu’il ajoute', async () => {
  for (const dir of await readdir('plugins', { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const mod = await import(`../plugins/${dir.name}/plugin.js`);
    assert.equal(mod.manifest.id, dir.name);
    assert.equal(mod.manifest.api, API_VERSION);
    assert.match(mod.manifest.version, /^\d+\.\d+\.\d+$/);
    const { api, seen } = fakeApi(dir.name);
    mod.activate(api);
    for (const [name, a] of Object.entries(seen.actions)) {
      assert.ok(a.label && typeof a.run === 'function', `${dir.name}.${name}`);
    }
    for (const [name, o] of Object.entries(seen.overlays)) {
      assert.ok(typeof o.active === 'function' && typeof o.draw === 'function', `${dir.name}.${name}`);
    }
    for (const [name, t] of Object.entries(seen.types)) {
      assert.equal(typeof t.draw, 'function', `${dir.name}.${name}`);
      assert.equal(typeof t.hit, 'function', `${dir.name}.${name}`);
    }
  }
});

test('Réseau : touche J, appareils et liens', async () => {
  const mod = await import('../plugins/reseau/plugin.js');
  const { api, seen } = fakeApi('reseau');
  mod.activate(api);
  assert.equal(seen.actions.reseau.key, 'J');
  for (const type of ['appareil', 'lien']) assert.ok(seen.types[type], type);
  assert.ok(seen.tools.reseau.label().startsWith('Réseau'));
});

test('les touches par défaut des plugins ne se marchent pas dessus', async () => {
  const { readFile } = await import('node:fs/promises');
  const { parseCombo: normalizeKey } = await import('../src/keys.js');
  const config = JSON.parse(await readFile('src/config.default.json', 'utf8'));
  const taken = new Map();
  for (const [action, keys] of Object.entries(config.raccourcis ?? config)) {
    if (action.startsWith('_')) continue;
    for (const k of [keys].flat()) taken.set(normalizeKey(k), action);
  }
  for (const dir of await readdir('plugins', { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const mod = await import(`../plugins/${dir.name}/plugin.js`);
    const { api, seen } = fakeApi(dir.name);
    mod.activate(api);
    for (const [name, a] of Object.entries(seen.actions)) {
      if (!a.key) continue;
      const key = normalizeKey(a.key);
      assert.ok(!taken.has(key), `${dir.name}.${name} : ${a.key} déjà pris par ${taken.get(key)}`);
      taken.set(key, `${dir.name}.${name}`);
    }
  }
});
