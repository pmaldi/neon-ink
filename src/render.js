// Primitives de dessin néon sur Canvas 2D.

export const PALETTE = {
  r: { name: 'Rouge', hex: '#ff2d55' },
  g: { name: 'Vert', hex: '#39ff6a' },
  b: { name: 'Bleu', hex: '#2f8bff' },
  y: { name: 'Jaune', hex: '#ffe14d' },
  o: { name: 'Orange', hex: '#ff8a1f' },
  p: { name: 'Rose', hex: '#ff3bd4' },
  v: { name: 'Violet', hex: '#a35bff' },
  c: { name: 'Cyan', hex: '#14f1ff' },
  w: { name: 'Blanc', hex: '#ffffff' },
  k: { name: 'Noir', hex: '#14141c', glow: 'rgba(255,255,255,0.85)', core: '#4a4a58' },
};

for (const c of Object.values(PALETTE)) {
  c.glow ??= c.hex;
  c.core ??= mix(c.hex, '#ffffff', 0.72);
}

function parseHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  const A = parseHex(a), B = parseHex(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function rgba(hex, alpha) {
  if (!hex.startsWith('#')) return hex;
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Construit un Path2D ; `smooth` relie les milieux par des quadratiques. */
export function buildPath(pts, closed, smooth) {
  const p = new Path2D();
  if (!pts.length) return p;
  p.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) {
    p.lineTo(pts[0].x + 0.01, pts[0].y);
    return p;
  }
  if (!smooth || pts.length < 3) {
    for (let i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      p.quadraticCurveTo(a.x, a.y, (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
    const last = pts[pts.length - 1];
    p.lineTo(last.x, last.y);
  }
  if (closed) p.closePath();
  return p;
}

/** Motif des traits en tirets, proportionnel à l'épaisseur d'origine du trait. */
export const dashPattern = (width) => [width * 2.4 + 6, width * 1.8 + 6];

/**
 * Applique les tirets : `dash` = { width, offset } (offset = distance du début du tracé
 * dessiné depuis le début du trait, pour que les tirets restent à la même place).
 */
function applyDash(ctx, dash) {
  if (!dash) return;
  ctx.setLineDash(dashPattern(dash.width));
  ctx.lineDashOffset = dash.offset ?? 0;
}

/**
 * Trait néon en trois passes : halo large, corps coloré, cœur presque blanc.
 * `boost` (0..1) surexpose le trait (flash d'apparition).
 */
export function neon(ctx, path, color, width, alpha = 1, boost = 0, dash = null) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  applyDash(ctx, dash);

  ctx.shadowColor = color.glow;
  ctx.shadowBlur = width * (3.2 + boost * 3);
  ctx.strokeStyle = rgba(color.glow, 0.28 + boost * 0.25);
  ctx.lineWidth = width * (2.3 + boost * 0.6);
  ctx.stroke(path);

  ctx.shadowBlur = width * (1.4 + boost);
  ctx.strokeStyle = color.hex;
  ctx.lineWidth = width;
  ctx.stroke(path);

  ctx.shadowBlur = 0;
  ctx.strokeStyle = boost > 0 ? mixCore(color, boost) : color.core;
  ctx.lineWidth = Math.max(1, width * (0.36 + boost * 0.25));
  ctx.stroke(path);
  ctx.restore();
}

function mixCore(color, boost) {
  return color.hex === PALETTE.k.hex ? color.core : mix(color.core, '#ffffff', Math.min(1, boost));
}

/** Surbrillance additive (comète, pointe chaude). */
export function glowLine(ctx, path, color, width, alpha, dash = null) {
  if (alpha <= 0) return;
  ctx.save();
  applyDash(ctx, dash);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color.glow;
  ctx.shadowBlur = width * 2.5;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = width;
  ctx.stroke(path);
  ctx.restore();
}

/** Halo rond (pointe du stylo, étincelles). */
export function glowDot(ctx, x, y, radius, color, alpha = 1) {
  if (alpha <= 0 || radius <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.25, rgba(color.glow, 0.85));
  g.addColorStop(1, rgba(color.glow, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ───────── Texte ─────────

export const TEXT_LINE_HEIGHT = 1.25;
export const textFont = (size) => `600 ${size}px "Segoe UI Variable Display", "Segoe UI", "Inter", system-ui, sans-serif`;

/** Lignes du texte et boîte englobante (o.box), mesurées avec la police réelle. */
export function layoutText(ctx, o) {
  ctx.save();
  ctx.font = textFont(o.size);
  const lines = o.text.split('\n');
  const widths = lines.map((l) => ctx.measureText(l).width);
  ctx.restore();
  o.box = { x: o.x, y: o.y, w: Math.max(0, ...widths), h: lines.length * o.size * TEXT_LINE_HEIGHT };
  return { lines, widths };
}

/** Texte néon : halo de la couleur puis lettres éclaircies. `boost` surexpose (apparition). */
export function neonText(ctx, o, { alpha = 1, boost = 0, rise = 0 } = {}) {
  if (alpha <= 0 || !o.text) return;
  const { lines } = layoutText(ctx, o);
  const lh = o.size * TEXT_LINE_HEIGHT;
  const black = o.color.hex === PALETTE.k.hex;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = textFont(o.size);
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    const y = o.y + i * lh + (lh - o.size) / 2 + rise;
    ctx.shadowColor = o.color.glow;
    ctx.shadowBlur = o.size * (0.5 + boost * 0.7);
    ctx.fillStyle = o.color.hex;
    ctx.fillText(line, o.x, y);
    ctx.shadowBlur = o.size * 0.12;
    ctx.fillStyle = black ? o.color.hex : mix(o.color.hex, '#ffffff', Math.min(1, 0.45 + boost * 0.45));
    ctx.fillText(line, o.x, y);
  });
  ctx.restore();
}

/** Pastille numérotée. `ring` (0..1) = portion du cercle tracée. */
export function badge(ctx, x, y, r, n, color, { scale = 1, alpha = 1, ring = 1 } = {}) {
  if (alpha <= 0 || scale <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.scale(scale, scale);

  ctx.shadowColor = color.glow;
  ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(8,10,20,0.86)';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();

  const ringPath = new Path2D();
  ringPath.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ring);
  neon(ctx, ringPath, color, 3);

  ctx.shadowColor = color.glow;
  ctx.shadowBlur = 10;
  ctx.fillStyle = color.hex === PALETTE.k.hex ? '#ffffff' : mix(color.hex, '#ffffff', 0.85);
  ctx.font = `700 ${n >= 10 ? r * 0.95 : r * 1.1}px "Segoe UI", "Inter", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 0, r * 0.06);
  ctx.restore();
}

/** Flèche néon courbe (Bézier quadratique a → b, point de contrôle c), tracée jusqu'à `progress`. */
export function arrow(ctx, a, c, b, color, width, progress = 1, alpha = 1) {
  if (progress <= 0) return;
  const at = (t) => {
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  };
  const n = 32;
  const path = new Path2D();
  path.moveTo(a.x, a.y);
  for (let i = 1; i <= n; i++) {
    const p = at((i / n) * progress);
    path.lineTo(p.x, p.y);
  }
  const end = at(progress);
  // Tangente en fin de tracé : B'(t) = 2(1-t)(c-a) + 2t(b-c)
  const tx = 2 * (1 - progress) * (c.x - a.x) + 2 * progress * (b.x - c.x);
  const ty = 2 * (1 - progress) * (c.y - a.y) + 2 * progress * (b.y - c.y);
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl, uy = ty / tl;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const head = Math.min(16, len * 0.35) * Math.min(1, progress * 1.4);
  if (head > 1) {
    const back = { x: end.x - ux * head, y: end.y - uy * head };
    const nx = -uy * head * 0.6, ny = ux * head * 0.6;
    path.moveTo(back.x + nx, back.y + ny);
    path.lineTo(end.x, end.y);
    path.lineTo(back.x - nx, back.y - ny);
  }
  neon(ctx, path, color, width, alpha);
}
