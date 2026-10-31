// Pulse : un jeu de rythme caché. P, U, L, S, E tapés à la suite en mode dessin.
//
// Des étincelles apparaissent au rythme de la musique ; leur anneau se charge en tournant et
// doit être touché (clic, ou X / C) quand il est plein. Les chaînes se tracent d'un seul trait,
// bouton maintenu, à l'encre néon. La musique est composée et jouée à la volée (Web Audio) :
// aucun fichier audio. Le meilleur score de chaque niveau est gardé dans le navigateur intégré.

const TAU = Math.PI * 2;
const COLORS = ['#14f1ff', '#ff3bd4', '#ffe14d', '#39ff6a', '#b26bff', '#ff8a2a'];
const FONT = '"Segoe UI", system-ui, sans-serif';

// Fenêtres de jugement (secondes, de part et d'autre du temps de la note).
const PERFECT = 0.055, GOOD = 0.12, LATE = 0.18;

// Accords en demi-tons depuis la fondamentale, une mesure chacun.
// Motifs en seizièmes : x = coup, . = silence. Notes du jeu : x = étincelle, c = maillon de chaîne.
const LEVELS = [
  {
    id: 'doux', name: 'Néon doux', blurb: 'Lent, pour apprendre', bpm: 92, seed: 11, root: 57,
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]],
    drums: { k: 'x.......x.......', s: '....x.......x...', h: '..x...x...x...x.' },
    bass: 'x.......x...x...', arp: 'x.x.x.x.x.x.x.x.', arpWave: 'triangle', bassWave: 'triangle', cutoff: 900,
    preempt: 1.5, jump: 0.2, link: 0.085,
    sections: [[2, 0], [8, 1], [8, 2], [4, 1], [8, 3], [2, 0]],
    patterns: [['x.......x.......'], ['x...x...x...x...'], ['x...x...c...c...', 'x...x...x...x...']],
  },
  {
    id: 'ville', name: 'Ville la nuit', blurb: 'Premières chaînes', bpm: 112, seed: 23, root: 50,
    chords: [[0, 3, 7, 10], [5, 9, 12], [7, 10, 14], [3, 7, 10]],
    drums: { k: 'x...x...x...x...', s: '....x.......x...', h: '..x...x...x...x.' },
    bass: 'x.x...x.x.x...x.', arp: 'xxxxxxxxxxxxxxxx', arpWave: 'square', bassWave: 'sawtooth', cutoff: 700,
    preempt: 1.25, jump: 0.24, link: 0.08,
    sections: [[2, 0], [8, 1], [8, 2], [4, 1], [12, 3], [2, 0]],
    patterns: [['x...x...x...x...'], ['x...x.x.x...x...', 'x...x...x.x.x...'], ['x...c.c.c...x...', 'x.x.x...c.c.c.c.']],
  },
  {
    id: 'orage', name: 'Orage électrique', blurb: 'Rapide, partout à l’écran', bpm: 134, seed: 37, root: 52,
    chords: [[0, 3, 7], [-4, 0, 3], [-2, 2, 5], [-5, -1, 2]],
    drums: { k: 'x.........x.....', s: '....x.......x..x', h: 'x.x.x.x.x.x.x.x.' },
    bass: 'x..x..x...x..x..', arp: 'xxxxxxxxxxxxxxxx', arpWave: 'sawtooth', bassWave: 'sawtooth', cutoff: 1400,
    preempt: 1.0, jump: 0.3, link: 0.075,
    sections: [[2, 0], [8, 1], [8, 2], [4, 1], [16, 3], [2, 0]],
    patterns: [['x...x...x.x.x...'], ['x.x.x...x.x.x...', 'x...x.x.c.c.c...'], ['x.x.x.x.c.c.c.c.', 'c.c.c.c.x.x.x.x.']],
  },
  {
    id: 'surcharge', name: 'Surcharge', blurb: 'Pour les meilleurs', bpm: 164, seed: 53, root: 54,
    chords: [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [1, 5, 8]],
    drums: { k: 'x...x...x...x...', s: '....x.......x...', h: 'xxxxxxxxxxxxxxxx' },
    bass: 'x.xxx.xxx.xxx.xx', arp: 'xxxxxxxxxxxxxxxx', arpWave: 'square', bassWave: 'sawtooth', cutoff: 1800,
    preempt: 0.8, jump: 0.34, link: 0.07,
    sections: [[2, 0], [8, 1], [12, 2], [4, 1], [20, 3], [2, 0]],
    patterns: [['x...x.x.x...x.x.'], ['x.x.x.x.x.x.x.x.', 'x.x.c.c.c.c.x.x.'], ['c.c.c.c.c.x.x.x.', 'x.x.x.x.c.c.c.c.']],
  },
];

