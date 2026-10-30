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

import { mouseCombo, isMouseCombo } from '../src/keys.js';

test('boutons de souris : molette et boutons latéraux, gauche et droit réservés', () => {
  assert.equal(parseCombo('Mouse4'), 'Mouse4');
  assert.equal(parseCombo('ctrl + souris 5'), 'Ctrl+Mouse5');
  assert.equal(parseCombo('Mouse1'), 'Mouse1'); // lu tel quel mais jamais produit par un clic
  assert.equal(mouseCombo({ button: 1 }), 'Mouse3');
  assert.equal(mouseCombo({ button: 3, shiftKey: true }), 'Shift+Mouse4');
  assert.equal(mouseCombo({ button: 0 }), null);
  assert.equal(mouseCombo({ button: 2 }), null);
  assert.equal(prettyCombo('Ctrl+Mouse3'), 'Ctrl+Clic molette');
  assert.ok(isMouseCombo('Alt+Mouse5'));
  assert.ok(!isMouseCombo('M'));
  const { map } = buildKeymap({ reseau: ['J', 'Mouse4'] });
  assert.equal(map.get('Mouse4'), 'reseau');
});
