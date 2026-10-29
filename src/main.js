import { recognize, smoothFree } from './shapes.js';
import { PALETTE, buildPath, neon, glowLine, glowDot, badge, arrow } from './render.js';
import { checkUpdate } from './update.js';
import { buildKeymap, eventCombo, prettyCombo } from './keys.js';
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
const staticCv = $('static'), fxCv = $('fx');
const sctx = staticCv.getContext('2d'), fctx = fxCv.getContext('2d');

const state = {
  drawMode: false,
  tool: 'pen', // pen | eraser | cutter | steps
  color: PALETTE.b,
  width: 5,
  shapes: true,
  objects: [],
  active: null,
  erasing: false,
  lastErase: null,
  pending: null, // clic en mode étapes : pastille, ou trait si la souris glisse
  board: null, // null (écran visible) | 'black' | 'white'
  pointer: null,
  particles: [],
  seq: 1,
  nextStep: 1,
  staticDirty: true,
  hideRequested: false,
};
let nextId = 1;
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
  for (const cv of [staticCv, fxCv]) {
    cv.width = Math.round(innerWidth * dpr);
    cv.height = Math.round(innerHeight * dpr);
  }
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

function drawStroke(ctx, o, now) {
  geometry(o);
  const age = now - o.born;

  if (o.dying) {
    // Le trait se « dé-dessine » depuis son début en perdant son éclat.
    const p = clamp((now - o.dying) / T.OUT, 0, 1);
    const pts = subPath(o.pts, o.closed, o.cum, o.len * p * p, o.len);
    if (pts.length) neon(ctx, buildPath(pts, false, o.smooth), o.color, o.width * (1 + p * 0.4), 1 - p * 0.75, p * 0.5);
    return;
  }

  if (o.morph && age < T.MORPH) {
    // Le tracé brut se transforme en forme parfaite.
    const t = easeOutCubic(age / T.MORPH);
    const pts = o.morph.from.map((a, i) => lerp(a, o.morph.to[i], t));
    neon(ctx, buildPath(pts, false, true), o.color, o.width, 1, 0.9);
    return;
  }

  const flash = age < T.IN ? (1 - age / T.IN) ** 2 : 0;
  neon(ctx, o.path, o.color, o.width, 1, flash * 0.8);

  // Une comète lumineuse parcourt le trait : il se « remplit » d'énergie.
  if (age < T.IN && o.len > 4) {
    const start = o.morph ? T.MORPH : 0;
    const q = clamp((age - start) / (T.IN - start), 0, 1);
    const tailLen = Math.max(40, o.len * 0.2);
    const head = easeInOut(q) * (o.len + tailLen);
    const seg = subPath(o.pts, o.closed, o.cum, head - tailLen, head);
    if (seg.length > 1) glowLine(ctx, buildPath(seg, false, o.smooth), o.color, o.width * 0.6, 0.9 * (1 - q * 0.5));
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

function drawObjects(ctx, list, now) {
  for (const o of list) if (o.kind !== 'step') drawStroke(ctx, o, now);
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
      else {
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
  drawParticles(fctx);
  drawCursor();

  const busy = state.active || state.particles.length || state.objects.some((o) => !o.inStatic);
  if (busy) requestRender();
  else maybeHide();
}

function drawActive(now) {
  const a = state.active;
  const pts = a.pts;
  neon(fctx, buildPath(pts, false, true), a.color, a.width, 1, 0.15);

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

function drawCursor() {
  const p = state.pointer;
  if (!state.drawMode || !p) return;
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
  const o = { id: nextId++, kind: res.kind, color: a.color, width: a.width, pts: res.pts, closed: res.closed, smooth: res.smooth, born: performance.now() };
  if (res.kind !== 'free' && res.kind !== 'dot') o.morph = prepMorph(raw, res.pts, res.closed);
  state.objects.push(o);
}

function addStep(p) {
  const o = { id: nextId++, kind: 'step', x: p.x, y: p.y, n: state.nextStep++, seq: state.seq, color: state.color, born: performance.now() };
  state.objects.push(o);
  o.delay = prevStep(o) ? T.STEP_ARROW * 0.7 : 0;
}

function eraseAt(p) {
  const r = eraserRadius();
  for (const o of state.objects) {
    if (o.dying) continue;
    let hit;
    if (o.kind === 'step') hit = dist(o, p) < STEP_R + r;
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
      id: nextId++, kind: 'free', color: o.color, width: o.width, pts, closed: false, smooth: true, born: now - T.IN,
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

const TOOL_LABEL = { pen: '✎ Stylo', eraser: '⌫ Gomme', cutter: '✂ Gomme précise', steps: '① Étapes' };
let toastTimer = 0, idleTimer = 0;

function updateHud() {
  document.documentElement.style.setProperty('--c', state.color.glow === state.color.hex ? state.color.hex : '#d9d9e6');
  $('hud-color').textContent = state.color.name;
  $('hud-tool').textContent = TOOL_LABEL[state.tool];
  $('hud-shapes').textContent = state.shapes ? '◇ Formes auto' : '〰 Main levée';
  $('hud-width').textContent = `${state.width} px`;
  const hud = $('hud');
  hud.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => hud.classList.add('idle'), 2500);
}

function toast(msg, ms = 900) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

const BOARD_LABEL = { black: 'Tableau noir', white: 'Tableau blanc' };

/** Fond opaque noir ou blanc pour dessiner sur une page vierge ; même touche = retour à l'écran. */
function setBoard(board) {
  state.board = state.board === board ? null : board;
  document.body.dataset.board = state.board ?? '';
  // Une encre invisible sur ce fond passe à la couleur opposée.
  if (state.board === 'white' && state.color === PALETTE.w) state.color = PALETTE.k;
  if (state.board === 'black' && state.color === PALETTE.k) state.color = PALETTE.w;
  toast(state.board ? BOARD_LABEL[state.board] : 'Écran visible');
  updateHud();
  requestRender();
}

function setTool(tool) {
  state.tool = tool;
  toast(TOOL_LABEL[tool]);
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
    state.pending = null;
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

// ───────────────────────── Raccourcis ─────────────────────────

const COLOR_ACTIONS = {
  couleurRouge: 'r', couleurVert: 'g', couleurBleu: 'b', couleurJaune: 'y', couleurOrange: 'o',
  couleurRose: 'p', couleurViolet: 'v', couleurCyan: 'c', couleurBlanc: 'w', couleurNoir: 'k',
};

// Remplacés par la configuration (config.json via Tauri, valeurs d'origine dans le navigateur).
let keymap = buildKeymap({ basculerDessin: 'F10', effacerEtQuitter: 'Escape' });
let links = [];

function applyConfig(config) {
  keymap = buildKeymap(config.raccourcis);
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
  tableauNoir: () => setBoard('black'),
  tableauBlanc: () => setBoard('white'),
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

function onKey(e) {
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
  if (eggOpen()) {
    closeEgg();
    return;
  }
  if (watchSecret(e)) return;
  if (action && ACTIONS[action]) ACTIONS[action]();
}

// ───────────────────────── Aide ─────────────────────────

const HELP_SECTIONS = [
  ['Général', [
    ['basculerDessin', 'Dessin on/off (masque et réaffiche les tracés)'],
    ['effacerEtQuitter', 'Tout effacer et quitter le dessin'],
    ['annuler', 'Annuler le dernier élément'],
    ['toutEffacer', 'Tout effacer'],
    ['epaisseurPlus', 'Trait plus épais (ou molette)'],
    ['epaisseurMoins', 'Trait plus fin'],
    ['aide', 'Afficher / masquer cette aide'],
  ]],
  ['Outils', [
    ['stylo', 'Stylo'],
    ['gomme', 'Gomme : trait entier (ou clic droit)'],
    ['gommePrecise', 'Gomme précise : une partie du trait'],
    ['etapes', 'Étapes : clic = pastille, glisser = trait'],
    ['nouvelleSequence', 'Nouvelle séquence d’étapes'],
    ['formesAuto', 'Formes auto on/off (Maj en relâchant : main levée)'],
    ['tableauNoir', 'Tableau noir (même touche : retour)'],
    ['tableauBlanc', 'Tableau blanc (même touche : retour)'],
  ]],
  ['Couleurs', Object.entries(COLOR_ACTIONS).map(([action, key]) => [action, PALETTE[key].name, key === 'k' ? '#555566' : PALETTE[key].hex])],
];

const keysOf = (action) => (keymap.byAction[action] ?? []).map(prettyCombo).join(' · ') || '—';

function renderHelp() {
  const cols = $('help-cols');
  cols.replaceChildren();
  let row = 0;
  for (const [title, entries] of HELP_SECTIONS) {
    const section = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = title;
    const dl = document.createElement('dl');
    if (title === 'Couleurs') dl.className = 'colors';
    for (const [action, label, swatch] of entries) {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = keysOf(action);
      dd.textContent = label;
      if (swatch) dd.style.setProperty('--k', swatch);
      for (const el of [dt, dd]) el.style.setProperty('--i', row);
      row++;
      dl.append(dt, dd);
    }
    section.append(h2, dl);
    cols.append(section);
  }
  $('hud-hint').textContent = `${keysOf('aide').split(' · ')[0]} aide · ${keysOf('basculerDessin')} masquer · ${keysOf('effacerEtQuitter')} effacer`;
}

const helpOpen = () => $('help').classList.contains('show');

function toggleHelp(force) {
  const help = $('help');
  const open = force ?? !helpOpen();
  help.classList.toggle('show', open);
}

function changeWidth(delta) {
  state.width = clamp(state.width + delta, 2, 24);
  toast(`Épaisseur ${state.width} px`);
  updateHud();
  requestRender();
}

// ───────────────────────── Souris / stylet ─────────────────────────

const pos = (e) => ({ x: e.clientX, y: e.clientY, t: performance.now() });

fxCv.addEventListener('pointerdown', (e) => {
  if (!state.drawMode) return;
  fxCv.setPointerCapture(e.pointerId);
  const p = pos(e);
  state.pointer = p;
  const penEraser = e.pointerType === 'pen' && (e.buttons & 32);
  if (e.button === 0 && state.tool === 'cutter') {
    state.erasing = 'fine';
    state.lastErase = null;
    eraseAlong(p);
  } else if (e.button === 2 || penEraser || (e.button === 0 && state.tool === 'eraser')) {
    state.erasing = 'whole';
    state.lastErase = null;
    eraseAlong(p);
  } else if (e.button === 0 && state.tool === 'steps') {
    state.pending = p;
  } else if (e.button === 0) {
    state.active = { pts: [p], color: state.color, width: state.width };
  }
  requestRender();
});

fxCv.addEventListener('pointermove', (e) => {
  if (!state.drawMode) return;
  const events = e.getCoalescedEvents?.() ?? [e];
  for (const ev of events.length ? events : [e]) {
    const p = pos(ev);
    if (state.pending && dist(state.pending, p) >= DRAG_START) {
      // En mode étapes, glisser dessine un trait (avec reconnaissance de formes).
      state.active = { pts: [state.pending, p], color: state.color, width: state.width };
      state.pending = null;
    } else if (state.active) {
      const pts = state.active.pts;
      if (dist(pts[pts.length - 1], p) >= 1.5) pts.push(p);
    } else if (state.erasing) eraseAlong(p);
  }
  state.pointer = pos(e);
  requestRender();
});

function endPointer(e) {
  if (state.pending && e.type === 'pointerup') addStep(state.pending);
  state.pending = null;
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
    if (state.drawMode) toast('Raccourcis rechargés');
  });
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
    setInterval(() => lookForUpdate(false), 2 * 3600 * 1000);
  })();
} else {
  document.body.classList.add('browser');
  fetch('config.default.json').then((r) => r.json()).then(applyConfig).catch(console.error);
}

resize();
renderHelp();
updateHud();
