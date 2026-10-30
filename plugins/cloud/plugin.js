// Plugin « Cloud » pour NeonInk : schémas d'architecture cloud en néon, avec des services
// génériques animés (machine virtuelle, conteneur, cluster, base de données, stockage objet,
// répartiteur de charge, fonction serverless, file de messages, CDN, passerelle API,
// utilisateurs) reliés par des flux de données, et des régions / zones en pointillés.
//
// Touche U (par défaut) : roue des services. Maintenir U, viser le service, relâcher ;
// ou appuyer sur U puis cliquer sur le service. M (ou clic molette) la rouvre quand l'outil est actif.
//  - clic dans le vide : pose le service choisi (aimanté au quadrillage sur papier à carreaux) ;
//  - glisser d'un service à un autre : les relie (les données circulent du premier vers le second) ;
//  - glisser d'un service vers le vide : pose un nouveau service, déjà relié ;
//  - « Région / zone » : glisser pour tracer le cadre, puis taper son nom ; il passe derrière le reste ;
//  - Maj+clic sur un service ou sur le bord d'une région : renommer.
// Maj+U : animations en pause ou en marche. La gomme efface un service et ses liens.

export const manifest = {
  id: 'cloud',
  nom: 'Cloud',
  description: 'Schémas d’architecture cloud : VM, conteneurs, cluster, base de données, stockage, répartiteur, serverless, file, CDN, API, reliés par des flux animés.',
  version: '1.0.0',
  api: 1,
};

const SERVICES = [
  { kind: 'vm', label: 'Machine virtuelle', icon: '▣', prefix: 'VM ' },
  { kind: 'conteneur', label: 'Conteneur', icon: '◈', prefix: 'Conteneur ' },
  { kind: 'cluster', label: 'Kubernetes', icon: '✲', name: 'Cluster' },
  { kind: 'bdd', label: 'Base de données', icon: '⛁', prefix: 'BDD ' },
  { kind: 'stockage', label: 'Stockage objet', icon: '◡', name: 'Stockage' },
  { kind: 'lb', label: 'Répartiteur de charge', icon: '⋔', name: 'Répartiteur' },
  { kind: 'fonction', label: 'Fonction serverless', icon: 'λ', prefix: 'Fonction ' },
  { kind: 'file', label: 'File de messages', icon: '▥', name: 'File' },
  { kind: 'cdn', label: 'CDN', icon: '◍', name: 'CDN' },
  { kind: 'api', label: 'Passerelle API', icon: '⬡', name: 'API' },
  { kind: 'users', label: 'Utilisateurs', icon: '⚇', name: 'Utilisateurs' },
  { kind: 'region', label: 'Région / zone', icon: '⬚' },
];
const TAU = Math.PI * 2;

const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Flèche de (x0, y0) vers (x1, y1), pointe comprise, ajoutée au chemin `p`. */
function arrowTo(p, x0, y0, x1, y1, head) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  p.moveTo(x0, y0);
  p.lineTo(x1, y1);
  p.moveTo(x1 - head * Math.cos(a - 0.5), y1 - head * Math.sin(a - 0.5));
  p.lineTo(x1, y1);
  p.lineTo(x1 - head * Math.cos(a + 0.5), y1 - head * Math.sin(a + 0.5));
}

function roundRect(p, x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
}

/** Polygone régulier de `n` côtés, de rayon `r`, la première pointe à l'angle `a0`. */
function polygon(p, n, r, a0 = 0) {
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i * TAU) / n;
    if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else p.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  p.closePath();
}

/** Arc d'ellipse ajouté au chemin (sans relier au point précédent). */
function ellipseArc(p, x, y, rx, ry, a0, a1) {
  p.moveTo(x + rx * Math.cos(a0), y + ry * Math.sin(a0));
  p.ellipse(x, y, rx, ry, 0, a0, a1);
}

