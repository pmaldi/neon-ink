// Plugin « Isométrique » pour NeonInk : schémas d'infrastructure en perspective isométrique,
// à la manière d'IsoFlow, en volumes néon (serveur, switch, routeur, PC, pare-feu, base de
// données, cloud, conteneur, utilisateur) reliés par des chemins où circulent des paquets.
//
// Maj+I (par défaut) : roue des éléments. Maintenir Maj+I, viser l'élément, relâcher ; ou appuyer
// puis cliquer. Quand l'outil est actif, la touche des formes (M, clic molette) rouvre la roue.
//  - clic dans le vide : pose l'élément choisi (au centre d'une case si la grille est affichée) ;
//  - glisser d'un élément à un autre : les relie par un chemin en L qui suit les deux axes iso ;
//  - glisser d'un élément vers le vide : pose un nouvel élément, déjà relié ;
//  - Maj+clic sur un élément : le nommer (le nom s'affiche dessous) ; Maj+clic dans le vide :
//    poser un élément et le nommer aussitôt.
// Alt+I : grille isométrique (lignes à 30°) affichée ou masquée ; les éléments s'y aimantent.
// Alt+Maj+I : animations en pause ou en marche. La gomme efface un élément et ses liens.
//
// La grille est un objet du plugin (calque le plus bas) et non un calque `defineOverlay` :
// un calque est redessiné à chaque image et passe par-dessus tout, alors qu'un objet immobile
// est peint une seule fois dans l'image fixe, sous les éléments, et part avec « Tout effacer »
// ou l'annulation comme le reste du dessin. La gomme l'ignore (pas de `hit`).

export const manifest = {
  id: 'iso',
  nom: 'Isométrique',
  description: 'Schémas d’infrastructure en isométrique : serveurs, switchs, routeurs, PC, pare-feu, bases, cloud, conteneurs et utilisateurs en volumes néon, reliés par des chemins animés, sur une grille à 30°.',
  version: '1.0.0',
  api: 1,
};

const ITEMS = [
  { kind: 'serveur', label: 'Serveur', icon: '▥' },
  { kind: 'switch', label: 'Switch', icon: '⇄' },
  { kind: 'routeur', label: 'Routeur', icon: '◎' },
  { kind: 'pc', label: 'PC', icon: '▭' },
  { kind: 'parefeu', label: 'Pare-feu', icon: '▦' },
  { kind: 'bdd', label: 'Base de données', icon: '≣' },
  { kind: 'cloud', label: 'Cloud / Internet', icon: '☁' },
  { kind: 'conteneur', label: 'Conteneur', icon: '◫' },
  { kind: 'utilisateur', label: 'Utilisateur', icon: '☺' },
];

const TAU = Math.PI * 2;
const COS = Math.cos(Math.PI / 6); // axes isométriques à 30° de l'horizontale
const SIN = 0.5;
const CELL = 56; // côté d'une case de la grille, en pixels le long des axes iso

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

/** Écran → coordonnées iso (u vers le bas à droite, v vers le bas à gauche), et retour. */
const toUV = (x, y) => ({ u: (x / COS + y / SIN) / 2, v: (y / SIN - x / COS) / 2 });
const fromUV = (u, v) => ({ x: (u - v) * COS, y: (u + v) * SIN });