let open = false;
let cv = null, ctx = null, dpr = 1;
let raf = 0;
let screen = 'menu'; // menu | play | results
let hover = -1; // carte ou bouton survolé
let pointer = { x: -1, y: -1 };
let held = false; // bouton ou X / C maintenu (chaînes)
let trail = []; // traînée d'encre quand le bouton est maintenu
let game = null;
let audio = null;
let particles = [];
let popups = [];
let menuAt = 0;

export const pulseOpen = () => open;

/** Pour les tests : l'écran affiché et, en partie, le temps de la chanson et les étincelles. */
export const pulseDebug = () => ({ open, screen, ...(game && { now: songTime(), field: field(), notes: game.notes, score: game.score }) });

export function openPulse() {
  if (open) return;
  open = true;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.id = 'pulse';
    cv.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:1000;cursor:none;';
    document.body.appendChild(cv);
    ctx = cv.getContext('2d');
  }
  cv.style.display = 'block';
  resize();
  for (const [type, fn] of LISTENERS) window.addEventListener(type, fn, { capture: true, passive: false });
  showMenu();
  loop();
}

export function closePulse() {
  if (!open) return;
  open = false;
  stopSong();
  cancelAnimationFrame(raf);
  cv.style.display = 'none';
  for (const [type, fn] of LISTENERS) window.removeEventListener(type, fn, { capture: true });
  game = null;
  particles = [];
  popups = [];
}

// ───────────────────────── Entrées ─────────────────────────
// Écoutées en phase de capture sur la fenêtre : rien n'atteint le dessin tant que le jeu est ouvert.

function swallow(e) {
  e.stopImmediatePropagation();
  if (e.cancelable) e.preventDefault();
}

const TAP_KEYS = ['KeyX', 'KeyC'];

function onKeyDown(e) {
  if (e.key === 'F10' || e.key === 'F11' || e.key === 'F12') return; // dessin on / off, plein écran, outils
  swallow(e);
  if (e.repeat) return;
  if (screen === 'play') {
    if (e.key === 'Escape') return showMenu();
    if (TAP_KEYS.includes(e.code)) {
      held = true;
      press(e.timeStamp);
    }
    return;
  }
  if (screen === 'results') {
    if (e.key === 'Escape') return showMenu();
    if (e.key === 'Enter' || e.code === 'KeyR' || e.code === 'Space') return start(game.level);
    return;
  }
  // Menu
  if (e.key === 'Escape') return closePulse();
  const n = Number(e.key);
  if (n >= 1 && n <= LEVELS.length) start(LEVELS[n - 1]);
}

function onKeyUp(e) {
  swallow(e);
  if (TAP_KEYS.includes(e.code)) held = false;
}

function onPointerDown(e) {
  swallow(e);
  pointer = { x: e.clientX, y: e.clientY };
  if (e.button !== 0) return;
  if (screen === 'play') {
    held = true;
    press(e.timeStamp);
    return;
  }
  const hit = hitButton(pointer);
  if (screen === 'menu' && hit >= 0) start(LEVELS[hit]);
  if (screen === 'results') {
    if (hit === 0) start(game.level);
    if (hit === 1) showMenu();
  }
}

function onPointerMove(e) {
  swallow(e);
  pointer = { x: e.clientX, y: e.clientY };
  if (screen !== 'play') hover = hitButton(pointer);
  if (held) {
    trail.push({ x: pointer.x, y: pointer.y, at: performance.now() });
    if (screen === 'play') sweep(e.timeStamp);
  }
}

function onPointerUp(e) {
  swallow(e);
  if (e.button === 0) held = false;
}