/** Bonhomme : tête et épaules, centré en (x, y). */
function person(p, x, y, s) {
  p.moveTo(x + s * 0.26, y - s * 0.38);
  p.arc(x, y - s * 0.38, s * 0.26, 0, TAU);
  p.moveTo(x - s * 0.46, y + s * 0.62);
  p.arc(x, y + s * 0.62, s * 0.46, Math.PI, TAU);
}

/**
 * Dessin de chaque service, centré sur (0, 0), de demi-taille `s`. `t` : temps en secondes
 * (0 quand les animations sont en pause). Rend le chemin principal, et au besoin des points
 * lumineux (`dots`), des tracés secondaires (`extra`) et un éclat (`boost`).
 */
const SHAPES = {
  // Puce de processeur : boîtier, broches, cœur qui pulse.
  vm(s, t) {
    const p = new Path2D();
    const h = s * 0.62;
    roundRect(p, -h, -h, h * 2, h * 2, s * 0.12);
    roundRect(p, -s * 0.28, -s * 0.28, s * 0.56, s * 0.56, s * 0.06);
    for (const k of [-0.32, 0, 0.32]) {
      p.moveTo(k * s, -h); p.lineTo(k * s, -s * 0.92);
      p.moveTo(k * s, h); p.lineTo(k * s, s * 0.92);
      p.moveTo(-h, k * s); p.lineTo(-s * 0.92, k * s);
      p.moveTo(h, k * s); p.lineTo(s * 0.92, k * s);
    }
    const pulse = t === 0 ? 0.8 : 0.45 + 0.4 * Math.sin(t * 2.4);
    return { path: p, dots: [{ x: 0, y: 0, r: s * 0.3, a: pulse }] };
  },
  // Conteneur : cube en perspective aux flancs nervurés, qui flotte un peu.
  conteneur(s, t) {
    const p = new Path2D();
    const k = s * 0.92, dy = Math.sin(t * 2) * s * 0.05;
    const c = k * 0.866;
    p.moveTo(0, -k + dy); p.lineTo(c, -k / 2 + dy); p.lineTo(0, dy); p.lineTo(-c, -k / 2 + dy); p.closePath();
    p.moveTo(-c, -k / 2 + dy); p.lineTo(-c, k / 2 + dy); p.lineTo(0, k + dy); p.lineTo(c, k / 2 + dy); p.lineTo(c, -k / 2 + dy);
    p.moveTo(0, dy); p.lineTo(0, k + dy);
    for (const f of [1 / 3, 2 / 3]) {
      p.moveTo(-c * f, -k / 2 + dy + (k / 2) * f + k * 0.12); p.lineTo(-c * f, k / 2 + dy + (k / 2) * f - k * 0.12);
      p.moveTo(c * f, -k / 2 + dy + (k / 2) * f + k * 0.12); p.lineTo(c * f, k / 2 + dy + (k / 2) * f - k * 0.12);
    }
    return { path: p };
  },
  // Cluster : un nœud central relié à six nœuds en anneau, qui tourne lentement.
  cluster(s, t) {
    const p = new Path2D();
    const turn = t * 0.35, R = s * 0.72, r = s * 0.2;
    polygon(p, 6, s * 0.26, turn);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = turn + (i * TAU) / 6 + Math.PI / 6;
      pts.push({ x: Math.cos(a) * R, y: Math.sin(a) * R, a });
    }
    pts.forEach((q, i) => {
      p.moveTo(q.x + r, q.y);
      p.arc(q.x, q.y, r, 0, TAU);
      p.moveTo(Math.cos(q.a) * s * 0.24, Math.sin(q.a) * s * 0.24);
      p.lineTo(q.x - Math.cos(q.a) * r, q.y - Math.sin(q.a) * r);
    });
    // Anneau extérieur en pointillés discrets, dessiné à part.
    const ring = new Path2D();
    ring.arc(0, 0, R, 0, TAU);
    return { path: p, extra: [{ path: ring, alpha: 0.35 }] };
  },
  // Base de données : cylindre à trois disques ; un voyant d'activité clignote.
  bdd(s, t) {
    const p = new Path2D();
    const rx = s * 0.78, ry = s * 0.24, top = -s * 0.68, bot = s * 0.68;
    p.moveTo(rx, top);
    p.ellipse(0, top, rx, ry, 0, 0, TAU);
    p.moveTo(-rx, top); p.lineTo(-rx, bot);
    p.moveTo(rx, top); p.lineTo(rx, bot);
    ellipseArc(p, 0, bot, rx, ry, 0, Math.PI);
    ellipseArc(p, 0, top + (bot - top) / 3, rx, ry, 0, Math.PI);
    ellipseArc(p, 0, top + ((bot - top) * 2) / 3, rx, ry, 0, Math.PI);
    const on = t === 0 || Math.sin(t * 5.3) + Math.sin(t * 2.1) > 0.2;
    return { path: p, dots: on ? [{ x: rx * 0.55, y: top + (bot - top) / 6 + ry * 0.9, r: s * 0.16, a: 1 }] : [] };
  },
  // Seau (stockage objet) : un objet y tombe de temps en temps.
  stockage(s, t) {
    const p = new Path2D();
    const top = -s * 0.5, bot = s * 0.82, rt = s * 0.88, rb = s * 0.62;
    p.moveTo(rt, top);
    p.ellipse(0, top, rt, s * 0.24, 0, 0, TAU);
    p.moveTo(-rt, top); p.lineTo(-rb, bot);
    p.moveTo(rt, top); p.lineTo(rb, bot);
    ellipseArc(p, 0, bot, rb, s * 0.17, 0, Math.PI);
    ellipseArc(p, 0, s * 0.18, (rt + rb) / 2, s * 0.2, 0, Math.PI);
    const dots = [];
    if (t) {
      const ph = (t * 0.6) % 1;
      if (ph < 0.6) dots.push({ x: 0, y: -s * 1.25 + (ph / 0.6) * s * 0.8, r: s * 0.17, a: Math.sin((ph / 0.6) * Math.PI) });
    }
    return { path: p, dots };
  },
  // Répartiteur de charge : un flux entre, trois en sortent ; le trafic passe à tour de rôle.
  lb(s, t) {
    const p = new Path2D();
    p.arc(0, 0, s * 0.95, 0, TAU);
    p.moveTo(-s * 0.68, 0);
    p.lineTo(-s * 0.18, 0);
    const outs = [-0.46, 0, 0.46].map((k) => ({ x: s * 0.6, y: k * s }));
    for (const o of outs) arrowTo(p, -s * 0.18, 0, o.x, o.y, s * 0.2);
    p.moveTo(-s * 0.08, 0);
    p.arc(-s * 0.18, 0, s * 0.1, 0, TAU);
    const dots = [];
    if (t) {
      const ph = t * 1.2, i = Math.floor(ph) % 3, k = ph % 1;
      const pt = k < 0.4 ? { x: -s * 0.68 + (k / 0.4) * s * 0.5, y: 0 } : { x: -s * 0.18 + ((k - 0.4) / 0.6) * (outs[i].x + s * 0.18), y: ((k - 0.4) / 0.6) * outs[i].y };
      dots.push({ ...pt, r: s * 0.17, a: 1 });
    }
    return { path: p, dots };
  },
  // Fonction serverless : λ dans un carré arrondi ; un éclair à chaque appel.
  fonction(s, t) {
    const p = new Path2D();
    roundRect(p, -s * 0.86, -s * 0.86, s * 1.72, s * 1.72, s * 0.3);
    p.moveTo(-s * 0.46, -s * 0.56);
    p.lineTo(-s * 0.22, -s * 0.56);
    p.lineTo(s * 0.44, s * 0.56);
    p.moveTo(-s * 0.02, -s * 0.12);
    p.lineTo(-s * 0.44, s * 0.56);
    const ph = (t * 0.5) % 1;
    return { path: p, boost: t && ph < 0.12 ? Math.sin((ph / 0.12) * Math.PI) * 0.7 : 0 };
  },
  // File de messages : un tube où glissent des messages, de l'entrée vers la sortie.
  file(s, t) {
    const p = new Path2D();
    const w = s * 1.0, h = s * 0.42;
    roundRect(p, -w, -h, w * 2, h * 2, h);
    arrowTo(p, -s * 1.3, 0, -w - s * 0.06, 0, s * 0.16);
    const extra = new Path2D();
    const bw = s * 0.22, bh = s * 0.44, gap = s * 0.42, span = gap * 4;
    for (let i = 0; i < 4; i++) {
      const x = -w + s * 0.24 + (((i * gap + t * s * 0.32) % span) + span) % span;
      if (x + bw > w - s * 0.2) continue;
      roundRect(extra, x, -bh / 2, bw, bh, s * 0.04);
    }
    return { path: p, extra: [{ path: extra, alpha: 0.95 }] };
  },
  // CDN : globe dont un méridien tourne, des points de présence sur le pourtour.
  cdn(s, t) {
    const p = new Path2D();
    const r = s * 0.9;
    p.arc(0, 0, r, 0, TAU);
    p.moveTo(-r, 0); p.lineTo(r, 0);
    for (const k of [-0.5, 0.5]) {
      const y = k * r, half = Math.sqrt(r * r - y * y);
      p.moveTo(-half, y); p.lineTo(half, y);
    }
    p.moveTo(0, -r);
    p.ellipse(0, 0, r * 0.42, r, 0, -Math.PI / 2, Math.PI * 1.5);
    const rx = Math.abs(Math.cos(t * 0.9)) * r;
    if (rx > 2) {
      p.moveTo(0, -r);
      p.ellipse(0, 0, rx, r, 0, -Math.PI / 2, Math.PI * 1.5);
    }
    const dots = [0.3, 2.4, 4.2].map((a, i) => ({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: s * 0.18, a: t === 0 ? 1 : 0.55 + 0.45 * Math.sin(t * 3 + i * 2) }));
    return { path: p, dots };
  },
  // Passerelle API : hexagone et </> dont les chevrons respirent.
  api(s, t) {
    const p = new Path2D();
    polygon(p, 6, s * 0.98, Math.PI / 6);
    const d = Math.sin(t * 2.2) * s * 0.05;
    p.moveTo(-s * 0.2 - d, -s * 0.32); p.lineTo(-s * 0.52 - d, 0); p.lineTo(-s * 0.2 - d, s * 0.32);
    p.moveTo(s * 0.2 + d, -s * 0.32); p.lineTo(s * 0.52 + d, 0); p.lineTo(s * 0.2 + d, s * 0.32);
    p.moveTo(s * 0.1, -s * 0.38); p.lineTo(-s * 0.1, s * 0.38);
    return { path: p };
  },
  // Utilisateurs : deux silhouettes, celle de devant un peu plus grande.
  users(s) {
    const p = new Path2D();
    person(p, -s * 0.38, -s * 0.08, s * 0.82);
    person(p, s * 0.32, s * 0.06, s * 0.96);
    return { path: p };
  },
  // Région : icône de la roue seulement (le cadre posé est dessiné à part).
  region(s) {
    const p = new Path2D();
    roundRect(p, -s, -s * 0.72, s * 2, s * 1.44, s * 0.25);
    return { path: p, dashed: true };
  },
};

