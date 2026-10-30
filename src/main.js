import { recognize, smoothFree } from './shapes.js';
import { STAMPS, stamp, stampAt } from './stamps.js';
import { BOARDS, paintBoard, snapToGrid } from './boards.js';
import { PALETTE, buildPath, neon, glowLine, glowDot, badge, arrow, neonText, neonLabel, layoutText, textFont, TEXT_LINE_HEIGHT } from './render.js';
import { createPluginHost } from './plugins.js';
import { checkUpdate, compareVersions } from './update.js';
import { buildKeymap, eventCombo, isMouseCombo, mouseCombo, parseCombo, prettyCombo } from './keys.js';
import { playEgg, eggOpen, closeEgg } from './egg.js';
import { dist, lerp, clamp, cumulative, subPath, pointAt, resample, polygonArea, polyDist } from './geom.js';

// Durées des animations (ms)
const T = { MORPH: 240, IN: 720, OUT: 560, HOT: 380, STEP_ARROW: 300, STEP_IN: 720, RENUMBER: 380 };
const STEP_R = 17;
const ARROW_BEND = 0.18; // courbure des flèches entre étapes (0 = droites)
const MAX_PARTICLES = 600;
const DRAG_START = 6; // px parcourus avant qu'un clic en mode étapes devienne un trait

const tauri = window.__TAURI__;
const invoke = (cmd, args) => tauri?.core.invoke(cmd, args).catch(console.error);

const $ = (id) => document.getElementById(id);
const staticCv = $('static'), fxCv = $('fx'), boardCv = $('board');
const sctx = staticCv.getContext('2d'), fctx = fxCv.getContext('2d');

const state = {
  drawMode: false,
  tool: 'pen', // pen | eraser | cutter | steps | text | stamp
  stamp: 0, // forme choisie dans STAMPS
  placing: null, // forme en cours de pose : { a, b, regular }
  wheel: null, // roue de sélection ouverte (voir openWheel)
  dashed: false, // traits en tirets
  editing: null, // texte en cours de frappe
  color: PALETTE.b,
  width: 5,
  shapes: true,
  objects: [],
  active: null,
  erasing: false,
  lastErase: null,
  pending: null, // clic en mode étapes : pastille, ou trait si la souris glisse
  board: null, // null (écran visible) ou une clé de BOARDS
  pointer: null,
  particles: [],
  seq: 1,
  nextStep: 1,
  staticDirty: true,
  hideRequested: false,
};
let nextId = 1;

// Fonctionnalités en plus, téléchargées à la demande (voir plugins.js et plugins/README.md).
const plugins = createPluginHost({
  state,
  palette: PALETTE,
  draw: { neon, glowLine, glowDot, badge, label: neonLabel, path: buildPath },
  setTool: (tool) => setTool(tool),
  add(o) {
    const obj = { id: nextId++, color: state.color, width: state.width, born: performance.now(), ...o };
    state.objects.push(obj);
    requestRender();
    return obj;
  },
  remove(o) {
    kill(o);
    requestRender();
  },
  objects: () => state.objects.filter((o) => !o.dying),
  snap: (p) => snapToGrid(state.board, p),
  wheel: (opts) => openWheel(opts),
  toast: (msg, ms) => toast(msg, ms),
  render: () => requestRender(),
  refreshHud: () => updateHud(),
});
let dpr = 1;
let raf = 0;
let lastFrame = performance.now();

const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const eraserRadius = (fine = false) => (fine ? 7 + state.width : 14 + state.width * 1.5);

// ───────────────────────── Canvas ─────────────────────────

function resize() {
  dpr = window.devicePixelRatio || 1;
  for (const cv of [staticCv, fxCv, boardCv]) {
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
  }
  paintBoard(boardCv.getContext('2d'), state.board, boardCv.width, boardCv.height, dpr);
  state.staticDirty = true;
  requestRender();
}

function clear(ctx) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function requestRender() {
  if (!raf) raf = requestAnimationFrame(frame);
}

// ───────────────────────── Objets ─────────────────────────

function geometry(o) {
  if (!o.path) {
    o.path = buildPath(o.pts, o.closed, o.smooth);
    o.cum = cumulative(o.pts, o.closed);
    o.len = o.cum[o.cum.length - 1];
  }
}

function isSettled(o, now) {
  if (o.dying) return false;
  if (o.kind === 'plugin') return !plugins.animated(o) && now - o.born >= T.IN;
  if (o.kind === 'step') return now - o.born >= T.STEP_IN && now - (o.renumbered ?? -1e9) >= T.RENUMBER;
  return now - o.born >= T.IN;
}

function prevStep(o) {
  for (let i = state.objects.indexOf(o) - 1; i >= 0; i--) {
    const q = state.objects[i];
    if (q.kind === 'step' && q.seq === o.seq && !q.dying) return q;
  }
  return null;
}

/** Tirets d'un trait, décalés de `offset` quand on n'en dessine qu'une partie. */
const dashOf = (o, offset = 0) => (o.dash ? { width: o.width, offset } : null);

function drawText(ctx, o, now) {
  if (o.dying) {
    // Le texte s'élève et s'éteint.
    const p = clamp((now - o.dying) / T.OUT, 0, 1);
    neonText(ctx, o, { alpha: 1 - p, boost: p * 0.6, rise: -p * 14 });
    return;
  }
  const age = now - o.born;
  neonText(ctx, o, { boost: age < T.IN ? (1 - age / T.IN) ** 2 : 0 });
}

function drawStroke(ctx, o, now) {
  geometry(o);
  const age = now - o.born;

  if (o.dying) {
    // Le trait se « dé-dessine » depuis son début en perdant son éclat.
    const p = clamp((now - o.dying) / T.OUT, 0, 1);
    const pts = subPath(o.pts, o.closed, o.cum, o.len * p * p, o.len);
    if (pts.length) neon(ctx, buildPath(pts, false, o.smooth), o.color, o.width * (1 + p * 0.4), 1 - p * 0.75, p * 0.5, dashOf(o, o.len * p * p));
    return;
  }

  if (o.morph && age < T.MORPH) {
    // Le tracé brut se transforme en forme parfaite.
    const t = easeOutCubic(age / T.MORPH);
    const pts = o.morph.from.map((a, i) => lerp(a, o.morph.to[i], t));
    neon(ctx, buildPath(pts, false, true), o.color, o.width, 1, 0.9, dashOf(o));
    return;
  }

  const flash = age < T.IN ? (1 - age / T.IN) ** 2 : 0;
  neon(ctx, o.path, o.color, o.width, 1, flash * 0.8, dashOf(o));

  // Une comète lumineuse parcourt le trait : il se « remplit » d'énergie.
  if (age < T.IN && o.len > 4) {
    const start = o.morph ? T.MORPH : 0;
    const q = clamp((age - start) / (T.IN - start), 0, 1);
    const tailLen = Math.max(40, o.len * 0.2);
    const head = easeInOut(q) * (o.len + tailLen);
    const seg = subPath(o.pts, o.closed, o.cum, head - tailLen, head);
    if (seg.length > 1) glowLine(ctx, buildPath(seg, false, o.smooth), o.color, o.width * 0.6, 0.9 * (1 - q * 0.5), dashOf(o, Math.max(0, head - tailLen)));
  }
}

function drawStepArrow(ctx, o, now) {
  const prev = prevStep(o);
  if (!prev) return;
  const d = dist(prev, o);
  if (d < STEP_R * 2 + 18) return;
  // Point de contrôle décalé perpendiculairement : la flèche décrit un arc.
  const c = { x: (prev.x + o.x) / 2 + ((prev.y - o.y) / d) * d * ARROW_BEND, y: (prev.y + o.y) / 2 + ((o.x - prev.x) / d) * d * ARROW_BEND };
  const away = (from, r) => {
    const l = dist(from, c) || 1;
    return { x: from.x + ((c.x - from.x) / l) * r, y: from.y + ((c.y - from.y) / l) * r };
  };
  const a = away(prev, STEP_R + 6), b = away(o, STEP_R + 8);
  const p = easeOutCubic(clamp((now - o.born) / T.STEP_ARROW, 0, 1));
  const alpha = o.dying ? 1 - clamp((now - o.dying) / T.OUT, 0, 1) : 1;
  arrow(ctx, a, c, b, o.color, 3, p, alpha);
}

function drawStepBadge(ctx, o, now) {
  const age = now - o.born - o.delay;
  if (age < 0) return;
  let scale = easeOutBack(clamp(age / 320, 0, 1));
  let alpha = 1;
  if (o.dying) {
    const p = clamp((now - o.dying) / T.OUT, 0, 1);
    scale = 1 + p * 0.6;
    alpha = 1 - p;
  } else if (o.renumbered && now - o.renumbered < T.RENUMBER) {
    scale *= 1 + 0.28 * Math.sin((Math.PI * (now - o.renumbered)) / T.RENUMBER);
  }
  badge(ctx, o.x, o.y, STEP_R, o.n, o.color, { scale, alpha, ring: easeOutCubic(clamp(age / 400, 0, 1)) });
}

