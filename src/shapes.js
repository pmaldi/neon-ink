// Reconnaissance de formes : trait droit, cercle / ellipse, carré / rectangle, triangle.
// Entrée : points bruts {x, y}. Sortie : { kind, pts, closed, smooth } ou null (garder le tracé libre).

import {
  dist, rotate, dedupe, resample, pathLength, bbox, polygonArea, convexHull,
  minAreaRect, rectAt, rectCorners, polyDist, segDist, rdp, chaikin, centroid,
} from './geom.js';

const DEG = Math.PI / 180;
const ACCEPT = 0.13; // erreur relative max pour accepter une forme fermée

export function recognize(raw) {
  const pts = dedupe(raw, 1.5);
  const L = pathLength(pts);
  if (pts.length < 2 || L < 8) return { kind: 'dot', pts: [pts[0] ?? raw[0]], closed: false, smooth: false };

  const bb = bbox(pts);
  const diag = Math.hypot(bb.w, bb.h);
  const a = pts[0], b = pts[pts.length - 1];

  // 1. Trait droit : aucun point ne s'écarte beaucoup de la corde, sans aller-retour.
  const chord = dist(a, b);
  if (chord > 0 && L / chord < 1.5) {
    const dev = pts.reduce((m, p) => Math.max(m, segDist(p, a, b)), 0);
    if (dev / chord <= (chord < 140 ? 0.1 : 0.045)) return line(a, b);
  }

  // 2. Forme fermée ? Sinon, une belle courbe si le geste s'y prête.
  const end = closureIndex(pts, diag);
  if (end < 0 || L < 1.6 * diag) return curve(pts, diag);

  const ring = resample(pts.slice(0, end + 1), 72, true);
  const hull = convexHull(ring);
  const area = Math.abs(polygonArea(ring));
  if (area < 1 || area / Math.abs(polygonArea(hull)) < 0.82) return null; // trop concave (étoile, 8…)

  const mr = minAreaRect(hull);
  if (mr.w < 6 || mr.h < 6) return null;
  const s = (mr.w + mr.h) / 4; // demi-taille moyenne, pour normaliser les erreurs

  const tri = maxAreaTriangle(hull);
  const errors = {
    ellipse: mean(ring, (p) => {
      const d = rotate(p, -mr.angle, { x: mr.cx, y: mr.cy });
      return Math.abs(Math.hypot((d.x - mr.cx) / (mr.w / 2), (d.y - mr.cy) / (mr.h / 2)) - 1);
    }),
    rect: mean(ring, (p) => {
      const d = rotate(p, -mr.angle, { x: mr.cx, y: mr.cy });
      return Math.max(0, Math.min(mr.w / 2 - Math.abs(d.x - mr.cx), mr.h / 2 - Math.abs(d.y - mr.cy))) / s;
    }),
    triangle: mean(ring, (p) => polyDist(p, tri, true)) / s,
  };

  const kind = Object.keys(errors).reduce((k, j) => (errors[j] < errors[k] ? j : k));
  if (errors[kind] > ACCEPT) return null;

  if (kind === 'ellipse') return ellipse(ring, hull, mr);
  if (kind === 'rect') return rectangle(hull, mr);
  return triangle(tri);
}

/** Tracé libre lissé (quand aucune forme n'est reconnue ou que la reconnaissance est désactivée). */
export function smoothFree(raw) {
  const pts = dedupe(raw, 1);
  if (pts.length < 3) return pts;
  return chaikin(rdp(pts, 0.6), 2);
}

/**
 * Courbe de Bézier cubique ajustée aux moindres carrés (extrémités fixes),
 * avec deux passes de reparamétrisation. Rend null si le tracé est trop tortueux.
 */
export function curve(pts, diag = Math.hypot(bbox(pts).w, bbox(pts).h)) {
  const Q = resample(pts, 48);
  const P0 = Q[0], P3 = Q[Q.length - 1];
  if (dist(P0, P3) < diag * 0.25) return null; // boucle ou crochet : pas une courbe simple
  let ts = Q.map((_, i) => i / (Q.length - 1));
  let P1, P2;
  for (let pass = 0; pass < 3; pass++) {
    [P1, P2] = solveBezier(Q, ts, P0, P3);
    if (!P1) return null;
    const samples = Array.from({ length: 101 }, (_, i) => bezier(P0, P1, P2, P3, i / 100));
    ts = Q.map((q) => {
      let best = 0;
      for (let i = 1; i < samples.length; i++) if (dist(samples[i], q) < dist(samples[best], q)) best = i;
      return best / 100;
    });
    ts[0] = 0;
    ts[ts.length - 1] = 1;
  }
  const out = Array.from({ length: 64 }, (_, i) => bezier(P0, P1, P2, P3, i / 63));
  const err = Q.reduce((m, q) => Math.max(m, polyDist(q, out)), 0);
  if (err > Math.max(0.06 * diag, 6)) return null;
  return { kind: 'curve', pts: out, closed: false, smooth: true };
}

