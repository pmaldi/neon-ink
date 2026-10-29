import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recognize } from '../src/shapes.js';

// Générateur pseudo-aléatoire déterministe pour simuler une main qui tremble.
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Trace un polygone/courbe « à la main » : bruit basse fréquence + tremblement. */
function hand(path, { seed = 1, jitter = 2.5, wobble = 4 } = {}) {
  const r = rng(seed);
  const phase = r() * 6, phase2 = r() * 6;
  return path.map((p, i) => {
    const t = i / path.length;
    return {
      x: p.x + Math.sin(t * 7 + phase) * wobble + (r() - 0.5) * jitter * 2,
      y: p.y + Math.cos(t * 5 + phase2) * wobble + (r() - 0.5) * jitter * 2,
    };
  });
}

function polyline(corners, perSide = 30, closed = true) {
  const out = [];
  const n = closed ? corners.length : corners.length - 1;
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    for (let k = 0; k < perSide; k++) out.push({ x: a.x + ((b.x - a.x) * k) / perSide, y: a.y + ((b.y - a.y) * k) / perSide });
  }
  if (closed) out.push({ ...corners[0] });
  else out.push({ ...corners[corners.length - 1] });
  return out;
}

function arc(cx, cy, rx, ry, turns = 1, start = 0, n = 120, rot = 0) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = start + (i / n) * turns * 2 * Math.PI;
    const x = rx * Math.cos(t), y = ry * Math.sin(t);
    out.push({ x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return out;
}

const rotateAll = (pts, a, c) =>
  pts.map((p) => ({
    x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a),
    y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a),
  }));

const kindOf = (pts) => recognize(pts)?.kind ?? 'free';

const seeds = [1, 2, 3, 4, 5, 6, 7, 8];

test('trait droit (et accroché à l’horizontale)', () => {
  for (const seed of seeds) {
    const r = recognize(hand(polyline([{ x: 100, y: 200 }, { x: 420, y: 214 }], 60, false), { seed, wobble: 3 }));
    assert.equal(r?.kind, 'line', `seed ${seed}`);
  }
  const r = recognize(polyline([{ x: 0, y: 0 }, { x: 300, y: 12 }], 40, false));
  assert.ok(Math.abs(r.pts[0].y - r.pts[1].y) < 1e-6, 'doit être horizontal');
});

test('petit trait tremblant', () => {
  for (const seed of seeds) assert.equal(kindOf(hand(polyline([{ x: 10, y: 10 }, { x: 80, y: 50 }], 25, false), { seed, wobble: 2 })), 'line');
});

test('cercle, y compris non fermé ou qui dépasse', () => {
  for (const seed of seeds) {
    assert.equal(kindOf(hand(arc(300, 300, 120, 120, 1), { seed })), 'circle', `fermé ${seed}`);
    assert.equal(kindOf(hand(arc(300, 300, 90, 95, 0.92), { seed })), 'circle', `ouvert ${seed}`);
    assert.equal(kindOf(hand(arc(300, 300, 150, 140, 1.15), { seed })), 'circle', `dépasse ${seed}`);
  }
});

test('ellipse (droite et inclinée)', () => {
  for (const seed of seeds) {
    assert.equal(kindOf(hand(arc(300, 300, 200, 90, 1), { seed })), 'ellipse', `droite ${seed}`);
    assert.equal(kindOf(hand(arc(300, 300, 200, 90, 1, 0, 120, 0.6), { seed })), 'ellipse', `inclinée ${seed}`);
  }
});

test('carré et rectangle', () => {
  for (const seed of seeds) {
    const sq = [{ x: 100, y: 100 }, { x: 300, y: 104 }, { x: 302, y: 300 }, { x: 98, y: 296 }];
    assert.equal(kindOf(hand(polyline(sq), { seed })), 'square', `carré ${seed}`);
    const rc = [{ x: 100, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 260 }, { x: 100, y: 260 }];
    assert.equal(kindOf(hand(polyline(rc), { seed })), 'rect', `rect ${seed}`);
    assert.equal(kindOf(hand(rotateAll(polyline(rc), 0.5, { x: 280, y: 180 }), { seed })), 'rect', `rect incliné ${seed}`);
  }
});

test('le rectangle quasi droit est remis d’aplomb', () => {
  const r = recognize(polyline([{ x: 100, y: 100 }, { x: 400, y: 110 }, { x: 395, y: 260 }, { x: 95, y: 250 }]));
  assert.equal(r.kind, 'rect');
  assert.ok(Math.abs(r.pts[0].y - r.pts[1].y) < 1e-6);
});

test('triangle', () => {
  for (const seed of seeds) {
    const t = [{ x: 300, y: 100 }, { x: 480, y: 400 }, { x: 120, y: 400 }];
    assert.equal(kindOf(hand(polyline(t, 40), { seed })), 'triangle', `isocèle ${seed}`);
    const t2 = [{ x: 100, y: 100 }, { x: 400, y: 380 }, { x: 90, y: 360 }];
    assert.equal(kindOf(hand(polyline(t2, 40), { seed })), 'triangle', `rectangle ${seed}`);
  }
});

test('gribouillis et courbes ouvertes restent libres', () => {
  for (const seed of seeds) {
    const zig = polyline([{ x: 0, y: 0 }, { x: 60, y: 100 }, { x: 120, y: 0 }, { x: 180, y: 100 }, { x: 240, y: 0 }], 20, false);
    assert.equal(kindOf(hand(zig, { seed })), 'free', `zigzag ${seed}`);
    const star = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 60 : 150, a = (i / 10) * 2 * Math.PI;
      star.push({ x: 300 + r * Math.cos(a), y: 300 + r * Math.sin(a) });
    }
    assert.equal(kindOf(hand(polyline(star, 15), { seed })), 'free', `étoile ${seed}`);
  }
});

test('un arc ou une vague douce devient une courbe lisse', () => {
  for (const seed of seeds) {
    assert.equal(kindOf(hand(arc(300, 300, 120, 120, 0.5), { seed })), 'curve', `demi-cercle ${seed}`);
    assert.equal(kindOf(hand(arc(300, 300, 400, 400, 0.12, 4.2), { seed, wobble: 2 })), 'curve', `arc léger ${seed}`);
    const s = Array.from({ length: 80 }, (_, i) => ({ x: 100 + i * 5, y: 300 + Math.sin((i / 79) * 2 * Math.PI) * 60 }));
    assert.equal(kindOf(hand(s, { seed, wobble: 2 })), 'curve', `S ${seed}`);
  }
});

test('un simple clic donne un point', () => {
  assert.equal(kindOf([{ x: 5, y: 5 }, { x: 6, y: 5 }]), 'dot');
});
