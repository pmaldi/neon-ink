import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCombo, eventCombo, buildKeymap, prettyCombo } from '../src/keys.js';
import defaults from '../src/config.default.json' with { type: 'json' };

const ev = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test('lecture des combinaisons', () => {
  assert.equal(parseCombo('d'), 'D');
  assert.equal(parseCombo('ctrl + z'), 'Ctrl+Z');
  assert.equal(parseCombo('Maj+K'), 'Shift+K');
  assert.equal(parseCombo('Échap'), 'Escape');
  assert.equal(parseCombo('suppr'), 'Delete');
  assert.equal(parseCombo('+'), '+');
  assert.equal(parseCombo('Ctrl++'), 'Ctrl++');
  assert.equal(parseCombo('f10'), 'F10');
  assert.equal(parseCombo('Hyper+Z'), null);
  assert.equal(parseCombo(''), null);
});

test('touches pressées', () => {
  assert.equal(eventCombo(ev('z', { ctrlKey: true })), 'Ctrl+Z');
  assert.equal(eventCombo(ev('K', { shiftKey: true })), 'Shift+K');
  assert.equal(eventCombo(ev('k')), 'K');
  // Shift sert à taper le symbole : il ne fait pas partie de la combinaison.
  assert.equal(eventCombo(ev('+', { shiftKey: true })), '+');
  assert.equal(eventCombo(ev('?', { shiftKey: true })), '?');
  assert.equal(eventCombo(ev('Escape')), 'Escape');
  assert.equal(eventCombo(ev(' ')), 'Space');
});

test('la configuration d\'origine est cohérente', () => {
  const { map, errors } = buildKeymap(defaults.raccourcis);
  assert.deepEqual(errors, []);
  assert.equal(map.get('Shift+K'), 'tableauNoir');
  assert.equal(map.get('K'), 'couleurNoir');
  assert.equal(map.get('Ctrl+Z'), 'annuler');
  assert.equal(map.get('Backspace'), 'annuler');
});

test('conflits et erreurs signalés', () => {
  const { map, errors } = buildKeymap({ stylo: 'D', gomme: ['d', 'Bidule+E'] });
  assert.equal(map.get('D'), 'stylo');
  assert.equal(errors.length, 2);
});

test('affichage', () => {
  assert.equal(prettyCombo('Shift+K'), 'Maj+K');
  assert.equal(prettyCombo('Ctrl++'), 'Ctrl++');
  assert.equal(prettyCombo('Escape'), 'Échap');
});