function rgba(hex, a) {
  if (!hex?.startsWith('#')) return `rgba(255,255,255,${a})`;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * Crayon isométrique : dessine en unités de `s` (demi-côté de l'emprise au sol), origine au
 * centre de l'emprise, z vers le haut. `zk` écrase les hauteurs (l'élément sort du sol en
 * apparaissant). Les volumes sont des faces légèrement teintées, cernées de néon.
 */
function makePen(api, ctx, color, alpha, s, zk, boost) {
  const w = clamp(s / 10, 1.3, 2.6);
  const P = (u, v, z = 0) => [(u - v) * COS * s, ((u + v) * SIN - z * zk) * s];
  const pen = {
    w,
    P,
    path(pts, closed = false) {
      const p = new Path2D();
      pts.forEach(([u, v, z], i) => {
        const [x, y] = P(u, v, z);
        if (i) p.lineTo(x, y);
        else p.moveTo(x, y);
      });
      if (closed) p.closePath();
      return p;
    },
    /** Face pleine : fond sombre (le volume cache ce qui est derrière) et reflet de la couleur. */
    fill(path, shade) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(6, 8, 18, 0.62)';
      ctx.fill(path);
      ctx.fillStyle = rgba(color.hex, shade);
      ctx.fill(path);
      ctx.restore();
    },
    line(path, a = 1, k = 1) {
      api.draw.neon(ctx, path, color, w * k, alpha * a, boost);
    },
    led(u, v, z, on, r = 2.2) {
      if (!on) return;
      const [x, y] = P(u, v, z);
      api.draw.glowDot(ctx, x, y, w * r, color, alpha);
    },
    /** Pavé [u0, u1] × [v0, v1] × [z0, z1] : trois faces visibles, arêtes cachées omises. */
    box(u0, u1, v0, v1, z0, z1, shades = [0.24, 0.13, 0.07]) {
      const top = [[u0, v0, z1], [u1, v0, z1], [u1, v1, z1], [u0, v1, z1]];
      const right = [[u1, v0, z1], [u1, v1, z1], [u1, v1, z0], [u1, v0, z0]];
      const left = [[u0, v1, z1], [u1, v1, z1], [u1, v1, z0], [u0, v1, z0]];
      pen.fill(pen.path(top, true), shades[0]);
      pen.fill(pen.path(right, true), shades[1]);
      pen.fill(pen.path(left, true), shades[2]);
      const edges = pen.path([[u0, v0, z1], [u1, v0, z1], [u1, v0, z0], [u1, v1, z0], [u0, v1, z0], [u0, v1, z1]], true);
      const [a, b] = P(u1, v1, z1);
      const add = (u, v, z) => {
        edges.moveTo(a, b);
        edges.lineTo(...P(u, v, z));
      };
      add(u1, v0, z1);
      add(u0, v1, z1);
      add(u1, v1, z0);
      pen.line(edges);
    },
    /** Points d'un cercle horizontal (ellipse à l'écran) de rayon r à la hauteur z, de a0 à a1. */
    ring(r, z, a0 = 0, a1 = TAU, cu = 0, cv = 0) {
      const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) / TAU) * 40));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        pts.push([cu + r * Math.cos(a), cv + r * Math.sin(a), z]);
      }
      return pts;
    },
    /** Cylindre vertical : couvercle complet, flanc avant ; les silhouettes sont à -π/4 et 3π/4. */
    cyl(r, z0, z1, shades = [0.22, 0.1]) {
      const a0 = -Math.PI / 4, a1 = (3 * Math.PI) / 4;
      const side = pen.path([...pen.ring(r, z1, a0, a1), ...pen.ring(r, z0, a1, a0)], true);
      const top = pen.path(pen.ring(r, z1), true);
      pen.fill(side, shades[1]);
      pen.fill(top, shades[0]);
      const edges = pen.path(pen.ring(r, z1), true);
      const bottom = pen.path(pen.ring(r, z0, a0, a1));
      edges.addPath(bottom);
      edges.addPath(pen.path([[r * Math.cos(a0), r * Math.sin(a0), z1], [r * Math.cos(a0), r * Math.sin(a0), z0]]));
      edges.addPath(pen.path([[r * Math.cos(a1), r * Math.sin(a1), z1], [r * Math.cos(a1), r * Math.sin(a1), z0]]));
      pen.line(edges);
    },
  };
  return pen;
}

