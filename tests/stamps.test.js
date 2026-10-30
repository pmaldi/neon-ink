import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAMPS, stamp, stampAt, STAMP_SIZE } from '../src/stamps.js';

const box = (pts) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);

test('chaque forme remplit le cadre du glisser, quel que soit le sens', () => {
  for (const { kind } of STAMPS.filter((s) => s.kind !== 'arrow')) {
    const b = box(stamp(kind, { x: 300, y: 200 }, { x: 100, y: 120 }).pts);
    close(b.x, 100); close(b.y, 120); close(b.w, 200); close(b.h, 80);
  }
});

test('Maj : carré, cercle et triangle équilatéral', () => {
  const sq = box(stamp('rect', { x: 0, y: 0 }, { x: 100, y: 40 }, { regular: true }).pts);
  close(sq.w, 100); close(sq.h, 100);
  const tri = stamp('triangle', { x: 0, y: 0 }, { x: 90, y: 10 }, { regular: true }).pts;
  const side = (i) => Math.hypot(tri[i].x - tri[(i + 1) % 3].x, tri[i].y - tri[(i + 1) % 3].y);
  close(side(0), side(1)); close(side(1), side(2));
});

test('étoile : dix sommets, pointe en haut', () => {
  const s = stamp('star', { x: 0, y: 0 }, { x: 100, y: 100 });
  assert.equal(s.pts.length, 10);
  assert.ok(s.closed);
  close(s.pts[0].x, 50); close(s.pts[0].y, 0);
});

test('flèche : pointe au point d’arrivée, alignée sur 45° avec Maj', () => {
  const a = stamp('arrow', { x: 0, y: 0 }, { x: 200, y: 0 });
  assert.equal(a.closed, false);
  assert.deepEqual(a.pts[1], { x: 200, y: 0 });
  const r = stamp('arrow', { x: 0, y: 0 }, { x: 100, y: 92 }, { regular: true });
  close(r.pts[1].x, r.pts[1].y);
});

test('simple clic : forme de taille par défaut centrée sur le point', () => {
  const b = box(stampAt('ellipse', { x: 500, y: 400 }).pts);
  close(b.x + b.w / 2, 500, 0.5); close(b.y + b.h / 2, 400, 0.5);
  close(b.w, STAMP_SIZE, 0.5);
});