/** Objet ajouté par un plugin : il le dessine lui-même, NeonInk gère l'apparition et l'effacement. */
function drawPlugin(ctx, o, now) {
  const life = o.dying ? 1 - clamp((now - o.dying) / T.OUT, 0, 1) : 1;
  if (life <= 0) return;
  ctx.save();
  plugins.draw(ctx, o, { now, age: now - o.born, intro: clamp((now - o.born) / T.IN, 0, 1), life });
  ctx.restore();
}

function drawObjects(ctx, list, now) {
  for (const o of list) if (o.kind === 'text') drawText(ctx, o, now);
    else if (o.kind !== 'step' && o.kind !== 'plugin') drawStroke(ctx, o, now);
  const extra = list.filter((o) => o.kind === 'plugin').sort((a, b) => plugins.layer(a) - plugins.layer(b));
  for (const o of extra) drawPlugin(ctx, o, now);
  for (const o of list) if (o.kind === 'step') drawStepArrow(ctx, o, now);
  for (const o of list) if (o.kind === 'step') drawStepBadge(ctx, o, now);
}

function redrawStatic(now) {
  clear(sctx);
  const list = [];
  for (const o of state.objects) {
    o.inStatic = isSettled(o, now);
    if (o.inStatic) list.push(o);
  }
  drawObjects(sctx, list, now);
  state.staticDirty = false;
}

function kill(o, delay = 0) {
  if (o.dying) return;
  o.dying = performance.now() + delay;
  if (o.kind === 'step') renumber(o.seq);
  // Ce qui dépend de l'objet disparaît avec lui (les liens d'un appareil réseau, par exemple).
  for (const q of state.objects) if (q.deps?.includes(o.id)) kill(q, delay);
}

/** Les étapes restantes d'une séquence sont renumérotées 1, 2, 3… sans trou. */
function renumber(seq) {
  const now = performance.now();
  let n = 0;
  for (const o of state.objects) {
    if (o.kind !== 'step' || o.seq !== seq || o.dying) continue;
    n++;
    if (o.n !== n) {
      o.n = n;
      o.renumbered = now;
    }
  }
  if (seq === state.seq) state.nextStep = n + 1;
  state.staticDirty = true;
}

// ───────────────────────── Particules ─────────────────────────

function spark(x, y, color, speed = 90, life = 600) {
  if (state.particles.length >= MAX_PARTICLES) return;
  const a = Math.random() * Math.PI * 2;
  const v = speed * (0.3 + Math.random() * 0.7);
  state.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, color, size: 2 + Math.random() * 3 });
}

function updateEffects(now, dt) {
  for (const o of state.objects) {
    if (o.kind === 'step' && !o.popped && now >= o.born + o.delay) {
      o.popped = true;
      for (let i = 0; i < 14; i++) spark(o.x, o.y, o.color, 140, 450);
    }
    if (!o.dying || now < o.dying) continue;
    if (!o.burst) {
      o.burst = true;
      if (o.kind === 'step') for (let i = 0; i < 22; i++) spark(o.x, o.y, o.color, 160);
      else if (o.kind === 'plugin') {
        const c = plugins.center(o);
        if (c) for (let i = 0; i < 18; i++) spark(c.x, c.y, o.color, 130);
      } else if (o.kind === 'text') {
        const b = o.box ?? { x: o.x, y: o.y, w: 0, h: 0 };
        for (let i = 0; i < 26; i++) spark(b.x + Math.random() * b.w, b.y + Math.random() * b.h, o.color, 90);
      } else {
        geometry(o);
        for (let i = 0; i < 16; i++) {
          const p = pointAt(o.pts, o.closed, o.cum, Math.random() * o.len);
          spark(p.x, p.y, o.color, 60);
        }
      }
    }
    if (o.kind !== 'step' && o.len > 0) {
      // Étincelles émises au point où le trait se consume.
      const p = clamp((now - o.dying) / T.OUT, 0, 1);
      const at = pointAt(o.pts, o.closed, o.cum, o.len * p * p);
      for (let i = 0; i < dt / 7; i++) spark(at.x, at.y, o.color, 110, 520);
    }
  }

  const k = dt / 1000;
  const drag = Math.pow(0.12, k);
  state.particles = state.particles.filter((p) => {
    p.life -= dt;
    p.x += p.vx * k;
    p.y += p.vy * k;
    p.vx *= drag;
    p.vy = p.vy * drag + 60 * k;
    return p.life > 0;
  });
}

function drawParticles(ctx) {
  for (const p of state.particles) {
    const t = p.life / p.max;
    glowDot(ctx, p.x, p.y, p.size * (1 + t * 1.5), p.color, t);
  }
}

// ───────────────────────── Boucle de rendu ─────────────────────────

function frame() {
  raf = 0;
  const now = performance.now();
  const dt = Math.min(50, now - lastFrame);
  lastFrame = now;

  let dirty = state.staticDirty;
  state.objects = state.objects.filter((o) => {
    const gone = o.dying && now - o.dying >= T.OUT;
    if (gone && o.inStatic) dirty = true;
    return !gone;
  });
  for (const o of state.objects) if (isSettled(o, now) !== !!o.inStatic) dirty = true;
  if (dirty) redrawStatic(now);

  updateEffects(now, dt);

  clear(fctx);
  drawObjects(fctx, state.objects.filter((o) => !o.inStatic), now);
  if (state.active) drawActive(now);
  if (state.placing) drawPlacing();
  pluginTool()?.preview?.(fctx, now);
  if (state.editing) drawEditing(now);
  drawParticles(fctx);
  if (state.wheel) drawWheel(now);
  drawCursor();

  const busy = state.active || state.placing || state.wheel || pluginTool()?.busy?.() || state.editing || state.particles.length || state.objects.some((o) => !o.inStatic);
  if (busy) requestRender();
  else maybeHide();
}

function drawActive(now) {
  const a = state.active;
  const pts = a.pts;
  neon(fctx, buildPath(pts, false, true), a.color, a.width, 1, 0.15, a.dash ? { width: a.width } : null);
  if (a.dash) {
    const tip = pts[pts.length - 1];
    glowDot(fctx, tip.x, tip.y, a.width * 3.4, a.color, 0.9);
    return;
  }

  // Partie fraîche du trait : chauffée à blanc, elle refroidit vers sa couleur.
  let i = pts.length - 1;
  while (i > 0 && now - pts[i - 1].t < T.HOT) i--;
  const buckets = 4;
  for (let b = 0; b < buckets; b++) {
    const lo = (T.HOT * b) / buckets, hi = (T.HOT * (b + 1)) / buckets;
    const seg = [];
    for (let k = i; k < pts.length; k++) {
      const age = now - pts[k].t;
      if (age >= lo - 30 && age < hi) seg.push(pts[k]);
    }
    if (seg.length > 1) glowLine(fctx, buildPath(seg, false, true), a.color, a.width * 0.55, 0.85 * (1 - b / buckets));
  }
  const tip = pts[pts.length - 1];
  const pulse = 0.85 + Math.sin(now / 70) * 0.15;
  glowDot(fctx, tip.x, tip.y, a.width * 3.4 * pulse, a.color, 0.9);
}

/** Aperçu de la forme pendant qu'on la pose. */
function drawPlacing() {
  const { a, b, regular } = state.placing;
  if (dist(a, b) < DRAG_START) return;
  const s = stamp(STAMPS[state.stamp].kind, a, b, { regular, width: state.width });
  neon(fctx, buildPath(s.pts, s.closed, s.smooth), state.color, state.width, 0.85, 0.2, state.dashed ? { width: state.width } : null);
}

