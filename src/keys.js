// Raccourcis configurables : lecture des combinaisons (« Ctrl+Z », « Shift+K », « F10 »)
// et correspondance avec les touches pressées.

const ALIASES = {
  esc: 'Escape', escape: 'Escape', échap: 'Escape', echap: 'Escape',
  del: 'Delete', delete: 'Delete', suppr: 'Delete',
  backspace: 'Backspace', retour: 'Backspace',
  space: 'Space', espace: 'Space', ' ': 'Space',
  enter: 'Enter', entrée: 'Enter', entree: 'Enter',
  tab: 'Tab',
};
const MODIFIERS = { ctrl: 'Ctrl', control: 'Ctrl', ctl: 'Ctrl', cmd: 'Ctrl', commandorcontrol: 'Ctrl', alt: 'Alt', shift: 'Shift', maj: 'Shift' };

const isLetter = (k) => k.length === 1 && /\p{L}/u.test(k);

function normalizeKey(key) {
  if (key.length === 1) return key === ' ' ? 'Space' : key.toUpperCase();
  const alias = ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  return key[0].toUpperCase() + key.slice(1);
}

/**
 * Forme canonique d'une combinaison : « Ctrl+Alt+Shift+Touche ».
 * Shift ne compte qu'avec une lettre ou une touche nommée : sur un symbole (« + », « ? »),
 * il dépend de la disposition du clavier.
 */
function canonical(mods, key) {
  const named = key.length > 1;
  const parts = [];
  if (mods.ctrl) parts.push('Ctrl');
  if (mods.alt) parts.push('Alt');
  if (mods.shift && (named || isLetter(key))) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** « ctrl + z » → « Ctrl+Z » ; null si la combinaison est illisible. */
export function parseCombo(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let t = text.trim();
  let key = null;
  // « Ctrl++ » ou « + » : la touche est le signe plus lui-même.
  if (t.endsWith('+') && (t.length === 1 || t.endsWith('++'))) {
    key = '+';
    t = t.slice(0, t.length === 1 ? 0 : -2);
  }
  const tokens = t ? t.split('+').map((s) => s.trim()) : [];
  if (!key) key = tokens.pop();
  if (!key) return null;
  const mods = {};
  for (const tok of tokens) {
    const m = MODIFIERS[tok.toLowerCase()];
    if (!m) return null;
    mods[m.toLowerCase()] = true;
  }
  return canonical(mods, normalizeKey(key));
}

/** Combinaison canonique d'un événement clavier. */
export function eventCombo(e) {
  return canonical({ ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey }, normalizeKey(e.key));
}

/**
 * Construit la table combinaison → action à partir de `raccourcis`.
 * Renvoie aussi les erreurs (combinaison illisible, touche attribuée deux fois).
 */
export function buildKeymap(shortcuts) {
  const map = new Map();
  const byAction = {};
  const errors = [];
  for (const [action, value] of Object.entries(shortcuts ?? {})) {
    const list = Array.isArray(value) ? value : [value];
    byAction[action] = [];
    for (const text of list) {
      const combo = parseCombo(text);
      if (!combo) {
        errors.push(`« ${text} » illisible pour ${action}`);
        continue;
      }
      if (map.has(combo) && map.get(combo) !== action) {
        errors.push(`${combo} attribué à ${map.get(combo)} et à ${action}`);
        continue;
      }
      map.set(combo, action);
      byAction[action].push(combo);
    }
  }
  return { map, byAction, errors };
}

const PRETTY = { Escape: 'Échap', Delete: 'Suppr', Backspace: '⌫', Space: 'Espace', Enter: 'Entrée', Shift: 'Maj', Tab: 'Tab' };

/** Affichage d'une combinaison pour l'aide : « Ctrl+Z », « Maj+K », « Échap ». */
export function prettyCombo(combo) {
  return combo
    .split(/\+(?!$)/)
    .map((p) => PRETTY[p] ?? p)
    .join('+');
}