function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

function solveBezier(Q, ts, P0, P3) {
  let a11 = 0, a12 = 0, a22 = 0, rx1 = 0, ry1 = 0, rx2 = 0, ry2 = 0;
  Q.forEach((q, i) => {
    const t = ts[i], u = 1 - t;
    const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    const rx = q.x - b0 * P0.x - b3 * P3.x, ry = q.y - b0 * P0.y - b3 * P3.y;
    a11 += b1 * b1; a12 += b1 * b2; a22 += b2 * b2;
    rx1 += b1 * rx; ry1 += b1 * ry; rx2 += b2 * rx; ry2 += b2 * ry;
  });
  const det = a11 * a22 - a12 * a12;
  if (Math.abs(det) < 1e-9) return [null, null];
  return [
    { x: (rx1 * a22 - rx2 * a12) / det, y: (ry1 * a22 - ry2 * a12) / det },
    { x: (a11 * rx2 - a12 * rx1) / det, y: (a11 * ry2 - a12 * ry1) / det },
  ];
}

/** Indice du point où la boucle se referme, ou -1 si le tracé reste ouvert. */
function closureIndex(pts, diag) {
  const tol = Math.max(0.2 * diag, 14);
  let best = -1, bestD = Infinity;
  for (let k = Math.floor(pts.length * 0.55); k < pts.length; k++) {
    const d = dist(pts[k], pts[0]);
    if (d <= bestD) { bestD = d; best = k; } // « <= » : à égalité on garde le plus tardif
  }
  return bestD <= tol ? best : -1;
}

const mean = (arr, f) => arr.reduce((acc, p) => acc + f(p), 0) / arr.length;

function snapAngle(angle, step, tol) {
  const k = Math.round(angle / step);
  return Math.abs(angle - k * step) <= tol ? k * step : angle;
}

function line(a, b) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const len = dist(a, b);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  let snapped = snapAngle(ang, 90 * DEG, 7 * DEG);
  if (snapped === ang) snapped = snapAngle(ang, 45 * DEG, 4 * DEG);
  const dx = (Math.cos(snapped) * len) / 2, dy = (Math.sin(snapped) * len) / 2;
  return {
    kind: 'line',
    pts: [{ x: mid.x - dx, y: mid.y - dy }, { x: mid.x + dx, y: mid.y + dy }],
    closed: false,
    smooth: false,
  };
}

function rectangle(hull, mr) {
  let r = mr;
  if (Math.abs(r.angle) <= 9 * DEG) r = rectAt(hull, 0);
  const ratio = Math.min(r.w, r.h) / Math.max(r.w, r.h);
  if (ratio > 0.87) {
    const side = (r.w + r.h) / 2;
    r = { ...r, w: side, h: side };
  }
  return { kind: ratio > 0.87 ? 'square' : 'rect', pts: rectCorners(r), closed: true, smooth: false };
}

function ellipse(ring, hull, mr) {
  let r = mr;
  if (Math.abs(r.angle) <= 10 * DEG) r = rectAt(hull, 0);
  let rx = r.w / 2, ry = r.h / 2;
  const isCircle = Math.min(rx, ry) / Math.max(rx, ry) > 0.85;
  const c = isCircle ? centroid(ring) : { x: r.cx, y: r.cy };
  if (isCircle) {
    const rad = ring.reduce((acc, p) => acc + dist(p, c), 0) / ring.length;
    rx = ry = rad;
  }
  const n = 96;
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 2 * Math.PI;
    pts.push(rotate({ x: c.x + rx * Math.cos(t), y: c.y + ry * Math.sin(t) }, isCircle ? 0 : r.angle, c));
  }
  return { kind: isCircle ? 'circle' : 'ellipse', pts, closed: true, smooth: true };
}

function triangle(tri) {
  // Si un côté est presque horizontal, on redresse le triangle autour de son centre.
  const c = centroid(tri);
  let correction = 0;
  for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i + 1) % 3];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const snapped = snapAngle(ang, 180 * DEG, 8 * DEG);
    if (snapped !== ang) { correction = snapped - ang; break; }
  }
  return { kind: 'triangle', pts: tri.map((p) => rotate(p, correction, c)), closed: true, smooth: false };
}

/** Plus grand triangle inscrit dans l'enveloppe convexe. */
function maxAreaTriangle(hull) {
  let best = [hull[0], hull[1 % hull.length], hull[2 % hull.length]], bestA = -1;
  for (let i = 0; i < hull.length; i++)
    for (let j = i + 1; j < hull.length; j++)
      for (let k = j + 1; k < hull.length; k++) {
        const a = Math.abs(polygonArea([hull[i], hull[j], hull[k]]));
        if (a > bestA) { bestA = a; best = [hull[i], hull[j], hull[k]]; }
      }
  return best;
}