function drawCursor() {
  const p = state.pointer;
  if (!state.drawMode || !p) return;
  if (state.wheel) return glowDot(fctx, p.x, p.y, 7, PALETTE.w, 0.9);
  const ctx = fctx;
  ctx.save();
  if (state.tool === 'cutter' || state.erasing === 'fine') {
    const r = eraserRadius(true);
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.moveTo(p.x - r * 0.45, p.y);
    ctx.lineTo(p.x + r * 0.45, p.y);
    ctx.stroke();
  } else if (state.tool === 'eraser' || state.erasing) {
    const r = eraserRadius();
    ctx.shadowColor = 'rgba(255,255,255,0.8)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = state.erasing ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fill();
  } else if (state.tool === 'text') {
    if (state.editing) return ctx.restore();
    const h = textSize() * 1.1;
    ctx.shadowColor = state.color.glow;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = state.color.hex === PALETTE.k.hex ? '#ffffff' : state.color.hex;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - h / 2);
    ctx.lineTo(p.x, p.y + h / 2);
    ctx.moveTo(p.x - 5, p.y - h / 2);
    ctx.lineTo(p.x + 5, p.y - h / 2);
    ctx.moveTo(p.x - 5, p.y + h / 2);
    ctx.lineTo(p.x + 5, p.y + h / 2);
    ctx.stroke();
  } else if (pluginTool()) {
    ctx.restore();
    pluginTool().cursor?.(ctx, p, performance.now());
    return;
  } else if (state.tool === 'stamp') {
    if (state.placing) return ctx.restore();
    // Croix de visée et petite vignette de la forme choisie.
    ctx.shadowColor = state.color.glow;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = state.color.hex === PALETTE.k.hex ? '#ffffff' : state.color.hex;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p.x - 9, p.y);
    ctx.lineTo(p.x + 9, p.y);
    ctx.moveTo(p.x, p.y - 9);
    ctx.lineTo(p.x, p.y + 9);
    ctx.stroke();
    ctx.restore();
    const s = stamp(STAMPS[state.stamp].kind, { x: p.x + 12, y: p.y + 12 }, { x: p.x + 34, y: p.y + 34 }, { regular: true, width: 2 });
    neon(ctx, buildPath(s.pts, s.closed, s.smooth), state.color, 2, 0.75);
    return;
  } else if (state.tool === 'steps' && !state.active) {
    ctx.restore();
    badge(ctx, p.x, p.y, STEP_R, state.nextStep, state.color, { alpha: 0.4, scale: 0.85 });
    return;
  } else if (!state.active) {
    ctx.restore();
    glowDot(ctx, p.x, p.y, state.width * 2.2, state.color, 0.8);
    ctx.save();
    ctx.fillStyle = state.color.hex;
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(1.5, state.width / 2), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ───────────────────────── Roue de sélection ─────────────────────────

const WHEEL_R = 104; // rayon du cercle des choix
const TAU = Math.PI * 2;

/**
 * Ouvre une roue autour du pointeur : `items` = [{ label, draw(ctx, x, y, taille, couleur, alpha, now) }].
 * Touche (ou bouton) maintenue : relâcher sur un choix le prend. Simple appui : on clique sur le choix.
 */
function openWheel({ items, selected = 0, onPick }) {
  const p = state.pointer ?? { x: innerWidth / 2, y: innerHeight / 2 };
  const m = WHEEL_R + 64;
  state.wheel = {
    x: clamp(p.x, m, innerWidth - m), y: clamp(p.y, m, innerHeight - m),
    items, selected, onPick, hover: -1, openedAt: performance.now(), trigger: held?.trigger ?? null,
  };
  requestRender();
}

function closeWheel() {
  state.wheel = null;
  requestRender();
}

/** Le choix visé : la direction du pointeur depuis le centre, hors de la zone morte centrale. */
function wheelHover(p) {
  const w = state.wheel;
  const d = dist(w, p);
  if (d < 30) return (w.hover = -1);
  const n = w.items.length;
  const a = (Math.atan2(p.y - w.y, p.x - w.x) + Math.PI / 2 + TAU + Math.PI / n) % TAU;
  w.hover = Math.floor(a / (TAU / n)) % n;
}

function pickWheel() {
  const w = state.wheel;
  closeWheel();
  if (w && w.hover >= 0) w.onPick(w.hover);
}

function drawWheel(now) {
  const w = state.wheel;
  const n = w.items.length;
  const step = TAU / n;
  const open = easeOutBack(clamp((now - w.openedAt) / 240, 0, 1));
  const color = state.color === PALETTE.k ? PALETTE.w : state.color;
  const ctx = fctx;
  ctx.save();
  ctx.translate(w.x, w.y);
  ctx.scale(open, open);
  ctx.rotate((1 - Math.min(1, open)) * -0.6); // la roue tourne en s'ouvrant

  ctx.fillStyle = 'rgba(8, 10, 20, 0.86)';
  ctx.beginPath();
  ctx.arc(0, 0, WHEEL_R + 48, 0, TAU);
  ctx.fill();
  const rim = new Path2D();
  rim.arc(0, 0, WHEEL_R + 48, 0, TAU);
  neon(ctx, rim, color, 2, 0.75);

  if (w.hover >= 0) {
    // Secteur visé : un quartier lumineux.
    const a0 = -Math.PI / 2 + (w.hover - 0.5) * step, a1 = a0 + step;
    const wedge = new Path2D();
    wedge.arc(0, 0, WHEEL_R + 44, a0 + 0.03, a1 - 0.03);
    wedge.arc(0, 0, 50, a1 - 0.05, a0 + 0.05, true);
    wedge.closePath();
    ctx.fillStyle = `${color.hex}2e`;
    ctx.fill(wedge);
    neon(ctx, wedge, color, 1.5, 0.9);
  }
  w.items.forEach((item, i) => {
    const a = -Math.PI / 2 + i * step;
    const x = Math.cos(a) * WHEEL_R, y = Math.sin(a) * WHEEL_R;
    const on = i === w.hover;
    if (i === w.selected) glowDot(ctx, x, y + 34, 4, color, 0.9);
    ctx.save();
    if (on) {
      ctx.translate(x, y);
      ctx.scale(1.18, 1.18);
      ctx.translate(-x, -y);
    }
    item.draw(ctx, x, y, 19, color, on || w.hover < 0 ? 1 : 0.55, now);
    ctx.restore();
  });
  const shown = w.items[w.hover >= 0 ? w.hover : w.selected];
  if (shown) neonLabel(ctx, shown.label, 0, 0, color, { size: 13 });
  ctx.restore();
}

function maybeHide() {
  if (state.drawMode || state.hideRequested || state.objects.length || state.board) return;
  state.hideRequested = true;
  clear(fctx);
  invoke('hide_overlay');
}

// ───────────────────────── Actions ─────────────────────────

function prepMorph(raw, target, closed) {
  const N = 96;
  const from = resample(raw, N, false);
  let to;
  if (closed) {
    to = resample(target, N - 1, true);
    if (Math.sign(polygonArea(from)) !== Math.sign(polygonArea(to))) to.reverse();
    let k = 0;
    for (let i = 1; i < to.length; i++) if (dist(to[i], from[0]) < dist(to[k], from[0])) k = i;
    to = to.slice(k).concat(to.slice(0, k));
    to.push({ ...to[0] });
  } else {
    to = resample(target, N, false);
    if (dist(from[0], to[N - 1]) < dist(from[0], to[0])) to.reverse();
  }
  return { from, to };
}

function finishStroke(freehand) {
  const a = state.active;
  state.active = null;
  if (!a || !a.pts.length) return;
  const raw = a.pts.map(({ x, y }) => ({ x, y }));
  let res = state.shapes && !freehand ? recognize(raw) : null;
  if (!res) {
    const pts = smoothFree(raw);
    res = pts.length > 1 ? { kind: 'free', pts, closed: false, smooth: true } : { kind: 'dot', pts: [raw[0]], closed: false, smooth: false };
  }
  const o = { id: nextId++, kind: res.kind, color: a.color, width: a.width, dash: a.dash, pts: res.pts, closed: res.closed, smooth: res.smooth, born: performance.now() };
  if (res.kind !== 'free' && res.kind !== 'dot') o.morph = prepMorph(raw, res.pts, res.closed);
  state.objects.push(o);
}

/** Pose la forme : glisser = cadre de la forme, simple clic = taille par défaut. */
function finishStamp() {
  const { a, b, regular } = state.placing;
  state.placing = null;
  const kind = STAMPS[state.stamp].kind;
  const opts = { regular, width: state.width };
  const res = dist(a, b) < DRAG_START ? stampAt(kind, a, opts) : stamp(kind, a, b, opts);
  state.objects.push({ id: nextId++, kind: res.kind, color: state.color, width: state.width, dash: state.dashed, pts: res.pts, closed: res.closed, smooth: res.smooth, born: performance.now() });
}

function addStep(p) {
  const o = { id: nextId++, kind: 'step', x: p.x, y: p.y, n: state.nextStep++, seq: state.seq, color: state.color, born: performance.now() };
  state.objects.push(o);
  o.delay = prevStep(o) ? T.STEP_ARROW * 0.7 : 0;
}

/** La gomme touche le texte si elle mord sur sa boîte englobante. */
function textHit(o, p, r) {
  if (!o.box) layoutText(fctx, o);
  const b = o.box;
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy) < r;
}

// ───────────────────────── Texte ─────────────────────────

const textInput = $('text-input');
const textSize = () => Math.round(12 + state.width * 3.2);

/** Ouvre une zone de texte à l'endroit `p` : la frappe s'y écrit en direct. */
function startText(p) {
  commitText();
  const size = textSize();
  state.editing = { kind: 'text', x: p.x, y: p.y - (size * TEXT_LINE_HEIGHT) / 2, size, color: state.color, text: '', caretAt: performance.now() };
  textInput.value = '';
  textInput.style.left = `${p.x}px`;
  textInput.style.top = `${p.y}px`;
  textInput.focus({ preventScroll: true });
  requestRender();
}