const LISTENERS = [
  ['keydown', onKeyDown],
  ['keyup', onKeyUp],
  ['pointerdown', onPointerDown],
  ['pointermove', onPointerMove],
  ['pointerup', onPointerUp],
  ['pointercancel', onPointerUp],
  ['mousedown', swallow],
  ['mouseup', swallow],
  ['auxclick', swallow],
  ['contextmenu', swallow],
  ['wheel', swallow],
];

function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
}
window.addEventListener('resize', () => open && resize());

// ───────────────────────── Musique ─────────────────────────

const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);

function makeAudio() {
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const master = ac.createGain();
  master.gain.value = 0.55;
  const comp = ac.createDynamicsCompressor();
  master.connect(comp).connect(ac.destination);
  // Écho léger pour l'arpège.
  const echo = ac.createDelay(1);
  const feedback = ac.createGain();
  feedback.gain.value = 0.28;
  const wet = ac.createGain();
  wet.gain.value = 0.35;
  echo.connect(feedback).connect(echo);
  echo.connect(wet).connect(master);
  const noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return { ac, master, echo, noise };
}

function envelope(g, t, attack, decay, peak) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function voice(a, t, { type = 'sine', freq, to, attack = 0.005, decay = 0.2, peak = 0.3, filter, send }) {
  const o = a.ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + decay * 0.6);
  const g = a.ac.createGain();
  envelope(g, t, attack, decay, peak);
  let node = o;
  if (filter) {
    const f = a.ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filter;
    node.connect(f);
    node = f;
  }
  node.connect(g).connect(a.master);
  if (send) g.connect(a.echo);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function noiseHit(a, t, { hp, decay, peak }) {
  const s = a.ac.createBufferSource();
  s.buffer = a.noise;
  const f = a.ac.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.ac.createGain();
  envelope(g, t, 0.002, decay, peak);
  s.connect(f).connect(g).connect(a.master);
  s.start(t, Math.random() * 0.5);
  s.stop(t + decay + 0.05);
}

const kick = (a, t) => voice(a, t, { freq: 150, to: 42, decay: 0.28, peak: 0.9 });
const snare = (a, t) => {
  noiseHit(a, t, { hp: 1500, decay: 0.16, peak: 0.35 });
  voice(a, t, { type: 'triangle', freq: 190, decay: 0.08, peak: 0.2 });
};
const hat = (a, t) => noiseHit(a, t, { hp: 7500, decay: 0.035, peak: 0.1 });
const tick = (a) => voice(a, a.ac.currentTime, { type: 'sine', freq: 1320, decay: 0.05, peak: 0.12 });

/** Joue les seizièmes de la mesure `bar` à partir de `t`, selon l'intensité de la section. */
function playStep(a, level, bar, s, t, intensity, step) {
  const chord = level.chords[bar % level.chords.length];
  const d = level.drums;
  if (intensity >= 1 && d.k[s] === 'x') kick(a, t);
  if (intensity >= 2 && d.s[s] === 'x') snare(a, t);
  if (d.h[s] === 'x' && (intensity >= 1 || s % 4 === 2)) hat(a, t);
  if (intensity >= 1 && level.bass[s] === 'x') {
    voice(a, t, { type: level.bassWave, freq: midiHz(level.root - 12 + chord[0]), decay: step * 1.6, peak: 0.22, filter: level.cutoff });
  }
  if (intensity >= 2 && level.arp[s] === 'x') {
    const n = chord[s % chord.length] + 12 * (1 + ((s >> 2) % 2) + (intensity >= 3 && s >= 8 ? 1 : 0));
    voice(a, t, { type: level.arpWave, freq: midiHz(level.root + n), decay: step * 1.4, peak: 0.05, filter: 3200, send: true });
  }
  // Nappe : un accord tenu à chaque début de mesure.
  if (s === 0) {
    for (const c of chord) {
      for (const detune of [-0.08, 0.08]) {
        voice(a, t, { type: 'sawtooth', freq: midiHz(level.root + c + detune), attack: 0.4, decay: step * 15, peak: intensity ? 0.022 : 0.03, filter: 1100 });
      }
    }
  }
}

