import { recognize, smoothFree } from './shapes.js';
import { PALETTE, buildPath, neon, glowLine, glowDot, badge, arrow } from './render.js';
import { dist, lerp, clamp, cumulative, subPath, pointAt, resample, polygonArea, polyDist } from './geom.js';

// Durées des animations (ms)
const T = { MORPH: 240, IN: 720, OUT: 560, HOT: 380, STEP_ARROW: 300, STEP_IN: 720 };
const STEP_R = 17;
const MAX_PARTICLES = 600;

const tauri = window.__TAURI__;
const invoke = (cmd, args) => tauri?.core.invoke(cmd, args).catch(console.error);

const $ = (id) => document.getElementById(id);
const staticCv = $('static'), fxCv = $('fx');
const sctx = staticCv.getContext('2d'), fctx = fxCv.getContext('2d');

const state = {
  drawMode: false,
  tool: 'pen', // pen | eraser | steps
  color: PALETTE.b,
  width: 5,
  shapes: true,
  objects: [],
  active: null,
  erasing: false,
  lastErase: null,
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
const eraserRadius = () => 14 + state.width * 1.5;

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
  return !o.dying && now - o.born >= (o.kind === 'step' ? T.STEP_IN : T.IN);
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
  const ux = (o.x - prev.x) / d, uy = (o.y - prev.y) / d;
  const a = { x: prev.x + ux * (STEP_R + 6), y: prev.y + uy * (STEP_R + 6) };
  const b = { x: o.x - ux * (STEP_R + 8), y: o.y - uy * (STEP_R + 8) };
  const p = easeOutCubic(clamp((now - o.born) / T.STEP_ARROW, 0, 1));
  const alpha = o.dying ? 1 - clamp((now - o.dying) / T.OUT, 0, 1) : 1;
  arrow(ctx, a, b, o.color, 3, p, alpha);
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
  if (state.tool === 'eraser' || state.erasing) {
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
  } else if (state.tool === 'steps') {
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
  if (state.drawMode || state.hideRequested || state.objects.length) return;
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

function eraseAlong(p) {
  const from = state.lastErase ?? p;
  const steps = Math.max(1, Math.ceil(dist(from, p) / (eraserRadius() / 2)));
  for (let i = 1; i <= steps; i++) eraseAt(lerp(from, p, i / steps));
  state.lastErase = p;
}

function undo() {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (o.dying) continue;
    kill(o);
    if (o.kind === 'step' && o.seq === state.seq && o.n === state.nextStep - 1) state.nextStep--;
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

const TOOL_LABEL = { pen: '✎ Stylo', eraser: '⌫ Gomme', steps: '① Étapes' };
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

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 900);
}

function setTool(tool) {
  state.tool = tool;
  toast(TOOL_LABEL[tool]);
  updateHud();
  requestRender();
}

function setDrawMode(on) {
  if (state.drawMode === on) return;
  state.drawMode = on;
  document.body.classList.toggle('drawing', on);
  if (on) {
    state.hideRequested = false;
    window.focus();
    updateHud();
  } else {
    if (state.active) finishStroke(false);
    state.erasing = false;
    state.pointer = null;
    $('help').classList.remove('show');
  }
  requestRender();
}

function exitDrawMode() {
  if (tauri) invoke('set_draw_mode', { on: false });
  else setDrawMode(false);
}

function onKey(e) {
  // Hors Tauri (navigateur, pour le développement), F10 bascule localement.
  if (!tauri && e.key === 'F10') {
    e.preventDefault();
    setDrawMode(!state.drawMode);
    return;
  }
  if (!state.drawMode) return;
  e.preventDefault();
  const k = e.key.toLowerCase();

  if (e.ctrlKey || e.metaKey) {
    if (k === 'z') undo();
    return;
  }
  if (PALETTE[k]) {
    state.color = PALETTE[k];
    if (state.tool === 'eraser') state.tool = 'pen';
    toast(state.color.name);
    updateHud();
    requestRender();
    return;
  }
  switch (k) {
    case 'escape':
      if ($('help').classList.contains('show')) $('help').classList.remove('show');
      else exitDrawMode();
      break;
    case 'd': setTool('pen'); break;
    case 'e': setTool(state.tool === 'eraser' ? 'pen' : 'eraser'); break;
    case 's': setTool(state.tool === 'steps' ? 'pen' : 'steps'); break;
    case 'n':
      state.seq++;
      state.nextStep = 1;
      if (state.tool !== 'steps') state.tool = 'steps';
      toast('Nouvelle séquence');
      updateHud();
      requestRender();
      break;
    case 'f':
      state.shapes = !state.shapes;
      toast(state.shapes ? 'Formes auto : activées' : 'Formes auto : désactivées');
      updateHud();
      break;
    case 'h': case '?': case 'f1':
      $('help').classList.toggle('show');
      break;
    case 'delete': case 'x':
      clearAll();
      break;
    case 'backspace':
      undo();
      break;
    case '+': case '=': changeWidth(1); break;
    case '-': case '_': changeWidth(-1); break;
  }
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
  if (e.button === 2 || penEraser || (e.button === 0 && state.tool === 'eraser')) {
    state.erasing = true;
    state.lastErase = null;
    eraseAlong(p);
  } else if (e.button === 0 && state.tool === 'steps') {
    addStep(p);
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
    if (state.active) {
      const pts = state.active.pts;
      if (dist(pts[pts.length - 1], p) >= 1.5) pts.push(p);
    } else if (state.erasing) eraseAlong(p);
  }
  state.pointer = pos(e);
  requestRender();
});

function endPointer(e) {
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

if (tauri) {
  tauri.event.listen('draw-mode', (e) => setDrawMode(!!e.payload));
  tauri.event.listen('clear-all', () => clearAll());
} else {
  document.body.classList.add('browser');
}

resize();
updateHud();
