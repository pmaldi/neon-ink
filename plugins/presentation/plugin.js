// Plugin « Présentation » pour NeonInk : des pointeurs de présentateur, sans rien laisser à
// l'écran. Rien n'est ajouté aux dessins : ni annulation, ni gomme, tout disparaît en
// changeant d'outil (D, E…) ou en quittant le dessin.
//
// Touche A (par défaut) : roue de présentation. Maintenir A, viser, relâcher ; ou appuyer sur A
// puis cliquer. La touche des formes (M, clic molette) rouvre la roue tant que le mode est actif.
//  - Spot : l'écran s'assombrit sauf un cercle autour du pointeur. La molette (ou + / −)
//    agrandit ou réduit le cercle, comme elle change l'épaisseur du trait.
//  - Loupe : une lentille ×2 suit le pointeur et grossit l'écran (Windows uniquement : l'image
//    est prise quand on choisit la loupe ; la rechoisir pour la rafraîchir). Molette : taille.
//  - Laser : le pointeur laisse une traînée lumineuse qui s'éteint en une demi-seconde.
//  - Rideau : un cache opaque couvre l'écran ; glisser vers le bas le fait descendre et révèle
//    le haut, comme la feuille posée sur un rétroprojecteur. Glisser vers le haut le remonte.

export const manifest = {
  id: 'presentation',
  nom: 'Présentation',
  description: 'Pointeurs de présentateur : spot, loupe, laser et rideau, sans rien laisser à l’écran.',
  version: '1.0.0',
  api: 1,
};

const TAU = Math.PI * 2;
const MODES = [
  { kind: 'spot', label: 'Spot', icon: '◉' },
  { kind: 'loupe', label: 'Loupe', icon: '⊕' },
  { kind: 'laser', label: 'Laser', icon: '✦' },
  { kind: 'rideau', label: 'Rideau', icon: '▤' },
];
const LASER_LIFE = 600; // durée de la traînée du laser, en ms
const ZOOM = 2;