/** Termine la saisie : le texte rejoint le dessin (rien si la zone est vide). */
function commitText() {
  const t = state.editing;
  if (!t) return;
  state.editing = null;
  textInput.blur();
  if (t.text.trim()) {
    state.objects.push({ id: nextId++, kind: 'text', x: t.x, y: t.y, size: t.size, color: t.color, text: t.text.replace(/\s+$/, ''), born: performance.now() });
  }
  requestRender();
}

textInput.addEventListener('input', () => {
  if (!state.editing) return;
  state.editing.text = textInput.value;
  state.editing.caretAt = performance.now();
  requestRender();
});

function drawEditing(now) {
  const t = state.editing;
  neonText(fctx, t);
  // Curseur clignotant à la fin du texte.
  const { lines, widths } = layoutText(fctx, t);
  if (Math.floor((now - t.caretAt) / 530) % 2 === 0) {
    const lh = t.size * TEXT_LINE_HEIGHT;
    const x = t.x + widths[widths.length - 1] + 2;
    const y = t.y + (lines.length - 1) * lh + lh * 0.12;
    fctx.save();
    fctx.shadowColor = t.color.glow;
    fctx.shadowBlur = 10;
    fctx.fillStyle = t.color.hex === PALETTE.k.hex ? '#ffffff' : t.color.hex;
    fctx.fillRect(x, y, Math.max(2, t.size / 14), lh * 0.76);
    fctx.restore();
  }
}

function eraseAt(p) {
  const r = eraserRadius();
  for (const o of state.objects) {
    if (o.dying) continue;
    let hit;
    if (o.kind === 'step') hit = dist(o, p) < STEP_R + r;
    else if (o.kind === 'text') hit = textHit(o, p, r);
    else if (o.kind === 'plugin') hit = plugins.hit(o, p, r);
    else {
      geometry(o);
      hit = polyDist(p, o.pts, o.closed) < r + o.width / 2;
    }
    if (hit) kill(o);
  }
}

/** Gomme précise : retire seulement la portion du trait sous la gomme. */
function cutAt(p) {
  const r = eraserRadius(true);
  const now = performance.now();
  for (let i = 0; i < state.objects.length; i++) {
    const o = state.objects[i];
    if (o.dying) continue;
    if (o.kind === 'step') {
      if (dist(o, p) < STEP_R + r) kill(o);
      continue;
    }
    if (o.kind === 'text') {
      if (textHit(o, p, r)) kill(o);
      continue;
    }
    if (o.kind === 'plugin') {
      if (plugins.hit(o, p, r)) kill(o);
      continue;
    }
    geometry(o);
    const reach = r + o.width / 2;
    if (polyDist(p, o.pts, o.closed) >= reach) continue;
    if (o.kind === 'dot' || o.len < 2) {
      kill(o);
      continue;
    }
    const pieces = cutPolyline(resample(o.pts, Math.max(2, Math.ceil(o.len / 3) + 1), o.closed), o.closed, p, reach);
    if (!pieces) continue;
    for (let k = 0; k < 6; k++) spark(p.x + (Math.random() - 0.5) * r, p.y + (Math.random() - 0.5) * r, o.color, 80, 420);
    const pieceObjects = pieces.map((pts) => ({
      id: nextId++, kind: 'free', color: o.color, width: o.width, dash: o.dash, pts, closed: false, smooth: true, born: now - T.IN,
    }));
    state.objects.splice(i, 1, ...pieceObjects);
    i += pieceObjects.length - 1;
    state.staticDirty = true;
  }
}

/** Découpe une polyligne dense : renvoie les morceaux hors du disque (p, r), ou null si rien n'est touché. */
function cutPolyline(pts, closed, p, r) {
  let inside = pts.map((q) => dist(q, p) < r);
  const first = inside.indexOf(true);
  if (first < 0) return null;
  if (closed) {
    // On fait démarrer l'anneau dans la zone gommée pour le traiter comme un trait ouvert.
    pts = pts.slice(first).concat(pts.slice(0, first), [pts[first]]);
    inside = inside.slice(first).concat(inside.slice(0, first), [true]);
  }
  const pieces = [];
  let run = [];
  pts.forEach((q, i) => {
    if (!inside[i]) run.push(q);
    if (inside[i] || i === pts.length - 1) {
      if (run.length > 1 && dist(run[0], run[run.length - 1]) + run.length > 4) pieces.push(run);
      run = [];
    }
  });
  return pieces;
}

function eraseAlong(p) {
  const fine = state.erasing === 'fine';
  const from = state.lastErase ?? p;
  const steps = Math.max(1, Math.ceil(dist(from, p) / (eraserRadius(fine) / 2)));
  for (let i = 1; i <= steps; i++) (fine ? cutAt : eraseAt)(lerp(from, p, i / steps));
  state.lastErase = p;
}

function undo() {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (o.dying) continue;
    kill(o);
    break;
  }
  requestRender();
}

function clearAll() {
  const alive = state.objects.filter((o) => !o.dying).reverse();
  alive.forEach((o, i) => kill(o, Math.min(i * 30, 450)));
  state.seq++;
  state.nextStep = 1;
  if (alive.length) toast('Tout effacé');
  requestRender();
}

// ───────────────────────── Interface ─────────────────────────

const TOOL_LABEL = { pen: '✎ Stylo', eraser: '⌫ Gomme', cutter: '✂ Gomme précise', steps: '① Étapes', text: '⌶ Texte' };
const pluginTool = () => plugins.tools.get(state.tool);
function toolLabel() {
  if (state.tool === 'stamp') return `Formes : ${STAMPS[state.stamp].label}`;
  return pluginTool()?.label?.() ?? TOOL_LABEL[state.tool] ?? TOOL_LABEL.pen;
}
let toastTimer = 0;

function updateHud() {
  document.documentElement.style.setProperty('--c', state.color.glow === state.color.hex ? state.color.hex : '#d9d9e6');
  $('hud-color').textContent = state.color.name;
  $('hud-tool').textContent = toolLabel();
  $('hud-shapes').textContent = (state.shapes ? '◇ Formes auto' : '〰 Main levée') + (state.dashed ? ' · ┄ Tirets' : '');
  $('hud-width').textContent = `${state.width} px`;
}

function toast(msg, ms = 900) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Fond opaque (tableau, papier quadrillé) pour dessiner sur une page vierge ; même touche = retour à l'écran. */
function setBoard(board) {
  state.board = state.board === board ? null : board;
  document.body.classList.toggle('board', !!state.board);
  if (state.board) paintBoard(boardCv.getContext('2d'), state.board, boardCv.width, boardCv.height, dpr);
  // Une encre invisible sur ce fond passe à la couleur opposée.
  const light = BOARDS[state.board]?.light;
  if (light && state.color === PALETTE.w) state.color = PALETTE.k;
  if (state.board && !light && state.color === PALETTE.k) state.color = PALETTE.w;
  toast(state.board ? BOARDS[state.board].label : 'Écran visible');
  updateHud();
  requestRender();
}

function setTool(tool) {
  if (tool !== state.tool) pluginTool()?.cancel?.();
  state.tool = tool;
  toast(toolLabel());
  updateHud();
  requestRender();
}

/** `keepVisible` : les tracés restent affichés le temps de leur animation (Échap). */
function setDrawMode(on, keepVisible = false) {
  if (state.drawMode === on) return;
  state.drawMode = on;
  document.body.classList.toggle('drawing', on);
  if (!tauri) document.body.classList.toggle('concealed', !on && !keepVisible);
  if (on) {
    state.hideRequested = false;
    window.focus();
    updateHud();
    if (updatedTo) {
      toast(`NeonInk est à jour : version ${updatedTo}`, 3000);
      updatedTo = null;
    } else if (update && !update.announced) {
      update.announced = true;
      toast(`Mise à jour ${update.version} disponible (menu de l'icône NeonInk)`, 3500);
    }
  } else {
    if (state.active) finishStroke(false);
    commitText();
    state.pending = null;
    state.placing = null;
    state.wheel = null;
    state.erasing = false;
    state.pointer = null;
    toggleHelp(false);
    closeEgg();
  }
  requestRender();
}

/** Échap : on quitte le dessin en laissant les tracés se consumer à l'écran. */
function exitDrawMode() {
  if (tauri) invoke('set_draw_mode', { on: false, keepVisible: true });
  else setDrawMode(false, true);
}

// ───────────────────────── Capture d'écran ─────────────────────────

let capturing = false;

