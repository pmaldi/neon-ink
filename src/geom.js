// Outils géométriques purs (aucune dépendance au DOM) — testables sous Node.

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function rotate(p, angle, c = { x: 0, y: 0 }) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** Points de la polyligne, avec le point de fermeture si `closed`. */
export const seqOf = (pts, closed) => (closed && pts.length > 1 ? [...pts, pts[0]] : pts);

/** Longueurs cumulées le long de seqOf(pts, closed). cum[0] = 0. */
export function cumulative(pts, closed = false) {
  const seq = seqOf(pts, closed);
  const cum = new Float64Array(seq.length);
  for (let i = 1; i < seq.length; i++) cum[i] = cum[i - 1] + dist(seq[i - 1], seq[i]);
  return cum;
}

export function pathLength(pts, closed = false) {
  const c = cumulative(pts, closed);
  return c.length ? c[c.length - 1] : 0;
}

/** Supprime les points trop proches les uns des autres. */
export function dedupe(pts, minDist = 1) {
  if (pts.length === 0) return [];
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) if (dist(out[out.length - 1], pts[i]) >= minDist) out.push(pts[i]);
  if (out.length === 1 && pts.length > 1) out.push(pts[pts.length - 1]);
  return out;
}

/** Ré-échantillonne en n points espacés régulièrement (abscisse curviligne). */
export function resample(pts, n, closed = false) {
  if (pts.length === 0) return [];
  if (pts.length === 1) return Array.from({ length: n }, () => ({ ...pts[0] }));
  const seq = seqOf(pts, closed);
  const cum = cumulative(pts, closed);
  const total = cum[cum.length - 1];
  const steps = closed ? n : n - 1;
  const out = [];
  let j = 1;
  for (let i = 0; i < n; i++) {
    const target = (total * i) / steps;
    while (j < seq.length - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1] || 1e-9;
    out.push(lerp(seq[j - 1], seq[j], clamp((target - cum[j - 1]) / seg, 0, 1)));
  }
  return out;
}

/** Portion de la polyligne entre les abscisses curvilignes `from` et `to`. */
export function subPath(pts, closed, cum, from, to) {
  const seq = seqOf(pts, closed);
  const total = cum[cum.length - 1];
  from = clamp(from, 0, total);
  to = clamp(to, 0, total);
  const out = [];
  if (seq.length === 1) return to >= from ? [seq[0]] : out;
  if (to <= from) return out;
  for (let i = 1; i < seq.length; i++) {
    const l0 = cum[i - 1], l1 = cum[i];
    if (l1 < from) continue;
    const seg = l1 - l0 || 1e-9;
    if (out.length === 0) out.push(lerp(seq[i - 1], seq[i], clamp((from - l0) / seg, 0, 1)));
    if (l1 <= to) out.push(seq[i]);
    else {
      out.push(lerp(seq[i - 1], seq[i], (to - l0) / seg));
      break;
    }
  }
  return out;
}

export function pointAt(pts, closed, cum, at) {
  const p = subPath(pts, closed, cum, Math.max(0, at - 0.01), at);
  return p.length ? p[p.length - 1] : pts[0];
}

export function bbox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Aire signée (formule du lacet). */
export function polygonArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return a / 2;
}

export function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

/** Enveloppe convexe (chaîne monotone d'Andrew). */
export function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Rectangle englobant d'aire minimale (calipers tournants, force brute sur les arêtes). */
export function minAreaRect(hull) {
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const r = rectAt(hull, angle);
    if (!best || r.w * r.h < best.w * best.h) best = r;
  }
  return best ?? rectAt(hull, 0);
}

/** Rectangle englobant orienté selon `angle`, ramené dans ]-45°, 45°]. */
export function rectAt(pts, angle) {
  while (angle > Math.PI / 4) angle -= Math.PI / 2;
  while (angle <= -Math.PI / 4) angle += Math.PI / 2;
  const local = pts.map((p) => rotate(p, -angle));
  const b = bbox(local);
  const c = rotate({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, angle);
  return { angle, cx: c.x, cy: c.y, w: b.w, h: b.h };
}

export function rectCorners(r) {
  const hw = r.w / 2, hh = r.h / 2;
  return [
    { x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh },
  ].map((p) => rotate({ x: p.x + r.cx, y: p.y + r.cy }, r.angle, { x: r.cx, y: r.cy }));
}

export function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(p, a);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

export function polyDist(p, pts, closed = false) {
  if (pts.length === 1) return dist(p, pts[0]);
  const seq = seqOf(pts, closed);
  let d = Infinity;
  for (let i = 1; i < seq.length; i++) d = Math.min(d, segDist(p, seq[i - 1], seq[i]));
  return d;
}

/** Simplification de Ramer–Douglas–Peucker. */
export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segDist(pts[i], pts[s], pts[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Lissage de Chaikin (extrémités conservées). */
export function chaikin(pts, iterations = 2) {
  let cur = pts;
  for (let k = 0; k < iterations && cur.length > 2; k++) {
    const next = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      next.push(lerp(cur[i], cur[i + 1], 0.25), lerp(cur[i], cur[i + 1], 0.75));
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}
