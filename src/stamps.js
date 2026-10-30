// Formes toutes faites de l'outil « Formes » : on les pose d'un glisser, sans les dessiner.
// Entrée : point de départ `a` et point d'arrivée `b` du glisser. Sortie : { kind, pts, closed, smooth }.

import { dist, rotate } from './geom.js';

export const STAMPS = [
  { kind: 'rect', label: '▭ Rectangle' },
  { kind: 'ellipse', label: '◯ Rond' },
  { kind: 'triangle', label: '△ Triangle' },
  { kind: 'star', label: '☆ Étoile' },
  { kind: 'arrow', label: '➜ Flèche' },
];

export const STAMP_SIZE = 140; // taille d'une forme posée d'un simple clic

const ring = (n, radius) => Array.from({ length: n }, (_, i) => {
  const t = -Math.PI / 2 + (i / n) * 2 * Math.PI;
  const r = radius(i);
  return { x: r * Math.cos(t), y: r * Math.sin(t) };
});

// Formes de référence (pointe en haut), redimensionnées ensuite dans le cadre du glisser.
const UNIT = {
  rect: { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], smooth: false },
  ellipse: { pts: ring(96, () => 1), smooth: true },
  triangle: { pts: ring(3, () => 1), smooth: false },
  star: { pts: ring(10, (i) => (i % 2 ? 0.42 : 1)), smooth: false },
};

function bounds(pts) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { minX, minY, w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}

/**
 * Forme `kind` tracée de `a` à `b`. `regular` (Maj) : carré, cercle, triangle équilatéral,
 * étoile régulière, flèche alignée sur 45°.
 */
export function stamp(kind, a, b, { regular = false, width = 5 } = {}) {
  if (kind === 'arrow') return arrow(a, b, regular, width);
  const unit = UNIT[kind];
  const u = bounds(unit.pts);
  let dx = b.x - a.x, dy = b.y - a.y;
  if (regular) {
    // Même proportions que la forme de référence, à la taille du plus grand côté du glisser.
    const ratio = u.h / u.w;
    const w = Math.max(Math.abs(dx), Math.abs(dy) / ratio);
    dx = Math.sign(dx || 1) * w;
    dy = Math.sign(dy || 1) * w * ratio;
  }
  const x0 = Math.min(a.x, a.x + dx), y0 = Math.min(a.y, a.y + dy);
  const sx = Math.abs(dx) / u.w, sy = Math.abs(dy) / u.h;
  const pts = unit.pts.map((p) => ({ x: x0 + (p.x - u.minX) * sx, y: y0 + (p.y - u.minY) * sy }));
  return { kind, pts, closed: true, smooth: unit.smooth };
}

/** Forme posée d'un clic : taille par défaut, centrée sur le point. */
export function stampAt(kind, p, opts = {}) {
  const h = STAMP_SIZE / 2;
  if (kind === 'arrow') return stamp(kind, { x: p.x - h, y: p.y }, { x: p.x + h, y: p.y }, opts);
  return stamp(kind, { x: p.x - h, y: p.y - h }, { x: p.x + h, y: p.y + h }, { ...opts, regular: true });
}

function arrow(a, b, regular, width) {
  let tip = b;
  if (regular) {
    const step = Math.PI / 4;
    const ang = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
    const len = dist(a, b);
    tip = { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
  }
  const len = dist(a, tip) || 1;
  const head = Math.min(len * 0.4, 16 + width * 2.5);
  const back = { x: tip.x - ((tip.x - a.x) / len) * head, y: tip.y - ((tip.y - a.y) / len) * head };
  const left = rotate(back, Math.PI / 6, tip), right = rotate(back, -Math.PI / 6, tip);
  // Une seule polyligne : la tige, puis les deux branches de la pointe.
  return { kind: 'arrow', pts: [a, tip, left, tip, right], closed: false, smooth: false };
}
