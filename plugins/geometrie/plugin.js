// Plugin « Géométrie » pour NeonInk : instruments de géométrie pour la classe, en néon.
// Pensé pour le papier à carreaux (Maj+P petits carreaux, Maj+G grands carreaux) :
// les points s'aimantent au quadrillage.
//
// Échelle : 1 cm = 38 px, soit 2 petits carreaux (un petit carreau = 19 px = 5 mm).
//
// Maj+R (par défaut) : roue des instruments. Maintenir Maj+R, viser, relâcher ; ou appuyer puis
// cliquer. Quand un instrument est actif, M (ou le clic molette) rouvre la roue.
//  - Règle : glisser trace un segment gradué (tous les cm, demi-cm plus courts) et affiche sa
//    longueur (« 7,5 cm »). Maj : direction par pas de 15° et longueur par demi-centimètre.
//  - Rapporteur : cliquer le sommet, puis un point de chaque côté (ou glisser du sommet vers le
//    premier côté, puis cliquer le second) : les deux côtés, l'arc et la mesure (« 47° »).
//    Maj : côtés par pas de 15°.
//  - Compas : cliquer le centre et glisser jusqu'au rayon : cercle, rayon en tirets, « r = 3 cm ».
//    Maj : rayon par pas de 15°.
//  - Repère : cliquer l'origine et glisser pour la taille : axes fléchés, graduations tous les cm
//    (tous les carreaux sur papier à carreaux), nombres et O. Maj : repère dans les quatre quarts.
//  - Angle droit : cliquer le sommet et glisser vers l'intérieur de l'angle : petit carré.
//    Un simple clic le pose vers le haut à droite. Maj : direction par pas de 15°.
// Chaque tracé est un objet : Ctrl+Z, la gomme et la capture fonctionnent comme d'habitude.
// Échap ou un changement d'outil abandonne le tracé en cours.

export const manifest = {
  id: 'geometrie',
  nom: 'Géométrie',
  description: 'Instruments de géométrie : règle graduée, rapporteur, compas, repère et angle droit, aimantés au papier à carreaux.',
  version: '1.0.0',
  api: 1,
};

const CM = 38; // pixels par centimètre (2 petits carreaux de 19 px)
const GRID = { small: 19, seyes: 30 }; // pas du quadrillage des papiers (voir src/boards.js)
const TAU = Math.PI * 2;
const STEP = Math.PI / 12; // 15°
const DRAG = 6; // en deçà, c'est un clic

const MODES = [
  { id: 'regle', label: 'Règle', icon: '⟷' },
  { id: 'rapporteur', label: 'Rapporteur', icon: '◠' },
  { id: 'compas', label: 'Compas', icon: '◯' },
  { id: 'repere', label: 'Repère', icon: '┼' },
  { id: 'angle', label: 'Angle droit', icon: '∟' },
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) ** 3;

/** Nombre à la française : une décimale au plus, virgule (« 7,5 », « 3 »). */
const fr = (v) => String(Math.round(v * 10) / 10).replace('.', ',').replace('-', '−');
const cm = (px) => `${fr(px / CM)} cm`;

/** Distance du point `p` au segment [a, b]. */
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const k = l2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / l2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