/**
 * Dessin de chaque élément avec le crayon `pen`. `t` : temps en secondes (0 en pause),
 * `seed` : décalage propre à l'élément pour que les voyants ne clignotent pas ensemble.
 * `h` : hauteur (en unités de s) pour la zone de gomme et le placement du nom.
 */
const SHAPES = {
  // Tour de baie : trois tiroirs sur la face avant droite, chacun avec son voyant.
  serveur: {
    h: 2.1,
    draw(pen, t, seed) {
      pen.box(-0.55, 0.55, -0.55, 0.55, 0, 2.1);
      const slots = new Path2D();
      for (let i = 0; i < 3; i++) {
        const z = 2.1 - (i + 0.5) * 0.62;
        if (i) slots.addPath(pen.path([[0.55, -0.55, z + 0.31], [0.55, 0.55, z + 0.31]]));
        slots.addPath(pen.path([[0.55, -0.4, z], [0.55, 0.12, z]]));
      }
      pen.line(slots, 0.75, 0.6);
      for (let i = 0; i < 3; i++) {
        const z = 2.1 - (i + 0.5) * 0.62;
        pen.led(0.55, 0.36, z, t === 0 || Math.sin(t * (3.1 + i * 1.7) + seed * 9 + i * 2) > -0.3, 1.9);
      }
    },
  },
  // Boîtier plat ; une rangée de ports sur la face avant gauche, voyants en chenillard.
  switch: {
    h: 0.5,
    draw(pen, t, seed) {
      pen.box(-0.95, 0.95, -0.6, 0.6, 0, 0.5);
      const ports = new Path2D();
      const n = 6;
      for (let i = 0; i < n; i++) {
        const u = -0.8 + (i * 1.6) / (n - 1) - 0.09;
        ports.addPath(pen.path([[u, 0.6, 0.12], [u + 0.18, 0.6, 0.12], [u + 0.18, 0.6, 0.3], [u, 0.6, 0.3]], true));
      }
      pen.line(ports, 0.7, 0.55);
      const lit = t === 0 ? -1 : Math.floor(t * 6 + seed * 13) % (n * 2);
      for (let i = 0; i < n; i++) {
        const u = -0.8 + (i * 1.6) / (n - 1);
        const on = t === 0 || i === lit || (i * 7 + Math.floor(t * 2 + seed * 5)) % 3 === 0;
        pen.led(u, 0.6, 0.41, on, 1.4);
      }
    },
  },
  // Palet cylindrique ; quatre flèches tournent lentement sur le dessus.
  routeur: {
    h: 0.55,
    draw(pen, t) {
      pen.cyl(0.85, 0, 0.55);
      const arrows = new Path2D();
      const turn = t * 0.5;
      for (let i = 0; i < 4; i++) {
        const a = turn + (i * TAU) / 4 + Math.PI / 4;
        const c = Math.cos(a), d = Math.sin(a);
        const [r0, r1] = i % 2 ? [0.62, 0.18] : [0.18, 0.62];
        const tip = [c * r1, d * r1, 0.55];
        arrows.addPath(pen.path([[c * r0, d * r0, 0.55], tip]));
        const back = (r1 > r0 ? -1 : 1) * 0.16;
        const n = [-d * 0.13, c * 0.13];
        arrows.addPath(pen.path([[tip[0] + c * back + n[0], tip[1] + d * back + n[1], 0.55], tip, [tip[0] + c * back - n[0], tip[1] + d * back - n[1], 0.55]]));
      }
      pen.line(arrows, 0.9, 0.7);
    },
  },
  // Écran sur pied, socle et clavier ; un curseur clignote à l'écran.
  pc: {
    h: 1.65,
    draw(pen, t, seed) {
      pen.box(-0.75, 0.75, -0.75, -0.35, 0, 0.08, [0.2, 0.12, 0.08]); // socle
      pen.box(-0.08, 0.08, -0.6, -0.5, 0.08, 0.55, [0.2, 0.12, 0.08]); // pied
      pen.box(-0.9, 0.9, -0.62, -0.5, 0.5, 1.65, [0.2, 0.1, 0.16]); // écran
      pen.box(-0.7, 0.7, 0.05, 0.55, 0, 0.06, [0.16, 0.1, 0.06]); // clavier
      const glow = t === 0 ? 0.22 : 0.18 + Math.sin(t * 1.3 + seed * 7) * 0.06;
      const screen = pen.path([[-0.78, -0.5, 1.55], [0.78, -0.5, 1.55], [0.78, -0.5, 0.6], [-0.78, -0.5, 0.6]], true);
      pen.fill(screen, glow);
      const text = new Path2D();
      text.addPath(pen.path([[-0.6, -0.5, 1.3], [0.2, -0.5, 1.3]]));
      text.addPath(pen.path([[-0.6, -0.5, 1.08], [0.45, -0.5, 1.08]]));
      if (t === 0 || Math.floor(t * 2 + seed) % 2 === 0) text.addPath(pen.path([[-0.6, -0.5, 0.86], [-0.42, -0.5, 0.86]]));
      pen.line(text, 0.8, 0.55);
    },
  },
  // Mur de briques épais : appareil sur les deux faces visibles.
  parefeu: {
    h: 1.2,
    draw(pen, t, seed) {
      pen.box(-0.95, 0.95, -0.38, 0.38, 0, 1.2);
      const bricks = new Path2D();
      const rows = 4, dz = 1.2 / rows;
      for (let r = 1; r < rows; r++) {
        bricks.addPath(pen.path([[-0.95, 0.38, r * dz], [0.95, 0.38, r * dz], [0.95, -0.38, r * dz]]));
      }
      for (let r = 0; r < rows; r++) {
        const z0 = r * dz, z1 = z0 + dz;
        for (let k = r % 2 ? 1 : 0.5; k < 4; k++) {
          const u = -0.95 + (k * 1.9) / 4;
          bricks.addPath(pen.path([[u, 0.38, z0], [u, 0.38, z1]]));
        }
        const v = r % 2 ? 0 : null;
        if (v !== null) bricks.addPath(pen.path([[0.95, v, z0], [0.95, v, z1]]));
      }
      pen.line(bricks, 0.65, 0.55);
      // Une braise court le long du sommet.
      if (t) {
        const k = (t * 0.35 + seed) % 1;
        pen.led(-0.95 + 1.9 * k, 0.38, 1.2, true, 1.8);
      }
    },
  },
  // Trois disques empilés ; un voyant sur chacun.
  bdd: {
    h: 1.6,
    draw(pen, t, seed) {
      for (let i = 0; i < 3; i++) {
        const z0 = i * 0.55;
        pen.cyl(0.72, z0, z0 + 0.45);
      }
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 4;
        pen.led(0.72 * Math.cos(a), 0.72 * Math.sin(a), i * 0.55 + 0.22, t === 0 || Math.sin(t * (2.3 + i) + seed * 11 + i * 1.9) > 0, 1.6);
      }
    },
  },
  // Nuage flottant qui ondule doucement au-dessus de son ombre.
  cloud: {
    h: 1.9,
    draw(pen, t, seed, ctx) {
      const shadow = pen.path(pen.ring(0.85, 0), true);
      pen.line(shadow, 0.35, 0.6);
      const bob = t === 0 ? 0 : Math.sin(t * 1.4 + seed * 6) * 0.08;
      const [cx, cy] = pen.P(0, 0, 1.25 + bob);
      const k = pen.s;
      const p = new Path2D();
      p.moveTo(cx - k * 1.0, cy + k * 0.42);
      p.arc(cx - k * 0.66, cy + k * 0.06, k * 0.4, Math.PI * 0.62, Math.PI * 1.45);
      p.arc(cx - k * 0.12, cy - k * 0.26, k * 0.52, Math.PI * 1.08, Math.PI * 1.85);
      p.arc(cx + k * 0.55, cy + k * 0.02, k * 0.44, Math.PI * 1.35, Math.PI * 0.35);
      p.closePath();
      pen.fill(p, 0.18);
      pen.line(p);
      // Fil de liaison vers le sol, en pointillé.
      ctx.save();
      ctx.setLineDash([2, 4]);
      const link = new Path2D();
      link.moveTo(cx, cy + k * 0.45);
      link.lineTo(...pen.P(0, 0, 0));
      ctx.strokeStyle = rgba(pen.color.hex, 0.45 * pen.alpha);
      ctx.lineWidth = 1;
      ctx.stroke(link);
      ctx.restore();
    },
  },
  // Cube à nervures, comme un conteneur ; une trappe sur le dessus.
  conteneur: {
    h: 1.3,
    draw(pen, t, seed) {
      pen.box(-0.7, 0.7, -0.7, 0.7, 0, 1.3);
      const ribs = new Path2D();
      for (let k = 1; k < 4; k++) {
        const x = -0.7 + (k * 1.4) / 4;
        ribs.addPath(pen.path([[x, 0.7, 0.12], [x, 0.7, 1.18]]));
        ribs.addPath(pen.path([[0.7, x, 0.12], [0.7, x, 1.18]]));
      }
      ribs.addPath(pen.path([[-0.35, -0.35, 1.3], [0.35, -0.35, 1.3], [0.35, 0.35, 1.3], [-0.35, 0.35, 1.3]], true));
      pen.line(ribs, 0.6, 0.5);
      pen.led(0, 0, 1.3, t === 0 || Math.sin(t * 1.7 + seed * 8) > -0.5, 1.5);
    },
  },
  // Silhouette : corps en cylindre arrondi, tête ronde ; elle respire.
  utilisateur: {
    h: 1.75,
    draw(pen, t, seed) {
      const breathe = t === 0 ? 0 : Math.sin(t * 1.6 + seed * 5) * 0.03;
      const shadow = pen.path(pen.ring(0.6, 0), true);
      pen.line(shadow, 0.3, 0.5);
      pen.cyl(0.42, 0, 0.95 + breathe, [0.2, 0.12]);
      const [hx, hy] = pen.P(0, 0, 1.38 + breathe);
      const head = new Path2D();
      head.arc(hx, hy, pen.s * 0.32, 0, TAU);
      pen.fill(head, 0.22);
      pen.line(head);
    },
  },
};