export function activate(api) {
  if (!api.defineOverlay) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // mode choisi dans la roue
  let shot = null; // capture de l'écran pour la loupe (canvas en pixels physiques)
  let shooting = false;
  let warned = false;
  let trail = []; // points du laser { x, y, t }
  let reveal = 0; // rideau : hauteur dévoilée, en pixels CSS
  let drag = null; // rideau : { y, reveal } au début du glisser

  const mode = () => MODES[current].kind;
  const on = () => api.drawing !== false && api.toolActive('presentation');
  const here = (pointer) => pointer ?? api.pointer ?? { x: api.size.w / 2, y: api.size.h / 2 };
  // L'épaisseur du trait (2 à 24, molette ou + / −) règle la taille du spot et de la loupe.
  const spotRadius = () => 70 + api.width * 11;
  const lensRadius = () => 60 + api.width * 8;
  const laserColor = () => api.palette.r;

  async function capture() {
    if (shooting) return;
    shooting = true;
    shot = null;
    try {
      shot = await api.screen();
    } catch (err) {
      console.error(err);
      shot = null;
    }
    shooting = false;
    if (!shot && !warned) {
      warned = true;
      api.toast('Loupe : version Windows uniquement', 2500);
    }
    api.render();
  }

  function start(i) {
    current = i;
    trail = [];
    drag = null;
    if (mode() === 'rideau') reveal = 0;
    if (mode() === 'loupe') capture();
    api.useTool('presentation');
    api.refreshHud();
    api.render();
  }

  // ───────── Dessins ─────────

  function drawSpot(ctx, p) {
    const { w, h } = api.size;
    const r = spotRadius();
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 1.12);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.82, 'rgba(0,0,0,0)');
    g.addColorStop(0.92, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const ring = new Path2D();
    ring.arc(p.x, p.y, r * 0.9, 0, TAU);
    api.draw.neon(ctx, ring, api.color, 1.5, 0.75);
  }

  /** Copie agrandie du canvas `src` (`scale` pixels par pixel CSS), centrée sur `p`. */
  function magnify(ctx, src, scale, p, r) {
    if (!src || !src.width) return;
    const half = r / ZOOM; // demi-côté de la zone source, en pixels CSS
    ctx.drawImage(src, (p.x - half) * scale, (p.y - half) * scale, half * 2 * scale, half * 2 * scale, p.x - r, p.y - r, r * 2, r * 2);
  }

  function drawLoupe(ctx, p, now) {
    const r = lensRadius();
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, TAU);
    ctx.clip();
    ctx.fillStyle = 'rgba(8,10,18,0.92)';
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.imageSmoothingQuality = 'high';
    // L'écran (capture en pixels physiques : son échelle est celle de l'écran, pas forcément dpr).
    if (shot) magnify(ctx, shot, shot.width / api.size.w || dpr, p, r);
    // Les dessins aussi, pour que la loupe montre ce que voit le public.
    const board = document.getElementById('board');
    if (api.board && board) magnify(ctx, board, board.width / api.size.w || dpr, p, r);
    const drawings = document.getElementById('static');
    if (drawings) magnify(ctx, drawings, drawings.width / api.size.w || dpr, p, r);
    if (shooting) api.draw.label(ctx, 'Capture…', p.x, p.y, api.color, { size: 13, alpha: 0.7 });
    ctx.restore();
    // Monture néon et léger reflet.
    const rim = new Path2D();
    rim.arc(p.x, p.y, r, 0, TAU);
    api.draw.neon(ctx, rim, api.color, 3, 1, 0.15 + Math.sin(now / 400) * 0.05);
    const glint = new Path2D();
    glint.arc(p.x, p.y, r * 0.86, Math.PI * 1.08, Math.PI * 1.38);
    api.draw.neon(ctx, glint, api.palette.w, 1.5, 0.35);
    api.draw.label(ctx, `×${ZOOM}`, p.x + r * 0.72, p.y + r * 0.82, api.color, { size: 12, alpha: 0.85 });
  }

  function drawLaser(ctx, p, now) {
    trail = trail.filter((q) => now - q.t < LASER_LIFE);
    const color = laserColor();
    // Traînée : des segments de plus en plus fins et pâles avec l'âge.
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1], b = trail[i];
      const k = 1 - (now - b.t) / LASER_LIFE;
      if (k <= 0) continue;
      const seg = new Path2D();
      seg.moveTo(a.x, a.y);
      seg.lineTo(b.x, b.y);
      api.draw.neon(ctx, seg, color, 1 + 5 * k, k * k, 0.2 * k);
    }
    const pulse = 0.9 + Math.sin(now / 90) * 0.1;
    api.draw.glowDot(ctx, p.x, p.y, 16 * pulse, color, 1);
    api.draw.glowDot(ctx, p.x, p.y, 5, api.palette.w, 0.95);
  }

  function drawCurtain(ctx, now) {
    const { w, h } = api.size;
    const y = Math.max(0, Math.min(h, reveal));
    if (y >= h) return;
    // Cache opaque, avec une ombre douce au bord.
    const shade = ctx.createLinearGradient(0, y - 18, 0, y);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, y - 18, w, 18);
    ctx.fillStyle = '#07080d';
    ctx.fillRect(0, y, w, h - y);
    // Bord néon et poignée centrale.
    const edge = new Path2D();
    edge.moveTo(0, y + 1);
    edge.lineTo(w, y + 1);
    api.draw.neon(ctx, edge, api.color, 2, 0.85);
    const grip = new Path2D();
    for (const dy of [9, 15]) {
      grip.moveTo(w / 2 - 22, y + dy);
      grip.lineTo(w / 2 + 22, y + dy);
    }
    api.draw.neon(ctx, grip, api.color, 2, 0.6);
    if (!drag && y < h - 80) {
      const a = 0.75 + Math.sin(now / 500) * 0.2;
      api.draw.label(ctx, 'Glisser vers le bas pour dévoiler', w / 2, y + 44, api.color, { size: 14, alpha: a });
    }
  }

  api.defineOverlay('pointeur', {
    active: on,
    draw(ctx, now, pointer) {
      const p = here(pointer);
      if (mode() === 'spot') drawSpot(ctx, p);
      else if (mode() === 'loupe') drawLoupe(ctx, p, now);
      else if (mode() === 'laser') drawLaser(ctx, p, now);
      else drawCurtain(ctx, now);
    },
  });

  // ───────── Roue et outil ─────────

  /** Icône de chaque mode dans la roue. */
  function drawIcon(ctx, kind, x, y, s, color, alpha) {
    const p = new Path2D();
    if (kind === 'spot') {
      p.arc(x, y, s * 0.55, 0, TAU);
      p.moveTo(x + s * 1.05, y);
      p.arc(x, y, s * 1.05, 0, TAU);
    } else if (kind === 'loupe') {
      p.arc(x - s * 0.2, y - s * 0.2, s * 0.65, 0, TAU);
      p.moveTo(x + s * 0.27, y + s * 0.27);
      p.lineTo(x + s * 0.95, y + s * 0.95);
    } else if (kind === 'laser') {
      p.moveTo(x - s, y + s * 0.6);
      p.quadraticCurveTo(x - s * 0.2, y + s * 0.7, x + s * 0.45, y - s * 0.35);
      api.draw.neon(ctx, p, color, 2.5, alpha * 0.6);
      api.draw.glowDot(ctx, x + s * 0.5, y - s * 0.4, s * 0.7, color, alpha);
      return;
    } else {
      p.rect(x - s, y - s, s * 2, s * 2);
      p.moveTo(x - s, y - s * 0.1);
      p.lineTo(x + s, y - s * 0.1);
      for (const k of [0.35, 0.75]) {
        p.moveTo(x - s * 0.7, y - s + s * k * 0.9 - s * 0.1);
        p.lineTo(x + s * 0.7, y - s + s * k * 0.9 - s * 0.1);
      }
    }
    api.draw.neon(ctx, p, color, 2.5, alpha);
  }

  function presentationWheel() {
    api.wheel({
      items: MODES.map((m) => ({ label: m.label, draw: (ctx, x, y, s, color, alpha) => drawIcon(ctx, m.kind, x, y, s, color, alpha) })),
      selected: current,
      onPick: start,
    });
  }

  api.defineTool('presentation', {
    wheel: presentationWheel,
    label: () => `Présentation : ${MODES[current].icon} ${MODES[current].label}`,
    busy: () => !!drag,
    down(p) {
      if (mode() === 'rideau') drag = { y: p.y, reveal };
      if (mode() === 'laser') trail.push({ x: p.x, y: p.y, t: performance.now() });
    },
    move(p) {
      if (mode() === 'laser') trail.push({ x: p.x, y: p.y, t: performance.now() });
      if (drag) reveal = Math.max(0, Math.min(api.size.h, drag.reveal + p.y - drag.y));
      api.render();
    },
    up() {
      drag = null;
      api.render();
    },
    cancel() {
      drag = null;
    },
    // Le calque dessine déjà le pointeur ; on n'ajoute qu'un petit point pour le spot et le rideau.
    cursor(ctx, p) {
      if (mode() === 'spot' || mode() === 'rideau') api.draw.glowDot(ctx, p.x, p.y, 6, api.color, 0.8);
    },
  });

  api.defineAction('presentation', {
    label: 'Roue de présentation',
    hint: 'Spot, loupe, laser, rideau · molette : taille du spot et de la loupe · D, E… : quitter',
    key: 'A',
    run: presentationWheel,
  });
}