/** Angle de b - a ramené dans ]-π, π]. */
function norm(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Épaisseur des traits d'instrument, un peu plus fine que celle du stylo. */
const lineW = (o) => clamp(o.width * 0.55, 1.5, 6);

export function activate(api) {
  let mode = 0; // instrument choisi
  let shift = false; // Maj enfoncée
  let drag = null; // règle, compas, repère, angle droit : { a, b, moved }
  let proto = null; // rapporteur : { pts: [sommet, côté 1], hover, pressed }

  const board = () => api.board;
  const unit = () => GRID[board()] ?? CM;

  /**
   * Texte lisible sur tous les fonds, même le papier blanc : pastille sombre sous l'étiquette
   * néon, ou simple contour sombre (`outline`) pour les petits nombres serrés des axes.
   */
  function text(ctx, s, x, y, color, alpha, size = 13, outline = false) {
    if (alpha <= 0) return;
    ctx.save();
    ctx.font = `600 ${size}px "Segoe UI", system-ui, sans-serif`;
    ctx.globalAlpha = alpha * 0.8;
    if (outline) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#0a0c12';
      ctx.strokeText(s, x, y);
    } else {
      const w = ctx.measureText(s).width + size * 0.7, h = size * 1.45;
      ctx.fillStyle = '#0a0c12';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
      else ctx.rect(x - w / 2, y - h / 2, w, h);
      ctx.fill();
    }
    ctx.restore();
    api.draw.label(ctx, s, x, y, color, { size, alpha });
  }

  /** Contraint `p` autour de `o` par pas de 15° (et la longueur par pas de `len` s'il est donné). */
  function constrain(o, p, len = 0) {
    const a = Math.round(Math.atan2(p.y - o.y, p.x - o.x) / STEP) * STEP;
    let d = dist(o, p);
    if (len) d = Math.max(len, Math.round(d / len) * len);
    return { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d };
  }

  /** Point visé depuis `o` : aimanté au quadrillage, ou par pas de 15° avec Maj. */
  const aim = (o, p, len = 0) => (shift ? constrain(o, p, len) : api.snap(p));

  // ───────────── Règle : segment gradué ─────────────

  function drawRuler(ctx, o, f) {
    const len = Math.hypot(o.x1 - o.x, o.y1 - o.y);
    if (len < 1) return;
    const ux = (o.x1 - o.x) / len, uy = (o.y1 - o.y) / len;
    // Normale tournée vers le bas (ou vers la gauche pour un segment vertical) : les graduations.
    let nx = -uy, ny = ux;
    if (ny < 0 || (ny === 0 && nx > 0)) (nx = -nx), (ny = -ny);
    const grow = easeOut(f.intro);
    const shown = len * grow;
    const w = lineW(o);
    const path = new Path2D();
    path.moveTo(o.x, o.y);
    path.lineTo(o.x + ux * shown, o.y + uy * shown);
    const ticks = new Path2D();
    for (let k = 0; k * CM / 2 <= shown + 0.5; k++) {
      const at = (k * CM) / 2, t = k % 2 ? 5 : 9;
      ticks.moveTo(o.x + ux * at, o.y + uy * at);
      ticks.lineTo(o.x + ux * at + nx * t, o.y + uy * at + ny * t);
    }
    api.draw.neon(ctx, path, o.color, w, f.life);
    api.draw.neon(ctx, ticks, o.color, Math.max(1, w * 0.5), f.life * 0.9);
    api.draw.glowDot(ctx, o.x, o.y, w * 1.3, o.color, f.life);
    if (grow < 1) return;
    api.draw.glowDot(ctx, o.x1, o.y1, w * 1.3, o.color, f.life);
    const mx = (o.x + o.x1) / 2, my = (o.y + o.y1) / 2;
    text(ctx, cm(len), mx - nx * 18, my - ny * 18, o.color, f.life);
  }

  api.defineObject('regle', {
    center: (o) => ({ x: (o.x + o.x1) / 2, y: (o.y + o.y1) / 2 }),
    hit: (o, p, r) => segDist(p, o, { x: o.x1, y: o.y1 }) < r + 6,
    draw: drawRuler,
  });

  // ───────────── Rapporteur : angle mesuré ─────────────

  function angleOf(o) {
    const a1 = Math.atan2(o.y1 - o.y, o.x1 - o.x), a2 = Math.atan2(o.y2 - o.y, o.x2 - o.x);
    return { a1, d: norm(a2 - a1) };
  }

  function drawAngle(ctx, o, f) {
    const w = lineW(o);
    const grow = easeOut(f.intro);
    const arms = new Path2D();
    arms.moveTo(o.x + (o.x1 - o.x) * grow, o.y + (o.y1 - o.y) * grow);
    arms.lineTo(o.x, o.y);
    if (o.x2 !== undefined) arms.lineTo(o.x + (o.x2 - o.x) * grow, o.y + (o.y2 - o.y) * grow);
    api.draw.neon(ctx, arms, o.color, w, f.life);
    api.draw.glowDot(ctx, o.x, o.y, w * 1.3, o.color, f.life);
    if (o.x2 === undefined) return;
    const { a1, d } = angleOf(o);
    const short = Math.min(dist(o, { x: o.x1, y: o.y1 }), dist(o, { x: o.x2, y: o.y2 }));
    const R = clamp(short * 0.45, 14, 46);
    const arc = new Path2D();
    arc.arc(o.x, o.y, R, a1, a1 + d * grow, d < 0);
    api.draw.neon(ctx, arc, o.color, Math.max(1, w * 0.6), f.life * 0.95);
    const deg = Math.round((Math.abs(d) * 180) / Math.PI);
    const mid = a1 + d / 2;
    const at = R + 22;
    text(ctx, `${deg}°`, o.x + Math.cos(mid) * at, o.y + Math.sin(mid) * at, o.color, f.life * grow);
  }

  api.defineObject('rapporteur', {
    center: (o) => o,
    hit: (o, p, r) => segDist(p, o, { x: o.x1, y: o.y1 }) < r + 6 || segDist(p, o, { x: o.x2, y: o.y2 }) < r + 6,
    draw: drawAngle,
  });

  // ───────────── Compas : cercle et rayon ─────────────

  function drawCircle(ctx, o, f) {
    const w = lineW(o);
    const r = Math.hypot(o.x1 - o.x, o.y1 - o.y);
    if (r < 1) return;
    const a = Math.atan2(o.y1 - o.y, o.x1 - o.x);
    const grow = easeOut(f.intro);
    const circle = new Path2D();
    circle.arc(o.x, o.y, r, a, a + TAU * grow);
    api.draw.neon(ctx, circle, o.color, w, f.life);
    const radius = new Path2D();
    radius.moveTo(o.x, o.y);
    radius.lineTo(o.x1, o.y1);
    api.draw.neon(ctx, radius, o.color, Math.max(1, w * 0.6), f.life * 0.9, 0, { width: Math.max(2, w * 0.8) });
    // Centre marqué d'une petite croix.
    const c = new Path2D();
    c.moveTo(o.x - 5, o.y - 5);
    c.lineTo(o.x + 5, o.y + 5);
    c.moveTo(o.x + 5, o.y - 5);
    c.lineTo(o.x - 5, o.y + 5);
    api.draw.neon(ctx, c, o.color, Math.max(1, w * 0.6), f.life);
    api.draw.glowDot(ctx, o.x1, o.y1, w * 1.1, o.color, f.life);
    // Étiquette au milieu du rayon, décalée sur le côté (au-dessus si possible).
    let nx = -Math.sin(a), ny = Math.cos(a);
    if (ny > 0 || (ny === 0 && nx > 0)) (nx = -nx), (ny = -ny);
    const off = r < 70 ? 16 : 18;
    text(ctx, `r = ${cm(r)}`, (o.x + o.x1) / 2 + nx * off, (o.y + o.y1) / 2 + ny * off, o.color, f.life * grow);
  }

  api.defineObject('compas', {
    center: (o) => o,
    hit(o, p, r) {
      const R = Math.hypot(o.x1 - o.x, o.y1 - o.y);
      return Math.abs(dist(o, p) - R) < r + 6 || segDist(p, o, { x: o.x1, y: o.y1 }) < r + 4;
    },
    draw: drawCircle,
  });

  // ───────────── Repère : axes gradués ─────────────

  /** Repère d'origine `a`, dont `b` fixe la taille ; `all` : les quatre quarts. */
  function frame(a, b, all) {
    const u = unit();
    const nx = Math.max(1, Math.round(Math.abs(b.x - a.x) / u));
    const ny = Math.max(1, Math.round(Math.abs(b.y - a.y) / u));
    return { x: a.x, y: a.y, u, xmin: all ? -nx : 0, xmax: nx, ymin: all ? -ny : 0, ymax: ny };
  }

  function drawFrame(ctx, o, f) {
    const { x, y, u } = o;
    const w = lineW(o);
    const grow = easeOut(f.intro);
    const X = (i) => x + i * u * grow, Y = (j) => y - j * u * grow;
    const tail = u * 0.4, head = Math.max(16, u * 0.7);
    const axes = new Path2D();
    const ah = 7 + w;
    // Axe des abscisses, flèche à droite.
    const xr = X(o.xmax) + head;
    axes.moveTo(X(o.xmin) - tail, y);
    axes.lineTo(xr, y);
    axes.moveTo(xr - ah, y - ah * 0.6);
    axes.lineTo(xr, y);
    axes.lineTo(xr - ah, y + ah * 0.6);
    // Axe des ordonnées, flèche en haut.
    const yt = Y(o.ymax) - head;
    axes.moveTo(x, Y(o.ymin) + tail);
    axes.lineTo(x, yt);
    axes.moveTo(x - ah * 0.6, yt + ah);
    axes.lineTo(x, yt);
    axes.lineTo(x + ah * 0.6, yt + ah);
    api.draw.neon(ctx, axes, o.color, w, f.life);
    const ticks = new Path2D();
    for (let i = o.xmin; i <= o.xmax; i++) {
      if (!i) continue;
      ticks.moveTo(X(i), y - 5);
      ticks.lineTo(X(i), y + 5);
    }
    for (let j = o.ymin; j <= o.ymax; j++) {
      if (!j) continue;
      ticks.moveTo(x - 5, Y(j));
      ticks.lineTo(x + 5, Y(j));
    }
    api.draw.neon(ctx, ticks, o.color, Math.max(1, w * 0.55), f.life * 0.9);
    if (grow < 1) return;
    // Nombres : un sur deux si les graduations sont trop serrées.
    const size = u < 25 ? 11 : 12;
    // Sur l'axe des abscisses, les nombres négatifs sont plus larges : un sur deux si c'est serré.
    const every = u < 16 ? 2 : 1;
    const everyX = o.xmin < 0 && u < 25 ? 2 : every;
    // −1 se cache s'il chevaucherait le O de l'origine.
    for (let i = o.xmin; i <= o.xmax; i++) if (i && i % everyX === 0 && !(i === -1 && u < 34)) text(ctx, fr(i), X(i), y + 14, o.color, f.life, size, true);
    for (let j = o.ymin; j <= o.ymax; j++) if (j && j % every === 0 && !(j === -1 && u < 26)) text(ctx, fr(j), x - 9 - String(Math.abs(j)).length * 3.5 - (j < 0 ? 4 : 0), Y(j), o.color, f.life, size, true);
    text(ctx, 'O', x - 9, y + 13, o.color, f.life, size, true);
    text(ctx, 'x', xr + 11, y, o.color, f.life, size + 2, true);
    text(ctx, 'y', x, yt - 12, o.color, f.life, size + 2, true);
  }

  api.defineObject('repere', {
    center: (o) => o,
    hit(o, p, r) {
      const ext = Math.max(16, o.u * 0.7);
      return (
        segDist(p, { x: o.x + o.xmin * o.u - o.u * 0.4, y: o.y }, { x: o.x + o.xmax * o.u + ext, y: o.y }) < r + 6 ||
        segDist(p, { x: o.x, y: o.y - o.ymin * o.u + o.u * 0.4 }, { x: o.x, y: o.y - o.ymax * o.u - ext }) < r + 6
      );
    },
    draw: drawFrame,
  });

  // ───────────── Angle droit : petit carré ─────────────

  function drawSquare(ctx, o, f) {
    const s = o.s * easeOut(f.intro);
    const ux = Math.cos(o.a - Math.PI / 4) * s, uy = Math.sin(o.a - Math.PI / 4) * s;
    const vx = Math.cos(o.a + Math.PI / 4) * s, vy = Math.sin(o.a + Math.PI / 4) * s;
    const p = new Path2D();
    p.moveTo(o.x + ux, o.y + uy);
    p.lineTo(o.x + ux + vx, o.y + uy + vy);
    p.lineTo(o.x + vx, o.y + vy);
    api.draw.neon(ctx, p, o.color, Math.max(1.2, lineW(o) * 0.7), f.life);
  }

  api.defineObject('angle', {
    center: (o) => ({ x: o.x + Math.cos(o.a) * o.s * 0.7, y: o.y + Math.sin(o.a) * o.s * 0.7 }),
    hit: (o, p, r) => dist(p, { x: o.x + Math.cos(o.a) * o.s * 0.7, y: o.y + Math.sin(o.a) * o.s * 0.7 }) < o.s * 0.8 + r,
    draw: drawSquare,
  });

  // ───────────── Outil ─────────────

  const squareSize = () => Math.round(10 + api.width * 1.4);

  /** Objet que donnerait le geste en cours (règle, compas, repère, angle droit), ou null. */
  function pending() {
    if (!drag) return null;
    const { a, b, moved } = drag;
    switch (MODES[mode].id) {
      case 'regle': {
        if (!moved || dist(a, b) < 2) return null;
        return { type: 'regle', x: a.x, y: a.y, x1: b.x, y1: b.y };
      }
      case 'compas': {
        if (!moved || dist(a, b) < 4) return null;
        return { type: 'compas', x: a.x, y: a.y, x1: b.x, y1: b.y };
      }
      case 'repere': {
        if (!moved) return null;
        return { type: 'repere', ...frame(a, b, shift) };
      }
      case 'angle': {
        const ang = moved && dist(a, b) >= 4 ? Math.atan2(b.y - a.y, b.x - a.x) : -Math.PI / 4;
        return { type: 'angle', x: a.x, y: a.y, a: ang, s: squareSize() };
      }
    }
    return null;
  }

  /** Point d'arrivée du glisser selon l'instrument (longueur au demi-cm pour la règle avec Maj). */
  function dragEnd(p) {
    const id = MODES[mode].id;
    if (id === 'repere') return p;
    return aim(drag.a, p, id === 'regle' ? CM / 2 : 0);
  }

  const DRAWERS = { regle: drawRuler, rapporteur: drawAngle, compas: drawCircle, repere: drawFrame, angle: drawSquare };

  function ghost(ctx, o, now) {
    const full = { ...o, color: api.color, width: api.width };
    DRAWERS[o.type](ctx, full, { now, age: 1e9, intro: 1, life: 0.75 });
  }

  function reset() {
    drag = null;
    proto = null;
  }

  function wheel() {
    api.wheel({
      items: MODES.map((m) => ({ label: m.label, draw: (ctx, x, y, s, color, alpha) => icon(ctx, m.id, x, y, s, color, alpha) })),
      selected: mode,
      onPick(i) {
        mode = i;
        reset();
        api.useTool('geometrie');
        api.refreshHud();
        api.render();
      },
    });
  }

  /** Icônes de la roue, centrées sur (x, y), de demi-taille `s`. */
  function icon(ctx, id, x, y, s, color, alpha) {
    const p = new Path2D();
    if (id === 'regle') {
      p.rect(x - s * 1.2, y - s * 0.35, s * 2.4, s * 0.7);
      for (let k = 0; k <= 8; k++) {
        const tx = x - s * 1.2 + (k * s * 2.4) / 8;
        p.moveTo(tx, y - s * 0.35);
        p.lineTo(tx, y - s * (k % 2 ? 0.15 : 0.02));
      }
    } else if (id === 'rapporteur') {
      p.arc(x, y + s * 0.5, s * 1.1, Math.PI, 0);
      p.closePath();
      p.moveTo(x + s * 0.45, y + s * 0.5);
      p.arc(x, y + s * 0.5, s * 0.45, 0, -Math.PI * 0.75, true);
      p.moveTo(x, y + s * 0.5);
      p.lineTo(x + Math.cos(-Math.PI * 0.75) * s * 1.1, y + s * 0.5 + Math.sin(-Math.PI * 0.75) * s * 1.1);
    } else if (id === 'compas') {
      p.arc(x, y, s, 0, TAU);
      p.moveTo(x, y);
      p.lineTo(x + s * 0.7, y - s * 0.7);
      p.moveTo(x - 3, y - 3);
      p.lineTo(x + 3, y + 3);
      p.moveTo(x + 3, y - 3);
      p.lineTo(x - 3, y + 3);
    } else if (id === 'repere') {
      const o = { x: x - s * 0.8, y: y + s * 0.8 };
      p.moveTo(o.x - 4, o.y);
      p.lineTo(x + s * 1.1, o.y);
      p.lineTo(x + s * 0.8, o.y - 4);
      p.moveTo(x + s * 1.1, o.y);
      p.lineTo(x + s * 0.8, o.y + 4);
      p.moveTo(o.x, o.y + 4);
      p.lineTo(o.x, y - s * 1.1);
      p.lineTo(o.x - 4, y - s * 0.8);
      p.moveTo(o.x, y - s * 1.1);
      p.lineTo(o.x + 4, y - s * 0.8);
      for (let k = 1; k <= 3; k++) {
        p.moveTo(o.x + k * s * 0.45, o.y - 3);
        p.lineTo(o.x + k * s * 0.45, o.y + 3);
        p.moveTo(o.x - 3, o.y - k * s * 0.45);
        p.lineTo(o.x + 3, o.y - k * s * 0.45);
      }
    } else {
      p.moveTo(x - s, y - s);
      p.lineTo(x - s, y + s);
      p.lineTo(x + s, y + s);
      p.moveTo(x - s, y + s * 0.1);
      p.lineTo(x - s * 0.1, y + s * 0.1);
      p.lineTo(x - s * 0.1, y + s);
    }
    api.draw.neon(ctx, p, color, 2, alpha);
  }

  function crosshair(ctx, p, alpha = 0.8) {
    const c = new Path2D();
    c.moveTo(p.x - 8, p.y);
    c.lineTo(p.x + 8, p.y);
    c.moveTo(p.x, p.y - 8);
    c.lineTo(p.x, p.y + 8);
    api.draw.neon(ctx, c, api.color, 1.2, alpha);
  }

  api.defineTool('geometrie', {
    wheel,
    label: () => `Géométrie : ${MODES[mode].icon} ${MODES[mode].label}`,
    busy: () => !!drag || !!proto,
    down(p, e) {
      shift = !!e?.shiftKey;
      if (MODES[mode].id === 'rapporteur') {
        if (!proto) proto = { pts: [api.snap(p)], hover: api.snap(p), pressed: true };
        return;
      }
      const a = api.snap(p);
      drag = { a, b: a, moved: false };
    },
    move(p, e) {
      if (e) shift = !!e.shiftKey;
      if (proto) {
        proto.hover = aim(proto.pts[0], p);
        if (proto.pressed && dist(proto.hover, proto.pts[0]) >= DRAG) proto.dragging = true;
        api.render();
      } else if (drag) {
        if (dist(drag.a, p) >= DRAG) drag.moved = true;
        drag.b = dragEnd(p);
        api.render();
      }
    },
    up(p, e) {
      if (e) shift = !!e.shiftKey;
      if (proto) {
        const q = aim(proto.pts[0], p);
        const wasPress = proto.pressed;
        proto.pressed = false;
        if (dist(q, proto.pts[0]) < DRAG) return api.render(); // clic sur le sommet : on attend les côtés
        if (proto.pts.length === 1) {
          proto.pts.push(q);
          proto.hover = q;
        } else if (!wasPress || proto.pts.length === 2) {
          const [v, a1] = proto.pts;
          api.add('rapporteur', { x: v.x, y: v.y, x1: a1.x, y1: a1.y, x2: q.x, y2: q.y });
          proto = null;
        }
        return api.render();
      }
      if (!drag) return;
      drag.b = dragEnd(p);
      const o = pending();
      drag = null;
      if (o) {
        const { type, ...data } = o;
        api.add(type, data);
      }
      api.render();
    },
    cancel: reset,
    preview(ctx, now) {
      if (proto) {
        const [v, a1] = proto.pts;
        const h = proto.hover ?? v;
        const o = a1 ? { type: 'rapporteur', x: v.x, y: v.y, x1: a1.x, y1: a1.y, x2: h.x, y2: h.y } : { type: 'rapporteur', x: v.x, y: v.y, x1: h.x, y1: h.y };
        if (dist(h, a1 ?? v) >= 2) ghost(ctx, o, now);
        else ghost(ctx, { type: 'rapporteur', x: v.x, y: v.y, x1: v.x, y1: v.y }, now);
        return;
      }
      const o = pending();
      if (o) ghost(ctx, o, now);
    },
    cursor(ctx, p) {
      if (drag) return;
      crosshair(ctx, proto ? aim(proto.pts[0], p) : api.snap(p));
    },
  });

  api.defineAction('roue', {
    label: 'Roue de géométrie',
    hint: 'Règle, rapporteur, compas, repère, angle droit · Maj : pas de 15° · 1 cm = 2 petits carreaux',
    key: 'Shift+R',
    run: () => wheel(),
  });
}