export function activate(api) {
  if (!api.prompt) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // élément choisi dans la roue
  let paused = false;
  let linking = null; // { from, to }
  let naming = null; // élément à nommer au relâchement (Maj+clic)

  const itemSize = () => clamp(14 + api.width * 1.6, 16, 28);
  const grid = () => api.objects('grille')[0] ?? null;
  const itemAt = (p) => api.objectAt(p, 4, 'element');
  const clock = (now) => (paused ? 0 : now / 1000);

  /** Centre de la case iso sous le point, ou point aimanté au papier quand la grille est masquée. */
  function place(p) {
    if (!grid()) return api.snap(p);
    const { u, v } = toUV(p.x, p.y);
    return fromUV((Math.floor(u / CELL) + 0.5) * CELL, (Math.floor(v / CELL) + 0.5) * CELL);
  }

  function drawItem(ctx, o, x, y, s, t, alpha, zk = 1, boost = 0) {
    const shape = SHAPES[o.item];
    ctx.save();
    ctx.translate(x, y);
    const pulse = t === 0 ? 0 : 0.1 + Math.sin(t * 1.8 + (o.seed ?? 0) * TAU) * 0.1;
    const pen = makePen(api, ctx, o.color, alpha, s, zk, boost + pulse);
    Object.assign(pen, { s, color: o.color, alpha });
    shape.draw(pen, t, o.seed ?? 0, ctx);
    ctx.restore();
  }

  function addItem(p) {
    const at = place(p);
    return api.add('element', { x: at.x, y: at.y, size: itemSize(), item: ITEMS[current].kind, label: '', seed: Math.random() });
  }

  function link(a, b) {
    const exists = api.objects('lien').some((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
    if (!exists) api.add('lien', { a: a.id, b: b.id, deps: [a.id, b.id], seed: Math.random() });
  }

  async function rename(o) {
    const text = await api.prompt({ x: o.x, y: o.y + o.size * 0.9, value: o.label ?? '', placeholder: 'Nom de l’élément' });
    if (text === null || o.dying) return;
    o.label = text;
    api.changed();
  }

  // ───────── Éléments ─────────

  api.defineObject('element', {
    layer: 1,
    animated: () => !paused,
    center: (o) => ({ x: o.x, y: o.y - (SHAPES[o.item].h * o.size) / 2 }),
    hit(o, p, r) {
      const s = o.size, h = SHAPES[o.item].h * s;
      return Math.abs(p.x - o.x) < s * 1.15 + r && p.y > o.y - h - s * 0.4 - r && p.y < o.y + s * 0.95 + r;
    },
    draw(ctx, o, f) {
      const rise = f.intro < 1 ? Math.max(0.02, easeOutBack(f.intro)) : 1;
      drawItem(ctx, o, o.x, o.y, o.size, clock(f.now), f.life, rise, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
      if (o.label) api.draw.label(ctx, o.label, o.x, o.y + o.size * 0.95 + 13, o.color, { alpha: f.life * Math.min(1, f.intro * 2) });
    },
  });

  // ───────── Liens : chemin en L au sol, le long des deux axes iso ─────────

  /** Points écran du chemin entre deux éléments, raccourci aux emprises, et sa longueur. */
  function route(a, b) {
    const A = toUV(a.x, a.y), B = toUV(b.x, b.y);
    // Le coude est placé du côté du spectateur : le chemin passe devant plutôt que derrière.
    const e1 = { u: B.u, v: A.v }, e2 = { u: A.u, v: B.v };
    const elbow = e1.u + e1.v >= e2.u + e2.v ? e1 : e2;
    const pts = [A, elbow, B].filter((q, i, l) => !i || Math.hypot(q.u - l[i - 1].u, q.v - l[i - 1].v) > 0.5);
    const cut = (list, r) => {
      // Retire la longueur r au début de la liste.
      const out = list.slice();
      while (out.length > 1 && r > 0) {
        const [p, q] = out;
        const d = Math.hypot(q.u - p.u, q.v - p.v);
        if (d <= r) {
          r -= d;
          out.shift();
        } else {
          out[0] = { u: p.u + ((q.u - p.u) * r) / d, v: p.v + ((q.v - p.v) * r) / d };
          r = 0;
        }
      }
      return out;
    };
    const ra = a.size * 0.95, rb = b.size * 0.95;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].u - pts[i - 1].u, pts[i].v - pts[i - 1].v);
    if (total < ra + rb + 6) return null;
    const trimmed = cut(cut(pts, ra).reverse(), rb).reverse();
    const screen = trimmed.map((q) => fromUV(q.u, q.v));
    const cum = [0];
    for (let i = 1; i < screen.length; i++) cum.push(cum[i - 1] + Math.hypot(screen[i].x - screen[i - 1].x, screen[i].y - screen[i - 1].y));
    return { pts: screen, cum, len: cum[cum.length - 1] };
  }

  function pointAt(r, d) {
    let i = 1;
    while (i < r.pts.length - 1 && r.cum[i] < d) i++;
    const a = r.pts[i - 1], b = r.pts[i];
    const k = (d - r.cum[i - 1]) / (r.cum[i] - r.cum[i - 1] || 1);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  function partial(r, upTo) {
    const p = new Path2D();
    p.moveTo(r.pts[0].x, r.pts[0].y);
    for (let i = 1; i < r.pts.length; i++) {
      if (r.cum[i] >= upTo) {
        const q = pointAt(r, upTo);
        p.lineTo(q.x, q.y);
        break;
      }
      p.lineTo(r.pts[i].x, r.pts[i].y);
    }
    return p;
  }

  function ends(o) {
    const objs = api.objects('element');
    const a = objs.find((d) => d.id === o.a), b = objs.find((d) => d.id === o.b);
    return a && b ? route(a, b) : null;
  }

  api.defineObject('lien', {
    layer: 0,
    animated: () => !paused,
    center(o) {
      const r = ends(o);
      return r && pointAt(r, r.len / 2);
    },
    hit(o, p, rad) {
      const r = ends(o);
      if (!r) return false;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const k = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        if (Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k)) < rad + 4) return true;
      }
      return false;
    },
    draw(ctx, o, f) {
      const r = ends(o);
      if (!r) return;
      const grow = Math.min(1, f.intro * 1.6);
      const w = clamp(o.width * 0.45, 1.4, 3);
      api.draw.neon(ctx, partial(r, r.len * grow), o.color, w, f.life * 0.85, 0, o.dash ? { width: w } : null);
      if (paused || grow < 1) return;
      const t = f.now / 1000;
      const gap = 96, speed = 70;
      for (const dir of [1, -1]) {
        const shift = (((t * speed + o.seed * gap + (dir < 0 ? gap / 2 : 0)) % gap) + gap) % gap;
        for (let at = shift; at < r.len; at += gap) {
          const q = pointAt(r, dir > 0 ? at : r.len - at);
          api.draw.glowDot(ctx, q.x, q.y, w * 2.6, o.color, f.life * 0.95);
        }
      }
    },
  });

  // ───────── Grille isométrique ─────────

  api.defineObject('grille', {
    layer: -1,
    center: () => null,
    draw(ctx, o, f) {
      const { w, h } = api.size;
      const corners = [toUV(0, 0), toUV(w, 0), toUV(0, h), toUV(w, h)];
      const us = corners.map((c) => c.u), vs = corners.map((c) => c.v);
      const u0 = Math.floor(Math.min(...us) / CELL), u1 = Math.ceil(Math.max(...us) / CELL);
      const v0 = Math.floor(Math.min(...vs) / CELL), v1 = Math.ceil(Math.max(...vs) / CELL);
      const fade = f.life * Math.min(1, f.intro * 1.5);
      const minor = new Path2D(), major = new Path2D();
      const seg = (p, a, b) => {
        p.moveTo(a.x, a.y);
        p.lineTo(b.x, b.y);
      };
      for (let i = u0; i <= u1; i++) seg(i % 4 ? minor : major, fromUV(i * CELL, v0 * CELL), fromUV(i * CELL, v1 * CELL));
      for (let j = v0; j <= v1; j++) seg(j % 4 ? minor : major, fromUV(u0 * CELL, j * CELL), fromUV(u1 * CELL, j * CELL));
      ctx.save();
      ctx.lineWidth = 1;
      ctx.shadowColor = o.color.glow;
      ctx.shadowBlur = 4;
      ctx.globalAlpha = fade;
      ctx.strokeStyle = rgba(o.color.hex, 0.1);
      ctx.stroke(minor);
      ctx.strokeStyle = rgba(o.color.hex, 0.2);
      ctx.stroke(major);
      ctx.restore();
    },
  });

  function toggleGrid() {
    const g = grid();
    if (g) api.remove(g);
    else api.add('grille', {});
    api.toast(g ? 'Grille isométrique masquée' : 'Grille isométrique : les éléments s’aimantent aux cases');
    api.render();
  }

  // ───────── Roue et outil ─────────

  function itemWheel() {
    api.wheel({
      items: ITEMS.map((d) => ({
        label: d.label,
        draw(ctx, x, y, size, color, alpha, now) {
          // Élément centré verticalement sur la case de la roue.
          const s = size * 0.78, shape = SHAPES[d.kind];
          drawItem(ctx, { item: d.kind, color, seed: 0.3 }, x, y + ((shape.h - 0.9) * s) / 2, s, clock(now), alpha);
        },
      })),
      selected: current,
      onPick(i) {
        current = i;
        api.useTool('iso');
        api.refreshHud();
      },
    });
  }

  api.defineTool('iso', {
    wheel: itemWheel,
    label: () => `Isométrique : ${ITEMS[current].icon} ${ITEMS[current].label}${grid() ? ' · grille' : ''}`,
    busy: () => !!linking,
    down(p, e) {
      const from = itemAt(p);
      if (e?.shiftKey) {
        // Le champ s'ouvre au relâchement : ouvert pendant l'appui, il perdrait aussitôt le focus.
        naming = from ?? addItem(p);
        return;
      }
      if (from) linking = { from, to: p };
      else addItem(p);
    },
    move(p) {
      if (linking) {
        linking.to = p;
        api.render();
      }
    },
    up(p) {
      if (naming) {
        rename(naming);
        naming = null;
        return;
      }
      if (!linking) return;
      const { from } = linking;
      linking = null;
      const over = itemAt(p);
      if (over === from || (!over && Math.hypot(p.x - from.x, p.y - from.y) < from.size * 1.2)) return api.render();
      const to = over ?? addItem(p);
      link(from, to);
      api.render();
    },
    cancel() {
      linking = null;
      naming = null;
    },
    preview(ctx) {
      if (!linking) return;
      const target = itemAt(linking.to) ?? { ...place(linking.to), size: itemSize() };
      const r = route(linking.from, target);
      if (!r) return;
      api.draw.neon(ctx, partial(r, r.len), api.color, 2, 0.6, 0, { width: 2 });
    },
    cursor(ctx, p, now) {
      if (linking) return;
      const over = itemAt(p);
      if (over) {
        // Au-dessus d'un élément : un anneau au sol invite à glisser pour le relier.
        const k = over.size * (1.25 + Math.sin(now / 160) * 0.05);
        const ring = new Path2D();
        ring.ellipse(over.x, over.y, k * COS * Math.SQRT2, k * SIN * Math.SQRT2, 0, 0, TAU);
        api.draw.neon(ctx, ring, over.color, 1.5, 0.7, 0, { width: 1.5 });
        return;
      }
      const at = place(p);
      if (grid()) {
        // Case visée, en losange.
        const { u, v } = toUV(at.x, at.y), hc = CELL / 2;
        const pts = [[-hc, -hc], [hc, -hc], [hc, hc], [-hc, hc]].map(([du, dv]) => fromUV(u + du, v + dv));
        const cell = api.draw.path(pts, true, false);
        ctx.save();
        ctx.fillStyle = rgba(api.color.hex, 0.08);
        ctx.fill(cell);
        ctx.restore();
        api.draw.neon(ctx, cell, api.color, 1.2, 0.45);
      }
      drawItem(ctx, { item: ITEMS[current].kind, color: api.color, seed: 0 }, at.x, at.y, itemSize(), clock(now), 0.45);
    },
  });

  api.defineAction('roue', {
    label: 'Roue isométrique',
    hint: 'Maintenir et relâcher sur un élément, ou appuyer puis cliquer · glisser d’un élément à l’autre : relier · Maj+clic : nommer',
    key: 'Shift+I',
    run: () => itemWheel(),
  });

  api.defineAction('grille', {
    label: 'Grille isométrique',
    hint: 'Lignes à 30° ; les éléments se posent au centre des cases',
    key: 'Alt+I',
    run: () => toggleGrid(),
  });

  api.defineAction('animation', {
    label: 'Animations iso en pause / en marche',
    key: 'Alt+Shift+I',
    run() {
      paused = !paused;
      api.toast(paused ? 'Isométrique : animations en pause' : 'Isométrique : animations en marche');
      api.changed();
    },
  });
}
