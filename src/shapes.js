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
    if (dev / chord <= (chord < 140 ? 0.1 : 0.065)) return line(a, b);
  }

  // 2. Forme fermée ?
  const end = closureIndex(pts, diag);
  if (end < 0 || L < 1.6 * diag) return null;

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