export function activate(api) {
  if (!api.prompt) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // service choisi
  let paused = false;
  let linking = null; // { from, to }
  let framing = null; // région en cours : { a, b }
  let editing = false; // saisie d'un nom en cours

  const size = () => 20 + api.width * 2.4;
  const serviceAt = (p) => api.objectAt(p, 6, 'service');
  const regionAt = (p) => api.objectAt(p, 4, 'region');
  const isRegion = () => SERVICES[current].kind === 'region';
  const clock = (now) => (paused ? 0 : now / 1000);

  function nextLabel(kind) {
    const srv = SERVICES.find((d) => d.kind === kind);
    if (!srv.prefix) return srv.name;
    const used = api.objects('service').filter((o) => o.service === kind).map((o) => parseInt(o.label.slice(srv.prefix.length), 10) || 0);
    return `${srv.prefix}${Math.max(0, ...used) + 1}`;
  }

  function addService(p) {
    const at = api.snap(p);
    const kind = SERVICES[current].kind;
    return api.add('service', { x: at.x, y: at.y, size: size(), service: kind, label: nextLabel(kind) });
  }

  function link(a, b) {
    const exists = api.objects('flux').some((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
    if (!exists) api.add('flux', { a: a.id, b: b.id, deps: [a.id, b.id], seed: Math.random() });
  }

  /** Renomme un service ou une région (Maj+clic). */
  async function rename(o, at) {
    editing = true;
    const text = await api.prompt({ x: at.x, y: at.y, value: o.label ?? '', placeholder: 'Nom' });
    editing = false;
    if (text === null || !api.objects().includes(o)) return api.render();
    o.label = text;
    api.changed();
  }

  function drawService(ctx, o, x, y, s, t, alpha, boost = 0) {
    const shape = SHAPES[o.service](s, t);
    ctx.save();
    ctx.translate(x, y);
    const w = Math.max(2, Math.min(4, s / 9));
    api.draw.neon(ctx, shape.path, o.color, w, alpha, boost + (shape.boost ?? 0), shape.dashed ? { width: w * 0.6 } : null);
    for (const e of shape.extra ?? []) api.draw.neon(ctx, e.path, o.color, w * 0.8, alpha * e.alpha);
    for (const d of shape.dots ?? []) api.draw.glowDot(ctx, d.x, d.y, Math.max(d.r, w * 2), o.color, alpha * d.a);
    ctx.restore();
  }

  api.defineObject('service', {
    layer: 1,
    animated: () => !paused,
    center: (o) => o,
    hit: (o, p, r) => Math.abs(p.x - o.x) < o.size * 1.05 + r && Math.abs(p.y - o.y) < o.size * 1.05 + r,
    draw(ctx, o, f) {
      const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(f.intro)) : 1;
      drawService(ctx, o, o.x, o.y, o.size * pop, clock(f.now), f.life, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
      api.draw.label(ctx, o.label, o.x, o.y + o.size * 1.15 + 12, o.color, { alpha: f.life * Math.min(1, f.intro * 2) });
    },
  });

  // Région / zone : grand cadre arrondi en pointillés qui défilent lentement, nom en haut à gauche.
  const box = (o) => ({ x: Math.min(o.x, o.x2), y: Math.min(o.y, o.y2), w: Math.abs(o.x2 - o.x), h: Math.abs(o.y2 - o.y) });

  function drawRegion(ctx, o, alpha, grow, now, color = o.color) {
    const b = box(o);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const w = b.w * grow, h = b.h * grow;
    const path = new Path2D();
    roundRect(path, cx - w / 2, cy - h / 2, w, h, 18);
    ctx.save();
    ctx.globalAlpha = alpha * 0.07;
    ctx.fillStyle = color.hex;
    ctx.fill(path);
    ctx.restore();
    const offset = paused || now == null ? 0 : -(now / 1000) * 14;
    api.draw.neon(ctx, path, color, 2, alpha * 0.85, 0, { width: 2, offset });
  }

  api.defineObject('region', {
    layer: -1,
    animated: () => !paused,
    center: (o) => ({ x: (o.x + o.x2) / 2, y: (o.y + o.y2) / 2 }),
    // La gomme et le Maj+clic ne prennent la région que par son bord ou son nom.
    hit(o, p, r) {
      const b = box(o);
      const inX = p.x > b.x - r - 6 && p.x < b.x + b.w + r + 6, inY = p.y > b.y - r - 6 && p.y < b.y + b.h + r + 6;
      if (!inX || !inY) return false;
      const edge = Math.min(Math.abs(p.x - b.x), Math.abs(p.x - b.x - b.w), Math.abs(p.y - b.y), Math.abs(p.y - b.y - b.h));
      const onLabel = o.label && p.x < b.x + 30 + o.label.length * 9 && p.y < b.y + 34;
      return edge < r + 6 || !!onLabel;
    },
    draw(ctx, o, f) {
      const grow = f.intro < 1 ? 0.85 + 0.15 * easeOutBack(f.intro) : 1;
      drawRegion(ctx, o, f.life, grow, f.now);
      const b = box(o);
      if (o.label) {
        ctx.save();
        ctx.font = '600 14px "Segoe UI", system-ui, sans-serif';
        const tw = ctx.measureText(o.label).width;
        ctx.restore();
        api.draw.label(ctx, o.label, b.x + 16 + tw / 2, b.y + 18, o.color, { size: 14, alpha: f.life * Math.min(1, f.intro * 2) });
      }
    },
  });

  // Flux : trait fin d'un service vers un autre, pointe à l'arrivée, données qui y circulent.
  function ends(o) {
    const objs = api.objects('service');
    const a = objs.find((d) => d.id === o.a), b = objs.find((d) => d.id === o.b);
    if (!a || !b) return null;
    const d = dist(a, b) || 1;
    const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    // Rayon de sortie : bord du carré englobant, pour suivre la forme mieux qu'un cercle.
    const rad = (s) => s * 1.08 / Math.max(Math.abs(ux), Math.abs(uy), 0.7) * 0.85 + 6;
    // Vers le bas, le flux sort sous le nom du service (et y arrive par le bas, de même).
    const ra = rad(a.size) + 20 * Math.max(0, uy), rb = rad(b.size) + 20 * Math.max(0, -uy);
    if (d < ra + rb + 8) return null;
    return { x0: a.x + ux * ra, y0: a.y + uy * ra, x1: b.x - ux * rb, y1: b.y - uy * rb, len: d - ra - rb, ux, uy };
  }

  api.defineObject('flux', {
    layer: 0,
    animated: () => !paused,
    center(o) {
      const e = ends(o);
      return e && { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 };
    },
    hit(o, p, r) {
      const e = ends(o);
      if (!e) return false;
      const dx = e.x1 - e.x0, dy = e.y1 - e.y0;
      const k = Math.max(0, Math.min(1, ((p.x - e.x0) * dx + (p.y - e.y0) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(p.x - (e.x0 + dx * k), p.y - (e.y0 + dy * k)) < r + 4;
    },
    draw(ctx, o, f) {
      const e = ends(o);
      if (!e) return;
      // Le flux se trace depuis le premier service.
      const grow = Math.min(1, f.intro * 1.6);
      const x = e.x0 + (e.x1 - e.x0) * grow, y = e.y0 + (e.y1 - e.y0) * grow;
      const w = Math.max(1.5, o.width * 0.5);
      const path = new Path2D();
      const head = Math.min(12, e.len * 0.3) + w;
      arrowTo(path, e.x0, e.y0, x, y, head * grow);
      api.draw.neon(ctx, path, o.color, w, f.life * 0.9, 0, o.dash ? { width: w } : null);
      if (paused || grow < 1) return;
      // Paquets de données : trois points serrés qui filent vers l'arrivée.
      const t = f.now / 1000;
      const gap = 120, speed = 110;
      const shift = (t * speed + o.seed * gap) % gap;
      for (let at = shift; at < e.len - head; at += gap) {
        for (let j = 0; j < 3; j++) {
          const q = at - j * (w * 3.2);
          if (q < 0) continue;
          api.draw.glowDot(ctx, e.x0 + e.ux * q, e.y0 + e.uy * q, w * (2.8 - j * 0.6), o.color, f.life * (0.95 - j * 0.25));
        }
      }
    },
  });

  /** Roue des services (touche U, ou touche des formes quand l'outil cloud est actif). */
  function serviceWheel() {
    api.wheel({
      items: SERVICES.map((d) => ({
        label: d.label,
        draw: (ctx, x, y, s, color, alpha, now) => drawService(ctx, { service: d.kind, color }, x, y, s, clock(now), alpha),
      })),
      selected: current,
      onPick(i) {
        current = i;
        api.useTool('cloud');
        api.refreshHud();
      },
    });
  }

  api.defineTool('cloud', {
    wheel: serviceWheel,
    label: () => `Cloud : ${SERVICES[current].icon} ${SERVICES[current].label}`,
    busy: () => !!linking || !!framing || editing,
    down(p, e) {
      if (e?.shiftKey) {
        // Maj+clic : renommer (la saisie s'ouvre au relâchement, pour garder le focus).
        e.preventDefault?.();
        return;
      }
      const from = serviceAt(p);
      if (from) linking = { from, to: p };
      else if (isRegion()) framing = { a: api.snap(p), b: p };
      else addService(p);
    },
    move(p) {
      if (linking) linking.to = p;
      else if (framing) framing.b = api.snap(p);
      else return;
      api.render();
    },
    up(p, e) {
      if (e?.shiftKey && !linking && !framing) {
        const o = serviceAt(p) ?? regionAt(p);
        if (o) rename(o, o.service ? { x: o.x, y: o.y + o.size * 1.15 } : p);
        return;
      }
      if (framing) {
        const { a, b } = framing;
        framing = null;
        if (Math.abs(b.x - a.x) < 40 || Math.abs(b.y - a.y) < 40) {
          api.toast('Région : glisser pour tracer le cadre');
          return api.render();
        }
        const o = api.add('region', { x: a.x, y: a.y, x2: b.x, y2: b.y, label: '' });
        const bx = box(o);
        editing = true;
        api.prompt({ x: bx.x + 130, y: bx.y, placeholder: 'Nom de la région (facultatif)' }).then((text) => {
          editing = false;
          if (text && api.objects().includes(o)) {
            o.label = text;
            api.changed();
          } else api.render();
        });
        return;
      }
      if (!linking) return;
      const { from } = linking;
      linking = null;
      if (dist(from, p) < from.size * 1.1) return api.render(); // simple clic sur un service
      const to = serviceAt(p) ?? (isRegion() ? null : addService(p));
      if (to && to !== from) link(from, to);
      api.render();
    },
    cancel() {
      linking = null;
      framing = null;
    },
    preview(ctx, now) {
      if (framing) {
        drawRegion(ctx, { x: framing.a.x, y: framing.a.y, x2: framing.b.x, y2: framing.b.y }, 0.6, 1, now, api.color);
        return;
      }
      if (!linking) return;
      const path = new Path2D();
      arrowTo(path, linking.from.x, linking.from.y, linking.to.x, linking.to.y, 12);
      api.draw.neon(ctx, path, api.color, 2, 0.6, 0, { width: 2 });
    },
    cursor(ctx, p, now) {
      if (linking || framing || editing) return;
      const over = serviceAt(p);
      if (over) {
        // Au-dessus d'un service : un anneau invite à glisser pour le relier.
        const ring = new Path2D();
        ring.arc(over.x, over.y, over.size * 1.4 + Math.sin(now / 160) * 2, 0, TAU);
        api.draw.neon(ctx, ring, over.color, 1.5, 0.7, 0, { width: 1.5 });
        return;
      }
      const at = api.snap(p);
      if (isRegion()) {
        // Coin de départ du cadre.
        const c = new Path2D();
        c.moveTo(at.x, at.y + 22); c.lineTo(at.x, at.y); c.lineTo(at.x + 22, at.y);
        api.draw.neon(ctx, c, api.color, 2, 0.6);
        return;
      }
      drawService(ctx, { service: SERVICES[current].kind, color: api.color }, at.x, at.y, size(), clock(now), 0.4);
    },
  });

  api.defineAction('roue', {
    label: 'Roue cloud',
    hint: 'Maintenir et relâcher sur un service, ou appuyer puis cliquer · glisser d’un service à l’autre : relier · Maj+clic : renommer',
    key: 'U',
    run: () => serviceWheel(),
  });

  api.defineAction('animation', {
    label: 'Cloud : animations en pause / en marche',
    key: 'Shift+U',
    run() {
      paused = !paused;
      api.toast(paused ? 'Cloud : animations en pause' : 'Cloud : animations en marche');
      api.changed();
    },
  });
}