/** Programmation au fil de l'eau : 250 ms d'avance, vérifiées toutes les 25 ms. */
function scheduleSong() {
  const g = game, a = audio;
  if (!g || !a) return;
  const horizon = a.ac.currentTime + 0.25;
  while (g.nextStep < g.totalSteps) {
    const t = g.t0 + g.nextStep * g.step;
    if (t > horizon) break;
    const bar = Math.floor(g.nextStep / 16);
    playStep(a, g.level, bar, g.nextStep % 16, t, g.intensity[bar], g.step);
    g.nextStep++;
  }
}

function stopSong() {
  if (game?.timer) clearInterval(game.timer);
  if (audio) {
    const a = audio;
    a.master.gain.setTargetAtTime(0, a.ac.currentTime, 0.05);
    setTimeout(() => a.ac.close().catch(() => {}), 300);
    audio = null;
  }
}

// ───────────────────────── Niveaux ─────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Les étincelles du niveau, toujours les mêmes : positions en coordonnées 0..1 de l'aire de jeu. */
export function buildChart(level) {
  const rnd = mulberry32(level.seed);
  const step = 60 / level.bpm / 4;
  const notes = [];
  let x = 0.5, y = 0.5, angle = rnd() * TAU, bar = 0, chainId = 0, color = 0;
  const move = (dist, turn) => {
    angle += (rnd() - 0.5) * turn;
    let nx = x + Math.cos(angle) * dist, ny = y + Math.sin(angle) * dist * 1.6;
    if (nx < 0.04 || nx > 0.96) {
      angle = Math.PI - angle;
      nx = x + Math.cos(angle) * dist;
    }
    if (ny < 0.04 || ny > 0.96) {
      angle = -angle;
      ny = y + Math.sin(angle) * dist * 1.6;
    }
    x = Math.min(0.96, Math.max(0.04, nx));
    y = Math.min(0.96, Math.max(0.04, ny));
  };
  const intensity = [];
  for (const [bars, heat] of level.sections) {
    for (let b = 0; b < bars; b++, bar++) {
      intensity.push(heat);
      if (!heat) continue;
      const patterns = level.patterns[heat - 1];
      const pattern = patterns[bar % patterns.length];
      let chain = null;
      for (let s = 0; s < 16; s++) {
        const c = pattern[s];
        if (c === '.') continue;
        const t = (bar * 16 + s) * step;
        if (c === 'x') {
          chain = null;
          move(level.jump, 1.8);
          notes.push({ t, x, y, kind: 'tap', color });
        } else if (!chain) {
          chain = ++chainId;
          move(level.jump, 1.8);
          notes.push({ t, x, y, kind: 'head', chain, color });
        } else {
          move(level.link, 0.5);
          notes.push({ t, x, y, kind: 'link', chain, color });
        }
      }
      if (bar % 2 === 1) color = (color + 1) % COLORS.length;
    }
  }
  return { notes, intensity, bars: bar, step };
}

// ───────────────────────── Partie ─────────────────────────

function loadBest() {
  try {
    return JSON.parse(localStorage.getItem('neonink.pulse') || '{}');
  } catch {
    return {};
  }
}

function saveBest(best) {
  try {
    localStorage.setItem('neonink.pulse', JSON.stringify(best));
  } catch {
    /* stockage indisponible : le record n'est simplement pas gardé */
  }
}

function showMenu() {
  stopSong();
  screen = 'menu';
  menuAt = performance.now();
  held = false;
  hover = hitButton(pointer);
}

function start(level) {
  stopSong();
  audio = makeAudio();
  const chart = buildChart(level);
  const t0 = audio.ac.currentTime + 0.35;
  game = {
    level,
    chart,
    notes: chart.notes.map((n) => ({ ...n, judged: null })),
    intensity: chart.intensity,
    step: chart.step,
    t0,
    nextStep: 0,
    totalSteps: chart.bars * 16,
    end: chart.bars * 16 * chart.step,
    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, good: 0, late: 0, miss: 0 },
    timer: 0,
    record: false,
  };
  game.timer = setInterval(scheduleSong, 25);
  scheduleSong();
  screen = 'play';
  held = false;
  trail = [];
  particles = [];
  popups = [];
}