/** Pixels BGRA reçus de Tauri (largeur, hauteur, puis les pixels) → canvas. */
function screenCanvas(buffer) {
  const head = new DataView(buffer, 0, 8);
  const w = head.getUint32(0, true), h = head.getUint32(4, true);
  const px = new Uint8ClampedArray(buffer, 8, w * h * 4);
  for (let i = 0; i < px.length; i += 4) {
    const b = px[i];
    px[i] = px[i + 2];
    px[i + 2] = b;
    px[i + 3] = 255;
  }
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  cv.getContext('2d').putImageData(new ImageData(px, w, h), 0, 0);
  return cv;
}

/** Écran + dessins, enregistrés dans Images\NeonInk et copiés dans le presse-papiers. */
async function screenshot() {
  if (capturing) return;
  capturing = true;
  commitText();
  try {
    const cv = document.createElement('canvas');
    cv.width = staticCv.width;
    cv.height = staticCv.height;
    const ctx = cv.getContext('2d');
    if (state.board) {
      paintBoard(ctx, state.board, cv.width, cv.height, dpr);
    } else if (tauri) {
      const shot = await tauri.core.invoke('capture_screen');
      ctx.drawImage(screenCanvas(shot), 0, 0, cv.width, cv.height);
    } else {
      ctx.fillStyle = '#16161c';
      ctx.fillRect(0, 0, cv.width, cv.height);
    }
    // Les tracés dans leur état final, sans curseur ni animation en cours.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawObjects(ctx, state.objects.filter((o) => !o.dying), performance.now() + 1e6);
    const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
    const copied = await navigator.clipboard?.write([new ClipboardItem({ 'image/png': blob })]).then(() => true, () => false);
    $('flash').classList.remove('go');
    void $('flash').offsetWidth;
    $('flash').classList.add('go');
    if (tauri) {
      const path = await tauri.core.invoke('save_capture', new Uint8Array(await blob.arrayBuffer()));
      const name = path.split(/[\\/]/).pop();
      toast(`Capture enregistrée : Images › NeonInk › ${name}${copied ? ' (copiée aussi)' : ''}`, 3500);
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'NeonInk.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch (err) {
    console.error(err);
    toast(`Capture impossible : ${err}`, 4000);
  } finally {
    capturing = false;
  }
}

// ───────────────────────── Raccourcis ─────────────────────────

const COLOR_ACTIONS = {
  couleurRouge: 'r', couleurVert: 'g', couleurBleu: 'b', couleurJaune: 'y', couleurOrange: 'o',
  couleurRose: 'p', couleurViolet: 'v', couleurCyan: 'c', couleurBlanc: 'w', couleurNoir: 'k',
};

// Remplacés par la configuration (config.json via Tauri, valeurs d'origine dans le navigateur).
let keymap = buildKeymap({ basculerDessin: 'F10', effacerEtQuitter: 'Escape' });
let links = [];
let defaultShortcuts = null; // valeurs d'origine (bouton « Touches d'origine » dans le navigateur)

let lastConfig = null;

/** Raccourcis de la configuration, complétés par les touches par défaut des plugins encore libres. */
function withPluginKeys(shortcuts) {
  const taken = buildKeymap(shortcuts).map;
  const out = { ...shortcuts };
  for (const [action, def] of plugins.actions) {
    const combo = def.key && parseCombo(def.key);
    if (!(action in out) && combo && !taken.has(combo)) {
      out[action] = def.key;
      taken.set(combo, action);
    }
  }
  return out;
}

function applyConfig(config) {
  lastConfig = config;
  keymap = buildKeymap(withPluginKeys(config.raccourcis));
  links = config.liens ?? [];
  renderHelp();
  const errors = [...(config.erreurs ?? []), ...keymap.errors];
  if (errors.length) toast(`Raccourcis : ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1})` : ''}`, 5000);
}

function setColor(key) {
  state.color = PALETTE[key];
  if (state.tool === 'eraser' || state.tool === 'cutter') state.tool = 'pen';
  toast(state.color.name);
  updateHud();
  requestRender();
}

const ACTIONS = {
  effacerEtQuitter() {
    if (helpOpen()) toggleHelp(false);
    else {
      clearAll();
      if (state.board) setBoard(state.board);
      exitDrawMode();
    }
  },
  annuler: () => undo(),
  toutEffacer: () => clearAll(),
  epaisseurPlus: () => changeWidth(1),
  epaisseurMoins: () => changeWidth(-1),
  aide: () => toggleHelp(),
  stylo: () => setTool('pen'),
  gomme: () => setTool(state.tool === 'eraser' ? 'pen' : 'eraser'),
  gommePrecise: () => setTool(state.tool === 'cutter' ? 'pen' : 'cutter'),
  etapes: () => setTool(state.tool === 'steps' ? 'pen' : 'steps'),
  nouvelleSequence() {
    state.seq++;
    state.nextStep = 1;
    if (state.tool !== 'steps') state.tool = 'steps';
    toast('Nouvelle séquence');
    updateHud();
    requestRender();
  },
  formesAuto() {
    state.shapes = !state.shapes;
    toast(state.shapes ? 'Formes auto : activées' : 'Formes auto : désactivées');
    updateHud();
  },
  texte() {
    if (state.tool !== 'text') setTool('text');
    // Le curseur de texte apparaît tout de suite sous la souris.
    if (state.pointer) startText(state.pointer);
    else toast('Clique là où écrire');
  },
  tirets() {
    state.dashed = !state.dashed;
    if (!['pen', 'steps', 'stamp'].includes(state.tool)) state.tool = 'pen';
    toast(state.dashed ? '┄ Traits en tirets' : '━ Traits pleins');
    updateHud();
    requestRender();
  },
  formes() {
    // Première pression : l'outil Formes ; les suivantes passent à la forme suivante.
    if (state.tool === 'stamp') state.stamp = (state.stamp + 1) % STAMPS.length;
    setTool('stamp');
  },
  capture: () => screenshot(),
  dossierCaptures: () => (tauri ? invoke('open_captures') : toast('Dossier des captures : version Windows uniquement')),
  tableauNoir: () => setBoard('black'),
  tableauBlanc: () => setBoard('white'),
  petitsCarreaux: () => setBoard('small'),
  grandsCarreaux: () => setBoard('seyes'),
};
for (const [action, key] of Object.entries(COLOR_ACTIONS)) ACTIONS[action] = () => setColor(key);

// Petit secret : K, A, L tapés à la suite en mode dessin.
const SECRET = 'KAL';
let typed = '', typedAt = 0, colorsBefore = [];

function watchSecret(e) {
  if (e.key.length !== 1 || e.ctrlKey || e.altKey || e.metaKey) {
    typed = '';
    return false;
  }
  const now = performance.now();
  if (now - typedAt > 1500) typed = '';
  typedAt = now;
  colorsBefore = [...colorsBefore, state.color].slice(-SECRET.length);
  typed = (typed + e.key.toUpperCase()).slice(-SECRET.length);
  if (typed !== SECRET) return false;
  typed = '';
  // « K » a choisi le noir au passage : on rend la couleur d'avant.
  state.color = colorsBefore[0] ?? state.color;
  updateHud();
  playEgg({
    version: appVersion ?? 'dev',
    links,
    openLink: (url) => (tauri ? invoke('open_link', { url }) : window.open(url, '_blank')),
    firework,
  });
  return true;
}

/** Gerbe d'étincelles multicolores (utilisée par le petit secret). */
function firework(x, y) {
  const colors = Object.values(PALETTE).filter((c) => c !== PALETTE.k);
  for (let i = 0; i < 46; i++) spark(x, y, colors[i % colors.length], 260, 1100);
  requestRender();
}

/** Maj pendant la pose d'une forme : forme régulière (carré, cercle…). */
function setRegular(on) {
  if (!state.placing) return;
  state.placing.regular = on;
  requestRender();
}

function onKey(e) {
  if (capture) {
    e.preventDefault();
    // On attend la vraie touche : Maj, Ctrl ou Alt seuls ne suffisent pas.
    if (!['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead'].includes(e.key)) finishCaptureChecked(eventCombo(e));
    return;
  }
  if (document.activeElement === $('help-search')) {
    // La frappe va dans le champ de recherche ; Échap le vide, puis le quitte.
    if (e.key === 'Escape') {
      e.preventDefault();
      if (helpQuery) {
        e.target.value = helpQuery = '';
        renderHelp();
      } else e.target.blur();
    }
    return;
  }
  if (state.editing) {
    // La frappe va dans la zone de texte ; Échap termine.
    if (e.key === 'Escape') {
      e.preventDefault();
      commitText();
    }
    return;
  }
  const combo = eventCombo(e);
  const action = keymap.map.get(combo);
  // Hors Tauri (navigateur, pour le développement), le raccourci global bascule localement.
  if (!tauri && action === 'basculerDessin') {
    e.preventDefault();
    setDrawMode(!state.drawMode);
    return;
  }
  if (!state.drawMode) return;
  e.preventDefault();
  if (state.placing && e.key === 'Shift') return setRegular(true);
  if (state.wheel && e.key === 'Escape') return closeWheel();
  // Touche maintenue : la répétition ne rouvre pas la roue.
  if (e.repeat && state.wheel && held?.trigger === `key:${e.code}`) return;
  if (eggOpen()) {
    closeEgg();
    return;
  }
  if (watchSecret(e)) return;
  runAction(action, `key:${e.code}`);
}

// Touche ou bouton qui a déclenché la dernière action, tant qu'il reste enfoncé.
let held = null;

function runAction(action, trigger) {
  if (!action) return;
  held = { trigger };
  if (ACTIONS[action]) ACTIONS[action]();
  else plugins.actions.get(action)?.run();
}

/** Relâchement : une roue ouverte en maintenant la touche prend le choix visé. */
function release(trigger) {
  if (held?.trigger !== trigger) return;
  held = null;
  const w = state.wheel;
  if (w && w.trigger === trigger && performance.now() - w.openedAt > 250 && w.hover >= 0) pickWheel();
}

// Boutons de souris en raccourci : clic molette et boutons latéraux (4, 5).
window.addEventListener('mousedown', (e) => {
  const combo = mouseCombo(e);
  if (!combo) return;
  e.preventDefault(); // ni défilement automatique (molette) ni page précédente / suivante
  if (capture) return finishCaptureChecked(combo);
  if (!state.drawMode || helpOpen()) return;
  runAction(keymap.map.get(combo), `mouse:${e.button}`);
});
window.addEventListener('mouseup', (e) => {
  if (!mouseCombo(e)) return;
  e.preventDefault();
  release(`mouse:${e.button}`);
});
window.addEventListener('auxclick', (e) => e.preventDefault());
window.addEventListener('keyup', (e) => release(`key:${e.code}`));

// ───────────────────────── Aide ─────────────────────────

// Aide en onglets. Chaque ligne : [action, libellé, précision facultative].
const HELP_TABS = [
  { id: 'general', title: 'Général', groups: [
    ['Dessin', [
      ['basculerDessin', 'Dessin on / off', 'Masque les tracés, les réaffiche ensuite'],
      ['effacerEtQuitter', 'Tout effacer et quitter le dessin'],
      ['annuler', 'Annuler le dernier élément'],
      ['toutEffacer', 'Tout effacer'],
    ]],
    ['Trait et fenêtre', [
      ['epaisseurPlus', 'Trait plus épais', 'Ou la molette de la souris'],
      ['epaisseurMoins', 'Trait plus fin'],
      ['capture', 'Capture d’écran avec les dessins', 'Enregistrée dans Images › NeonInk et copiée'],
      ['dossierCaptures', 'Ouvrir le dossier des captures'],
      ['aide', 'Afficher / masquer cette aide'],
    ]],
  ] },
  { id: 'outils', title: 'Outils', groups: [
    ['Tracer', [
      ['stylo', 'Stylo'],
      ['formes', 'Formes toutes faites', 'Rappuyer : forme suivante · Maj : forme régulière'],
      ['texte', 'Texte au clavier', 'Échap ou un clic pour terminer'],
      ['tirets', 'Trait plein / en tirets'],
      ['formesAuto', 'Reconnaissance des formes on / off', 'Maj en relâchant : garder le tracé à main levée'],
    ]],
    ['Effacer et numéroter', [
      ['gomme', 'Gomme : trait entier', 'Ou le clic droit maintenu'],
      ['gommePrecise', 'Gomme précise : une partie du trait'],
      ['etapes', 'Étapes numérotées', 'Clic : pastille · glisser : trait'],
      ['nouvelleSequence', 'Nouvelle séquence d’étapes'],
    ]],
  ] },
  { id: 'couleurs', title: 'Couleurs et fonds', groups: [
    ['Couleurs', Object.entries(COLOR_ACTIONS).map(([action, key]) => [action, PALETTE[key].name, null, key === 'k' ? '#555566' : PALETTE[key].hex]), 'colors'],
    ['Fonds', [
      ['tableauNoir', 'Tableau noir'],
      ['tableauBlanc', 'Tableau blanc'],
      ['petitsCarreaux', 'Papier petits carreaux'],
      ['grandsCarreaux', 'Papier grands carreaux (Seyès)'],
      [null, 'La même touche ramène à l’écran'],
    ]],
  ] },
  { id: 'plugins', title: 'Plugins' },
];

const keysOf = (action) => (keymap.byAction[action] ?? []).map(prettyCombo).join(' · ') || '—';
/** Lignes des actions d'un plugin chargé. */
const pluginRows = (id) => [...plugins.actions].filter(([, d]) => d.plugin === id).map(([a, d]) => [a, d.label, d.hint]);
/** Toutes les lignes, pour la recherche et les messages : [titre de l'onglet, ligne]. */
function allRows() {
  const rows = [];
  for (const tab of HELP_TABS) for (const [, entries] of tab.groups ?? []) for (const e of entries) if (e[0]) rows.push([tab.title, e]);
  for (const [id, p] of plugins.loaded) for (const e of pluginRows(id)) rows.push([p.manifest.nom ?? id, e]);
  return rows;
}
function actionLabel(action) {
  return allRows().find(([, e]) => e[0] === action)?.[1][1] ?? action;
}

// Une action qui doit toujours garder au moins une touche.
const REQUIRED = new Set(['basculerDessin', 'aide']);

function keyButton(text, action, index) {
  const btn = document.createElement('button');
  btn.className = index < 0 ? 'key add' : 'key';
  btn.textContent = text;
  btn.dataset.action = action;
  btn.dataset.index = index;
  btn.title = index < 0 ? 'Ajouter une touche' : 'Clic : changer · clic droit : retirer';
  return btn;
}

let helpTab = 'general', helpQuery = '';
try {
  helpTab = localStorage.getItem('helpTab') || helpTab;
} catch {}
const fold = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Liste « touches → action ». `rowIndex` donne le décalage de l'apparition en cascade. */
function shortcutList(entries, cls, rowIndex) {
  const dl = el('dl', cls);
  for (const [action, label, hint, swatch] of entries) {
    const dt = el('dt');
    const dd = el('dd', null, label);
    if (action) {
      (keymap.byAction[action] ?? []).forEach((combo, i) => dt.append(keyButton(prettyCombo(combo), action, i)));
      dt.append(keyButton('+', action, -1));
    }
    if (hint) dd.append(el('span', 'hint', hint));
    if (swatch) dd.style.setProperty('--k', swatch);
    for (const e of [dt, dd]) e.style.setProperty('--i', rowIndex.n);
    rowIndex.n++;
    dl.append(dt, dd);
  }
  return dl;
}

function renderHelp() {
  const tabs = $('help-tabs');
  tabs.replaceChildren();
  for (const tab of HELP_TABS) {
    const b = el('button', null, tab.title);
    b.type = 'button';
    b.dataset.tab = tab.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(!helpQuery && tab.id === helpTab));
    if (tab.id === 'plugins' && plugins.loaded.size) b.append(el('span', 'count', plugins.loaded.size));
    tabs.append(b);
  }

  const body = $('help-body');
  body.replaceChildren();
  const rowIndex = { n: 0 };
  const group = (title, entries, cls) => {
    const section = el('section');
    section.append(el('h2', null, title), shortcutList(entries, cls, rowIndex));
    body.append(section);
  };

  if (helpQuery) {
    // Recherche dans tous les onglets et tous les plugins, par libellé ou par touche.
    const q = fold(helpQuery);
    const found = new Map();
    for (const [where, e] of allRows()) {
      const text = fold([e[1], e[2] ?? '', keysOf(e[0])].join(' '));
      if (text.includes(q)) found.set(where, [...(found.get(where) ?? []), e]);
    }
    for (const [where, entries] of found) group(where, entries);
    if (!found.size) body.append(el('p', 'help-empty', `Aucune action ne correspond à « ${helpQuery} »`));
  } else if (helpTab === 'plugins') {
    renderPluginCards(body, rowIndex);
  } else {
    const tab = HELP_TABS.find((t) => t.id === helpTab) ?? HELP_TABS[0];
    for (const [title, entries, cls] of tab.groups) group(title, entries, cls);
  }
  $('hud-hint').textContent = `${keysOf('aide').split(' · ')[0]} aide · ${keysOf('basculerDessin')} masquer · ${keysOf('effacerEtQuitter')} effacer`;
}

function showHelpTab(id) {
  helpTab = id;
  helpQuery = '';
  $('help-search').value = '';
  try {
    localStorage.setItem('helpTab', id);
  } catch {}
  renderHelp();
}

$('help-search').addEventListener('input', (e) => {
  helpQuery = e.target.value.trim();
  renderHelp();
});

// ───────────────────────── Modifier les touches depuis l'aide ─────────────────────────

let capture = null; // { action, index, button }
let savedAt = 0;

function startCapture(button) {
  cancelCapture();
  capture = { action: button.dataset.action, index: Number(button.dataset.index), button };
  button.classList.add('capturing');
  button.textContent = '…';
  $('help-status').textContent = `Nouvelle touche pour « ${actionLabel(capture.action)} » : appuie sur une touche ou un bouton de souris (molette, 4, 5) · clic ailleurs pour annuler`;
  // Le raccourci global est libéré pendant la saisie, sinon Windows garderait F10 pour lui.
  if (tauri) invoke('capture_shortcut', { on: true });
}

function cancelCapture() {
  if (!capture) return;
  capture = null;
  if (tauri) invoke('capture_shortcut', { on: false });
  $('help-status').textContent = '';
  renderHelp();
}

/** Copie modifiable des raccourcis en vigueur (formes canoniques). */
const currentShortcuts = () => Object.fromEntries(Object.entries(keymap.byAction).map(([a, list]) => [a, [...list]]));

/** Le raccourci global (hors du dessin) passe par Windows : il doit rester une touche du clavier. */
function finishCaptureChecked(combo) {
  if (capture.action === 'basculerDessin' && isMouseCombo(combo)) {
    $('help-status').textContent = 'Ce raccourci marche hors du dessin : choisis une touche du clavier';
    return;
  }
  finishCapture(combo);
}

function finishCapture(combo) {
  const { action, index } = capture;
  capture = null;
  const shortcuts = currentShortcuts();
  // La touche quitte l'action qui l'utilisait déjà.
  let movedFrom = null;
  for (const [other, list] of Object.entries(shortcuts)) {
    if (other === action) continue;
    const i = list.indexOf(combo);
    if (i < 0) continue;
    if (REQUIRED.has(other) && list.length === 1) {
      toast(`${prettyCombo(combo)} est la seule touche de « ${actionLabel(other)} »`, 2600);
      if (tauri) invoke('capture_shortcut', { on: false });
      $('help-status').textContent = '';
      renderHelp();
      return;
    }
    list.splice(i, 1);
    movedFrom = other;
  }
  const list = shortcuts[action] ?? (shortcuts[action] = []);
  if (index >= 0) list[index] = combo;
  else if (!list.includes(combo)) list.push(combo);
  shortcuts[action] = [...new Set(list)];
  saveShortcuts(shortcuts, movedFrom
    ? `${prettyCombo(combo)} : « ${actionLabel(action)} » (retirée de « ${actionLabel(movedFrom)} »)`
    : `${prettyCombo(combo)} : « ${actionLabel(action)} »`);
}

function removeKey(button) {
  const action = button.dataset.action;
  const shortcuts = currentShortcuts();
  const list = shortcuts[action] ?? [];
  if (REQUIRED.has(action) && list.length <= 1) {
    toast(`« ${actionLabel(action)} » doit garder une touche`, 2200);
    return;
  }
  const [removed] = list.splice(Number(button.dataset.index), 1);
  saveShortcuts(shortcuts, `${prettyCombo(removed)} retirée de « ${actionLabel(action)} »`);
}

/** Une liste d'une seule touche est enregistrée comme une simple chaîne, plus lisible dans config.json. */
const compact = (shortcuts) => Object.fromEntries(Object.entries(shortcuts).map(([a, l]) => [a, l.length === 1 ? l[0] : l]));

async function saveShortcuts(shortcuts, message, command = 'save_shortcuts') {
  $('help-status').textContent = '';
  if (!tauri) {
    applyConfig({ raccourcis: command === 'reset_shortcuts' ? defaultShortcuts : compact(shortcuts), liens: links });
    toast(message, 2200);
    return;
  }
  try {
    savedAt = performance.now();
    const config = await tauri.core.invoke(command, command === 'reset_shortcuts' ? {} : { raccourcis: compact(shortcuts) });
    applyConfig(config);
    toast(message, 2200);
  } catch (err) {
    toast(`Touche refusée : ${err}`, 3500);
    renderHelp();
  }
}

$('help').addEventListener('click', (e) => {
  const tab = e.target.closest('button[data-tab]');
  if (tab) {
    cancelCapture();
    showHelpTab(tab.dataset.tab);
    return;
  }
  const op = e.target.closest('button[data-op]');
  if (op) {
    pluginOp(op.dataset.op, op.dataset.plugin);
    return;
  }
  const key = e.target.closest('button.key');
  if (key) {
    startCapture(key);
    return;
  }
  if (e.target.closest('#help-reset')) {
    cancelCapture();
    saveShortcuts(null, 'Touches d’origine rétablies', 'reset_shortcuts');
    return;
  }
  if (e.target.closest('#help-file')) {
    cancelCapture();
    if (tauri) invoke('open_config_file');
    return;
  }
  if (capture) cancelCapture();
  else if (!e.target.closest('.help-panel')) toggleHelp(false);
});

$('help').addEventListener('contextmenu', (e) => {
  const key = e.target.closest('button.key:not(.add)');
  if (!key || capture) return;
  removeKey(key);
});

const helpOpen = () => $('help').classList.contains('show');

function toggleHelp(force) {
  const help = $('help');
  const open = force ?? !helpOpen();
  if (!open) cancelCapture();
  else if (!helpOpen() && !pluginState.busy) refreshCatalog();
  help.classList.toggle('show', open);
}

function changeWidth(delta) {
  state.width = clamp(state.width + delta, 2, 24);
  if (state.editing) state.editing.size = textSize();
  toast(state.editing || state.tool === 'text' ? `Texte ${textSize()} px` : `Épaisseur ${state.width} px`);
  updateHud();
  requestRender();
}

// ───────────────────────── Plugins ─────────────────────────

const pluginState = { catalog: null, installed: new Map(), busy: null, message: '' };

async function activatePlugin(code, entry) {
  const manifest = await plugins.load(code, entry);
  pluginState.installed.set(manifest.id, manifest);
  if (lastConfig) applyConfig(lastConfig);
  else renderHelp();
  return manifest;
}

/** Désactive un plugin sur-le-champ : ses objets s'effacent, ses touches disparaissent. */
function deactivatePlugin(id) {
  for (const o of state.objects) if (o.plugin === id) kill(o);
  if (pluginTool()?.plugin === id) setTool('pen');
  plugins.unload(id);
  pluginState.installed.delete(id);
  if (lastConfig) applyConfig(lastConfig);
  requestRender();
}

/** Au démarrage : plugins installés (Tauri) ou indiqués dans l'adresse (?plugins=reseau, navigateur). */
async function startPlugins() {
  const list = tauri
    ? (await invoke('plugin_list')) ?? []
    : await Promise.all((new URLSearchParams(location.search).get('plugins')?.split(',') ?? []).map(async (id) => ({
      manifest: {}, code: await (await fetch(`../plugins/${id}/plugin.js`)).text(),
    })));
  for (const { manifest, code } of list) {
    try {
      await activatePlugin(code, manifest);
    } catch (err) {
      console.error(err);
      toast(`Plugin ${manifest.nom ?? manifest.id ?? ''} non chargé : ${err.message ?? err}`, 4000);
    }
  }
  renderPluginPanel();
}

/** Les plugins installés se mettent à jour d'eux-mêmes (actifs au prochain démarrage). */
async function updatePlugins() {
  if (!tauri || !pluginState.installed.size) return;
  const catalog = await tauri.core.invoke('plugin_catalog').catch(() => null);
  if (!catalog) return;
  pluginState.catalog = catalog;
  for (const entry of catalog) {
    const mine = pluginState.installed.get(entry.id);
    if (mine && compareVersions(entry.version, mine.version ?? '0') > 0) await invoke('plugin_install', { id: entry.id });
  }
}

const sizeLabel = (n) => (n ? ` · ${Math.max(1, Math.round(n / 1024))} Ko` : '');

/** Onglet Plugins : une carte par plugin (catalogue et installés), avec ses touches. */
function renderPluginCards(body, rowIndex) {
  const cards = new Map();
  for (const e of pluginState.catalog ?? []) cards.set(e.id, { entry: e });
  for (const [id, m] of pluginState.installed) cards.set(id, { entry: cards.get(id)?.entry ?? m, mine: m });
  for (const { entry, mine } of cards.values()) {
    const card = el('article', mine ? 'plugin-card installed' : 'plugin-card');
    const head = el('header');
    const newer = mine && entry.version && compareVersions(entry.version, mine.version ?? '0') > 0;
    head.append(
      el('b', null, entry.nom ?? entry.id),
      el('span', 'muted', `v${(mine ?? entry).version ?? '?'}${sizeLabel(entry.taille)}${mine ? ' · installé' : ''}${newer ? ` · v${entry.version} au prochain démarrage` : ''}`),
    );
    if (tauri) {
      const button = el('button', null, pluginState.busy === entry.id ? '…' : mine ? 'Retirer' : 'Installer');
      button.type = 'button';
      button.dataset.plugin = entry.id;
      button.dataset.op = mine ? 'remove' : 'install';
      button.disabled = !!pluginState.busy;
      head.append(button);
    }
    card.append(head, el('p', null, entry.description ?? ''));
    const rows = mine ? pluginRows(entry.id) : [];
    if (rows.length) card.append(shortcutList(rows, null, rowIndex));
    body.append(card);
  }
  const note = !tauri
    ? 'Navigateur : ajoute ?plugins=reseau à l’adresse pour essayer un plugin du dossier plugins/.'
    : pluginState.message || (pluginState.catalog ? '' : 'Recherche des plugins disponibles…');
  if (note) body.append(el('p', 'plugin-note', note));
  if (!cards.size && !note) body.append(el('p', 'help-empty', 'Aucun plugin pour le moment.'));
}

/** L'état des plugins a changé : l'aide est redessinée si elle les montre. */
const renderPluginPanel = () => renderHelp();

let catalogAt = 0;

/** Catalogue des plugins, consulté à l'ouverture de l'aide (au plus toutes les 10 minutes). */
async function refreshCatalog() {
  renderPluginPanel();
  if (!tauri || Date.now() - catalogAt < 600000) return;
  catalogAt = Date.now();
  try {
    pluginState.catalog = await tauri.core.invoke('plugin_catalog');
    pluginState.message = pluginState.catalog.length ? '' : 'Aucun plugin publié pour le moment.';
  } catch (err) {
    catalogAt = 0;
    pluginState.message = `Catalogue indisponible : ${err}`;
  }
  renderPluginPanel();
}

async function pluginOp(op, id) {
  pluginState.busy = id;
  renderPluginPanel();
  try {
    if (op === 'install') {
      const { manifest, code } = await tauri.core.invoke('plugin_install', { id });
      const m = await activatePlugin(code, manifest);
      const keys = [...plugins.actions.keys()].filter((a) => a.startsWith(`${m.id}.`)).map(keysOf).filter((k) => k !== '—');
      toast(`Plugin ${m.nom} installé${keys.length ? ` : touche ${keys[0]}` : ''}`, 3000);
    } else {
      await tauri.core.invoke('plugin_remove', { id });
      const nom = pluginState.installed.get(id)?.nom ?? id;
      deactivatePlugin(id);
      toast(`Plugin ${nom} retiré`, 2200);
    }
  } catch (err) {
    toast(`Plugin : ${err.message ?? err}`, 4000);
  } finally {
    pluginState.busy = null;
    renderPluginPanel();
  }
}

// ───────────────────────── Souris / stylet ─────────────────────────

const pos = (e) => ({ x: e.clientX, y: e.clientY, t: performance.now() });

fxCv.addEventListener('pointerdown', (e) => {
  if (!state.drawMode) return;
  if (e.button === 1 || e.button === 3 || e.button === 4) return; // boutons de raccourci (voir mousedown)
  const p = pos(e);
  state.pointer = p;
  if (state.wheel) {
    // Roue ouverte : un clic choisit, un clic au centre ou au dehors referme.
    wheelHover(p);
    if (e.button === 0 && dist(state.wheel, p) < WHEEL_R + 60) pickWheel();
    else closeWheel();
    return;
  }
  fxCv.setPointerCapture(e.pointerId);
  // Un clic termine le texte en cours ; avec l'outil texte, il en ouvre un nouveau ici.
  // preventDefault garde le focus sur la zone de saisie.
  const wasEditing = !!state.editing;
  commitText();
  if (e.button === 0 && state.tool === 'text') {
    e.preventDefault();
    startText(p);
    return;
  }
  if (wasEditing) return requestRender();
  const penEraser = e.pointerType === 'pen' && (e.buttons & 32);
  if (e.button === 0 && state.tool === 'cutter') {
    state.erasing = 'fine';
    state.lastErase = null;
    eraseAlong(p);
  } else if (e.button === 2 || penEraser || (e.button === 0 && state.tool === 'eraser')) {
    state.erasing = 'whole';
    state.lastErase = null;
    eraseAlong(p);
  } else if (e.button === 0 && pluginTool()) {
    state.pluginDown = true;
    pluginTool().down?.(p, e);
  } else if (e.button === 0 && state.tool === 'stamp') {
    state.placing = { a: snapToGrid(state.board, p), b: p, regular: e.shiftKey };
  } else if (e.button === 0 && state.tool === 'steps') {
    state.pending = p;
  } else if (e.button === 0) {
    state.active = { pts: [p], color: state.color, width: state.width, dash: state.dashed };
  }
  requestRender();
});

fxCv.addEventListener('pointermove', (e) => {
  if (!state.drawMode) return;
  if (state.wheel) {
    state.pointer = pos(e);
    wheelHover(state.pointer);
    requestRender();
    return;
  }
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const ev of events.length ? events : [e]) {
    const p = pos(ev);
    if (state.pending && dist(state.pending, p) >= DRAG_START) {
      // En mode étapes, glisser dessine un trait (avec reconnaissance de formes).
      state.active = { pts: [state.pending, p], color: state.color, width: state.width, dash: state.dashed };
      state.pending = null;
    } else if (state.active) {
      const pts = state.active.pts;
      if (dist(pts[pts.length - 1], p) >= 1.5) pts.push(p);
    } else if (state.erasing) eraseAlong(p);
  }
  state.pointer = pos(e);
  pluginTool()?.move?.(state.pointer, e);
  if (state.placing) Object.assign(state.placing, { b: snapToGrid(state.board, state.pointer), regular: e.shiftKey });
  requestRender();
});

function endPointer(e) {
  if (state.pending && e.type === 'pointerup') addStep(state.pending);
  state.pending = null;
  if (state.placing && e.type === 'pointerup') finishStamp();
  if (state.pluginDown) {
    state.pluginDown = false;
    if (e.type === 'pointerup') pluginTool()?.up?.(pos(e), e);
    else pluginTool()?.cancel?.();
  }
  state.placing = null;
  if (state.active) finishStroke(e.shiftKey);
  state.erasing = false;
  requestRender();
}
fxCv.addEventListener('pointerup', endPointer);
fxCv.addEventListener('pointercancel', endPointer);
fxCv.addEventListener('pointerleave', () => {
  if (!state.active && !state.erasing) {
    state.pointer = null;
    requestRender();
  }
});

window.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (state.drawMode) changeWidth(e.deltaY < 0 ? 1 : -1);
}, { passive: false });
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', onKey);
window.addEventListener('keyup', (e) => e.key === 'Shift' && setRegular(false));
window.addEventListener('resize', resize);

// ───────────────────────── Démarrage ─────────────────────────

// ───────────────────────── Mises à jour ─────────────────────────

let update = null;
let updatedTo = null;
let appVersion = null;
let updatesEnabled = true;

async function lookForUpdate(manual) {
  if (!updatesEnabled) return;
  try {
    update = await checkUpdate(appVersion);
    if (update) invoke('update_available', { update });
    else if (manual) invoke('update_status', { text: 'NeonInk est à jour' });
  } catch (err) {
    console.warn('Recherche de mise à jour impossible', err);
    if (manual) invoke('update_status', { text: 'Mise à jour : pas de connexion' });
  }
}

if (tauri) {
  tauri.event.listen('draw-mode', (e) => setDrawMode(!!e.payload.on, e.payload.keepVisible));
  tauri.event.listen('clear-all', () => clearAll());
  tauri.event.listen('check-update', () => lookForUpdate(true));
  tauri.event.listen('config-changed', (e) => {
    applyConfig(e.payload);
    // Le fichier vient d'être écrit par l'aide elle-même : inutile de l'annoncer.
    if (state.drawMode && performance.now() - savedAt > 4000) toast('Raccourcis rechargés');
  });
  tauri.event.listen('open-help', () => toggleHelp(true));
  invoke('get_config').then((config) => config && applyConfig(config));
  (async () => {
    appVersion = await tauri.app.getVersion();
    updatesEnabled = (await invoke('update_config'))?.enabled ?? true;
    // Après une mise à jour, on l'annonce au prochain passage en dessin.
    try {
      const previous = localStorage.getItem('version');
      if (previous && previous !== appVersion) updatedTo = appVersion;
      localStorage.setItem('version', appVersion);
    } catch {}
    // Recherche peu après le démarrage, puis toutes les 2 heures.
    setTimeout(() => lookForUpdate(false), 15000);
    setTimeout(() => updatePlugins(), 25000);
    setInterval(() => lookForUpdate(false), 2 * 3600 * 1000);
  })();
} else {
  document.body.classList.add('browser');
  fetch('config.default.json')
    .then((r) => r.json())
    .then((config) => {
      defaultShortcuts = config.raccourcis;
      applyConfig(config);
    })
    .catch(console.error);
}

resize();
renderHelp();
updateHud();
startPlugins();