/** Temps de la chanson (s) : celui de l'horloge audio, corrigé de la latence de sortie. */
function songTime(eventStamp) {
  if (!audio || !game) return 0;
  const latency = audio.ac.outputLatency || audio.ac.baseLatency || 0;
  const late = eventStamp ? Math.max(0, (performance.now() - eventStamp) / 1000) : 0;
  return audio.ac.currentTime - game.t0 - latency - late;
}

/** Aire de jeu : les coordonnées 0..1 des étincelles, en pixels. */
function field() {
  const w = innerWidth, h = innerHeight;
  const mx = w * 0.12, my = h * 0.16;
  return { x: mx, y: my, w: w - 2 * mx, h: h - 2 * my, r: Math.max(22, Math.min(w, h) * 0.038) };
}

const at = (n, f) => ({ x: f.x + n.x * f.w, y: f.y + n.y * f.h });

function judge(n, dt, f) {
  const off = Math.abs(dt);
  const grade = off <= PERFECT ? 'perfect' : off <= GOOD ? 'good' : 'late';
  const points = { perfect: 300, good: 100, late: 50 }[grade];
  n.judged = grade;
  game.counts[grade]++;
  game.combo++;
  game.maxCombo = Math.max(game.maxCombo, game.combo);
  game.score += Math.round(points * (1 + Math.min(game.combo, 100) / 25));
  const p = at(n, f);
  burst(p.x, p.y, COLORS[n.color], grade === 'perfect' ? 26 : 14);
  popup(p.x, p.y - f.r * 1.4, { perfect: 'parfait', good: 'bien', late: 'juste' }[grade], grade === 'perfect' ? '#14f1ff' : grade === 'good' ? '#ffe14d' : '#ff8a2a');
  if (audio) tick(audio);
}

function miss(n, f) {
  n.judged = 'miss';
  game.counts.miss++;
  game.combo = 0;
  const p = at(n, f);
  popup(p.x, p.y - f.r * 1.4, 'raté', '#ff4d6a');
}

/** Clic ou X / C : l'étincelle (ou la tête de chaîne) la plus ancienne sous le curseur. */
function press(stamp) {
  if (!game) return;
  trail = [{ x: pointer.x, y: pointer.y, at: performance.now() }];
  const now = songTime(stamp);
  const f = field();
  for (const n of game.notes) {
    if (n.judged || n.kind === 'link') continue;
    const dt = now - n.t;
    if (dt < -LATE * 1.6) break;
    if (dt > LATE) continue;
    const p = at(n, f);
    if (Math.hypot(pointer.x - p.x, pointer.y - p.y) <= f.r * 1.25) {
      if (dt < -LATE) return; // trop tôt : la note reste à jouer
      judge(n, dt, f);
      return;
    }
  }
}

/** Bouton maintenu : chaque maillon de chaîne traversé au bon moment est validé. */
function sweep(stamp) {
  if (!game || !held) return;
  const now = songTime(stamp);
  const f = field();
  for (const n of game.notes) {
    if (n.judged || n.kind !== 'link') continue;
    const dt = now - n.t;
    if (dt < -GOOD) break;
    if (dt > LATE) continue;
    const p = at(n, f);
    // Un maillon se traverse d'un trait continu : passer dessus dans la fenêtre suffit.
    if (Math.hypot(pointer.x - p.x, pointer.y - p.y) <= f.r * 1.3) judge(n, dt <= GOOD ? 0 : dt, f);
  }
}

function update() {
  if (screen !== 'play' || !game) return;
  const now = songTime();
  const f = field();
  sweep();
  for (const n of game.notes) {
    if (n.judged) continue;
    if (now - n.t > LATE) miss(n, f);
    else break;
  }
  if (now > game.end + 0.6) finish();
}

function finish() {
  const g = game;
  const total = g.notes.length || 1;
  const c = g.counts;
  g.accuracy = (c.perfect * 300 + c.good * 100 + c.late * 50) / (total * 300);
  g.stars = g.accuracy >= 0.95 ? 3 : g.accuracy >= 0.85 ? 2 : g.accuracy >= 0.7 ? 1 : 0;
  g.grade = g.accuracy >= 0.95 && !c.miss ? 'S' : g.accuracy >= 0.9 ? 'A' : g.accuracy >= 0.8 ? 'B' : g.accuracy >= 0.7 ? 'C' : 'D';
  const best = loadBest();
  const prev = best[g.level.id];
  if (!prev || g.score > prev.score) {
    g.record = !!prev || g.score > 0;
    best[g.level.id] = { score: g.score, stars: Math.max(g.stars, prev?.stars ?? 0), grade: g.grade };
    saveBest(best);
  }
  stopSong();
  screen = 'results';
  menuAt = performance.now();
  hover = hitButton(pointer);
}

// ───────────────────────── Effets ─────────────────────────

function burst(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * TAU, v = 90 + Math.random() * 260;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, color, born: performance.now(), life: 380 + Math.random() * 380 });
  }
}

function popup(x, y, text, color) {
  popups.push({ x, y, text, color, born: performance.now() });
}

// ───────────────────────── Dessin ─────────────────────────

function glowStroke(color, width, alpha = 1) {
  ctx.globalAlpha = alpha * 0.22;
  ctx.lineWidth = width * 4;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.globalAlpha = alpha * 0.9;
  ctx.lineWidth = Math.max(1, width * 0.35);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function neonText(text, x, y, size, color, align = 'center', alpha = 1) {
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = alpha;
  ctx.shadowColor = color;
  ctx.shadowBlur = size * 0.5;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

function loop() {
  if (!open) return;
  update();
  draw();
  raf = requestAnimationFrame(loop);
}

function draw() {
  const w = innerWidth, h = innerHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // Voile sombre, qui respire au rythme de la musique pendant la partie.
  let beat = 0;
  if (screen === 'play' && game) {
    const t = songTime();
    beat = t > 0 ? 1 - ((t / (game.step * 4)) % 1) : 0;
  }
  ctx.fillStyle = `rgba(6, 4, 16, ${0.86 - beat * 0.05})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  if (screen === 'menu') drawMenu(w, h);
  else if (screen === 'play') drawPlay(w, h);
  else drawResults(w, h);
  drawEffects();
  drawCursor();
  ctx.globalCompositeOperation = 'source-over';
}

function drawMenu(w, h) {
  const t = performance.now() - menuAt;
  // Le titre s'allume comme une enseigne, avec un raté de temps en temps.
  const flicker = t < 900 ? (Math.random() < t / 900 ? 1 : 0.25) : Math.sin(t / 130) > 0.97 ? 0.5 : 1;
  neonText('PULSE', w / 2, h * 0.2, Math.min(140, w * 0.11), '#ff3bd4', 'center', flicker);
  neonText('le jeu de rythme caché de NeonInk', w / 2, h * 0.2 + Math.min(90, w * 0.07), 20, '#14f1ff', 'center', 0.85);
  const best = loadBest();
  menuCards(w, h).forEach((card, i) => {
    const level = LEVELS[i];
    const color = COLORS[i];
    const on = hover === i;
    ctx.beginPath();
    ctx.roundRect(card.x, card.y, card.w, card.h, 14);
    glowStroke(color, on ? 3 : 1.6, on ? 1 : 0.7);
    if (on) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.08;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const cx = card.x + card.w / 2;
    neonText(String(i + 1), cx, card.y + 46, 40, color);
    neonText(level.name, cx, card.y + 100, 24, '#ffffff');
    neonText(level.blurb, cx, card.y + 132, 15, color, 'center', 0.8);
    neonText(`${level.bpm} battements / min`, cx, card.y + 160, 14, '#9a90c0', 'center', 0.8);
    const record = best[level.id];
    const stars = [0, 1, 2].map((k) => (record && record.stars > k ? '★' : '☆')).join(' ');
    neonText(stars, cx, card.y + card.h - 62, 24, '#ffe14d', 'center', record ? 1 : 0.4);
    neonText(record ? `record ${record.score.toLocaleString('fr-FR')}` : 'pas encore joué', cx, card.y + card.h - 30, 15, '#ffffff', 'center', 0.7);
  });
  neonText('Clic ou 1 à 4 pour jouer · Échap pour quitter', w / 2, h * 0.86, 17, '#b26bff', 'center', 0.85);
  neonText('Touche les étincelles quand leur anneau est plein (clic, X ou C) · chaînes : bouton maintenu, trace-les d’un trait', w / 2, h * 0.86 + 30, 15, '#9a90c0', 'center', 0.8);
}

function menuCards(w, h) {
  const n = LEVELS.length, gap = 24;
  const cw = Math.min(240, (w * 0.86 - gap * (n - 1)) / n), ch = 270;
  const x0 = (w - (cw * n + gap * (n - 1))) / 2, y = h * 0.4;
  return LEVELS.map((_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch }));
}

function resultButtons(w, h) {
  const bw = 200, bh = 54, y = h * 0.78;
  return [
    { x: w / 2 - bw - 14, y, w: bw, h: bh, label: 'Rejouer (Entrée)' },
    { x: w / 2 + 14, y, w: bw, h: bh, label: 'Menu (Échap)' },
  ];
}

function hitButton(p) {
  const boxes = screen === 'menu' ? menuCards(innerWidth, innerHeight) : screen === 'results' ? resultButtons(innerWidth, innerHeight) : [];
  return boxes.findIndex((b) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h);
}

function drawPlay(w, h) {
  const g = game;
  const now = songTime();
  const f = field();
  const pre = g.level.preempt;

  // Compte à rebours sur la dernière mesure d'introduction.
  const introBars = g.level.sections[0][0];
  const beatLen = g.step * 4;
  const beatNo = Math.floor(now / beatLen) - (introBars - 1) * 4;
  if (now < 0 || beatNo < 0) neonText(g.level.name, w / 2, h / 2, 54, COLORS[LEVELS.indexOf(g.level)]);
  else if (beatNo < 4) {
    const frac = (now / beatLen) % 1;
    neonText(['3', '2', '1', 'C’est parti !'][beatNo], w / 2, h / 2, beatNo < 3 ? 120 : 64, '#ffffff', 'center', 1 - frac * 0.7);
  }

  // Chaînes : le chemin à tracer, visible dès que sa tête apparaît.
  const chains = new Map();
  for (const n of g.notes) {
    if (!n.chain || n.t - pre > now || n.t + 1 < now) continue;
    if (!chains.has(n.chain)) chains.set(n.chain, []);
    chains.get(n.chain).push(n);
  }
  for (const nodes of chains.values()) {
    const head = nodes[0];
    const appear = Math.min(1, (now - (head.t - pre)) / (pre * 0.3));
    ctx.beginPath();
    nodes.forEach((n, i) => {
      const p = at(n, f);
      i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
    });
    ctx.lineCap = ctx.lineJoin = 'round';
    glowStroke(COLORS[head.color], f.r * 0.22, 0.35 * appear);
  }

  // Étincelles, de la plus lointaine à la plus proche dans le temps (les prochaines par-dessus).
  const visible = g.notes.filter((n) => !n.judged && n.t - pre <= now && n.t + LATE >= now);
  for (let i = visible.length - 1; i >= 0; i--) {
    const n = visible[i];
    const p = at(n, f);
    const color = COLORS[n.color];
    const charge = Math.min(1, (now - (n.t - pre)) / pre);
    const alpha = Math.min(1, charge * 4);
    const r = n.kind === 'link' ? f.r * 0.62 : f.r;
    // Anneau de fond.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    glowStroke(color, 1.5, 0.25 * alpha);
    // Charge : l'arc se remplit dans le sens des aiguilles d'une montre et se ferme au bon moment.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + charge * TAU);
    glowStroke(charge >= 1 ? '#ffffff' : color, r * 0.16, alpha);
    // Cœur : un rond pour les étincelles, un losange pour les maillons.
    const core = r * (0.28 + 0.12 * charge);
    ctx.beginPath();
    if (n.kind === 'link') {
      ctx.moveTo(p.x, p.y - core);
      ctx.lineTo(p.x + core, p.y);
      ctx.lineTo(p.x, p.y + core);
      ctx.lineTo(p.x - core, p.y);
      ctx.closePath();
    } else ctx.arc(p.x, p.y, core, 0, TAU);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (charge >= 1) {
      // Pleine : un éclair blanc qui s'élargit pendant la fenêtre de jugement.
      const k = Math.min(1, (now - n.t) / LATE);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * (1 + k * 0.35), 0, TAU);
      glowStroke('#ffffff', 2, 1 - k);
    }
  }

  // Interface : progression, score, précision, combo.
  const progress = Math.max(0, Math.min(1, now / g.end));
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.lineTo(w * progress, 3);
  glowStroke(COLORS[LEVELS.indexOf(g.level)], 3);
  neonText(g.score.toLocaleString('fr-FR'), w - 28, 44, 40, '#ffffff', 'right');
  const judged = g.counts.perfect + g.counts.good + g.counts.late + g.counts.miss;
  const acc = judged ? (g.counts.perfect * 300 + g.counts.good * 100 + g.counts.late * 50) / (judged * 300) : 1;
  neonText(`${(acc * 100).toFixed(1).replace('.', ',')} %`, w - 28, 84, 20, '#14f1ff', 'right', 0.85);
  if (g.combo > 1) neonText(`×${g.combo}`, 28, h - 46, 46, '#ffe14d', 'left');
}

function drawResults(w, h) {
  const g = game;
  const t = performance.now() - menuAt;
  const color = COLORS[LEVELS.indexOf(g.level)];
  neonText(g.level.name, w / 2, h * 0.14, 34, color);
  const gradeColor = { S: '#ffe14d', A: '#39ff6a', B: '#14f1ff', C: '#b26bff', D: '#ff4d6a' }[g.grade];
  const pop = Math.min(1, t / 400);
  neonText(g.grade, w / 2, h * 0.31, 150 * (0.6 + 0.4 * pop), gradeColor, 'center', pop);
  const stars = [0, 1, 2].map((k) => (g.stars > k ? '★' : '☆')).join('  ');
  neonText(stars, w / 2, h * 0.45, 40, '#ffe14d');
  // Le score défile jusqu'à sa valeur.
  const shown = Math.round(g.score * Math.min(1, t / 1200));
  neonText(shown.toLocaleString('fr-FR'), w / 2, h * 0.54, 56, '#ffffff');
  if (g.record && t > 1200) neonText('Nouveau record !', w / 2, h * 0.54 + 46, 22, '#ff3bd4', 'center', 0.6 + 0.4 * Math.sin(t / 120));
  const c = g.counts;
  const line = `précision ${(g.accuracy * 100).toFixed(1).replace('.', ',')} %   ·   combo max ×${g.maxCombo}   ·   parfait ${c.perfect}   ·   bien ${c.good}   ·   juste ${c.late}   ·   raté ${c.miss}`;
  neonText(line, w / 2, h * 0.68, 18, '#9a90c0');
  resultButtons(w, h).forEach((b, i) => {
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 12);
    glowStroke(i ? '#b26bff' : '#14f1ff', hover === i ? 3 : 1.6, hover === i ? 1 : 0.7);
    neonText(b.label, b.x + b.w / 2, b.y + b.h / 2, 18, '#ffffff');
  });
}

function drawEffects() {
  const now = performance.now();
  particles = particles.filter((p) => now - p.born < p.life);
  for (const p of particles) {
    const k = (now - p.born) / p.life;
    const s = (now - p.born) / 1000;
    const x = p.x + p.vx * s * (1 - k * 0.5), y = p.y + p.vy * s * (1 - k * 0.5) + 120 * s * s;
    ctx.globalAlpha = 1 - k;
    ctx.fillStyle = p.color;
    ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
  ctx.globalAlpha = 1;
  popups = popups.filter((p) => now - p.born < 600);
  for (const p of popups) {
    const k = (now - p.born) / 600;
    neonText(p.text, p.x, p.y - k * 30, 20, p.color, 'center', 1 - k);
  }
}

function drawCursor() {
  if (pointer.x < 0) return;
  const now = performance.now();
  trail = trail.filter((p) => now - p.at < 260);
  if (held && trail.length > 1) {
    ctx.beginPath();
    trail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineCap = ctx.lineJoin = 'round';
    glowStroke('#ff3bd4', 4, 0.9);
  }
  ctx.beginPath();
  ctx.arc(pointer.x, pointer.y, held ? 9 : 7, 0, TAU);
  glowStroke(held ? '#ff3bd4' : '#ffffff', 2.5);
}
