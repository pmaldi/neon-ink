// Plugin « Réseau » pour NeonInk : plans réseau en néon, avec des appareils animés
// (routeur, switch, serveur, PC, pare-feu, Internet, borne Wi-Fi) reliés par des liens
// où circulent des paquets.
//
// Touche J (par défaut) : roue des appareils. Maintenir J, viser l'appareil, relâcher ;
// ou appuyer sur J puis cliquer sur l'appareil. La touche peut aussi être un bouton de souris.
//  - clic dans le vide : pose l'appareil choisi (aimanté au quadrillage sur papier à carreaux) ;
//  - glisser d'un appareil à un autre : les relie ;
//  - glisser d'un appareil vers le vide : pose un nouvel appareil, déjà relié.
// Maj+J : animations en pause ou en marche. La gomme efface un appareil et ses liens.

export const manifest = {
  id: 'reseau',
  nom: 'Réseau',
  description: 'Plans réseau : routeur, switch, serveur, PC, pare-feu, Internet et Wi-Fi, reliés par des liens animés.',
  version: '1.2.0',
  api: 1,
};

const DEVICES = [
  { kind: 'routeur', label: 'Routeur', prefix: 'R' },
  { kind: 'switch', label: 'Switch', prefix: 'SW' },
  { kind: 'serveur', label: 'Serveur', prefix: 'SRV' },
  { kind: 'pc', label: 'PC', prefix: 'PC' },
  { kind: 'parefeu', label: 'Pare-feu', prefix: 'FW' },
  { kind: 'internet', label: 'Internet', prefix: null },
  { kind: 'wifi', label: 'Borne Wi-Fi', prefix: 'AP' },
];
const ICON = { routeur: '◎', switch: '⇄', serveur: '▤', pc: '▭', parefeu: '▦', internet: '☁', wifi: '◠' };
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
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
}

/**
 * Dessin de chaque appareil, centré sur (0, 0), de demi-taille `s`. `t` : temps en secondes
 * (0 quand les animations sont en pause). Rend le chemin principal et les points lumineux.
 */
const SHAPES = {
  // Symbole Cisco : disque et quatre flèches, deux entrantes et deux sortantes.
  routeur(s, t) {
    const p = new Path2D();
    p.arc(0, 0, s, 0, TAU);
    const turn = t * 0.6;
    for (let i = 0; i < 4; i++) {
      const a = turn + (i * TAU) / 4 + Math.PI / 4;
      const c = Math.cos(a), d = Math.sin(a);
      const inner = s * 0.18, outer = s * 0.72;
      if (i % 2) arrowTo(p, c * outer, d * outer, c * inner, d * inner, s * 0.2);
      else arrowTo(p, c * inner, d * inner, c * outer, d * outer, s * 0.2);
    }
    return { path: p };
  },
  // Symbole Cisco : boîtier et flèches croisées ; le trafic glisse d'un côté à l'autre.
  switch(s, t) {
    const p = new Path2D();
    const w = s * 1.15, h = s * 0.72;
    roundRect(p, -w, -h, w * 2, h * 2, s * 0.14);
    const shift = (Math.sin(t * 3) * s) / 9;
    arrowTo(p, -w * 0.6 + shift, -h * 0.4, w * 0.6 + shift, -h * 0.4, s * 0.18);
    arrowTo(p, w * 0.6 - shift, h * 0.4, -w * 0.6 - shift, h * 0.4, s * 0.18);
    return { path: p };
  },
  // Tour avec trois baies et des voyants qui clignotent.
  serveur(s, t) {
    const p = new Path2D();
    const w = s * 0.62, h = s * 1.05;
    roundRect(p, -w, -h, w * 2, h * 2, s * 0.1);
    const leds = [];
    for (let i = 0; i < 3; i++) {
      const y = -h + ((i + 0.5) * 2 * h) / 3;
      if (i) {
        p.moveTo(-w, -h + (i * 2 * h) / 3);
        p.lineTo(w, -h + (i * 2 * h) / 3);
      }
      p.moveTo(-w * 0.6, y);
      p.lineTo(w * 0.15, y);
      leds.push({ x: w * 0.55, y, on: t === 0 || Math.sin(t * (4 + i * 1.7) + i * 2) > -0.2 });
    }
    return { path: p, leds };
  },
  // Écran, pied et socle ; un curseur clignote à l'écran.
  pc(s, t) {
    const p = new Path2D();
    const w = s * 1.05, h = s * 0.68;
    roundRect(p, -w, -h - s * 0.2, w * 2, h * 2, s * 0.1);
    p.moveTo(0, h - s * 0.2);
    p.lineTo(0, h + s * 0.25);
    p.moveTo(-s * 0.5, h + s * 0.25);
    p.lineTo(s * 0.5, h + s * 0.25);
    if (t === 0 || Math.floor(t * 2) % 2 === 0) {
      p.moveTo(-w * 0.55, -s * 0.2);
      p.lineTo(-w * 0.55, s * 0.1);
    }
    return { path: p };
  },
  // Mur de briques.
  parefeu(s) {
    const p = new Path2D();
    const w = s * 1.1, h = s * 0.8;
    p.rect(-w, -h, w * 2, h * 2);
    for (let r = 1; r < 4; r++) {
      const y = -h + (r * 2 * h) / 4;
      p.moveTo(-w, y);
      p.lineTo(w, y);
    }
    for (let r = 0; r < 4; r++) {
      const y0 = -h + (r * 2 * h) / 4, y1 = y0 + (2 * h) / 4;
      for (let k = r % 2 ? 1 : 0.5; k < 3; k++) {
        const x = -w + (k * 2 * w) / 3;
        p.moveTo(x, y0);
        p.lineTo(x, y1);
      }
    }
    return { path: p };
  },
  // Nuage qui respire doucement.
  internet(s, t) {
    const p = new Path2D();
    const k = s * (1 + Math.sin(t * 1.6) * 0.04);
    p.moveTo(-k * 1.05, k * 0.45);
    p.arc(-k * 0.7, k * 0.05, k * 0.42, Math.PI * 0.62, Math.PI * 1.45);
    p.arc(-k * 0.15, -k * 0.3, k * 0.55, Math.PI * 1.08, Math.PI * 1.85);
    p.arc(k * 0.55, -k * 0.02, k * 0.47, Math.PI * 1.35, Math.PI * 0.35);
    p.closePath();
    return { path: p };
  },
  // Borne et ondes qui s'éloignent.
  wifi(s, t) {
    const p = new Path2D();
    roundRect(p, -s * 0.75, s * 0.25, s * 1.5, s * 0.5, s * 0.12);
    p.moveTo(0, s * 0.25);
    p.lineTo(0, -s * 0.05);
    const waves = [];
    for (let i = 0; i < 3; i++) {
      const phase = t === 0 ? 1 : ((t * 0.8 + i / 3) % 1);
      waves.push({ r: s * (0.35 + 0.55 * phase), alpha: t === 0 ? 1 - i * 0.25 : Math.sin(phase * Math.PI) });
    }
    return { path: p, waves };
  },
};

export function activate(api) {
  let current = 0; // appareil choisi
  let paused = false;
  let linking = null; // { from, to }

  const size = () => 20 + api.width * 2.4;
  const deviceAt = (p) => api.objectAt(p, 6, 'appareil');

  function nextLabel(kind) {
    const dev = DEVICES.find((d) => d.kind === kind);
    if (!dev.prefix) return dev.label;
    const used = api.objects('appareil').filter((o) => o.device === kind).map((o) => parseInt(o.label.slice(dev.prefix.length), 10) || 0);
    return `${dev.prefix}${Math.max(0, ...used) + 1}`;
  }

  function addDevice(p) {
    const at = api.snap(p);
    const kind = DEVICES[current].kind;
    return api.add('appareil', { x: at.x, y: at.y, size: size(), device: kind, label: nextLabel(kind) });
  }

  function link(a, b) {
    const exists = api.objects('lien').some((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
    if (!exists) api.add('lien', { a: a.id, b: b.id, deps: [a.id, b.id], seed: Math.random() });
  }

  function drawDevice(ctx, o, x, y, s, t, alpha, boost = 0) {
    const shape = SHAPES[o.device](s, t);
    ctx.save();
    ctx.translate(x, y);
    const w = Math.max(2, Math.min(4, s / 9));
    api.draw.neon(ctx, shape.path, o.color, w, alpha, boost);
    for (const led of shape.leds ?? []) if (led.on) api.draw.glowDot(ctx, led.x, led.y, w * 2.4, o.color, alpha);
    for (const wave of shape.waves ?? []) {
      const p = new Path2D();
      p.arc(0, -s * 0.05, wave.r, -Math.PI * 0.8, -Math.PI * 0.2);
      api.draw.neon(ctx, p, o.color, w, alpha * wave.alpha);
    }
    ctx.restore();
  }

  const clock = (now) => (paused ? 0 : now / 1000);

  api.defineObject('appareil', {
    layer: 1,
    animated: () => !paused,
    center: (o) => o,
    hit: (o, p, r) => Math.abs(p.x - o.x) < o.size * 1.15 + r && Math.abs(p.y - o.y) < o.size * 1.1 + r,
    draw(ctx, o, f) {
      const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(f.intro)) : 1;
      drawDevice(ctx, o, o.x, o.y, o.size * pop, clock(f.now), f.life, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
      api.draw.label(ctx, o.label, o.x, o.y + o.size * 1.25 + 12, o.color, { alpha: f.life * Math.min(1, f.intro * 2) });
    },
  });

  // Lien : trait fin entre deux appareils, parcouru par des paquets dans les deux sens.
  function ends(o) {
    const objs = api.objects('appareil');
    const a = objs.find((d) => d.id === o.a), b = objs.find((d) => d.id === o.b);
    if (!a || !b) return null;
    const d = dist(a, b) || 1;
    const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    const ra = a.size * 1.2, rb = b.size * 1.2;
    if (d < ra + rb + 4) return null;
    return { x0: a.x + ux * ra, y0: a.y + uy * ra, x1: b.x - ux * rb, y1: b.y - uy * rb, len: d - ra - rb };
  }

  api.defineObject('lien', {
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
      // Le lien se trace depuis le premier appareil.
      const grow = Math.min(1, f.intro * 1.6);
      const path = new Path2D();
      path.moveTo(e.x0, e.y0);
      path.lineTo(e.x0 + (e.x1 - e.x0) * grow, e.y0 + (e.y1 - e.y0) * grow);
      const w = Math.max(1.5, o.width * 0.5);
      api.draw.neon(ctx, path, o.color, w, f.life * 0.9, 0, o.dash ? { width: w } : null);
      if (paused || grow < 1) return;
      const t = f.now / 1000;
      const gap = 110, speed = 90;
      for (const dir of [1, -1]) {
        const shift = ((t * speed + o.seed * gap + (dir < 0 ? gap / 2 : 0)) % gap + gap) % gap;
        for (let at = shift; at < e.len; at += gap) {
          const k = dir > 0 ? at / e.len : 1 - at / e.len;
          api.draw.glowDot(ctx, e.x0 + (e.x1 - e.x0) * k, e.y0 + (e.y1 - e.y0) * k, w * 2.6, o.color, f.life * 0.95);
        }
      }
    },
  });

  /** Roue des appareils (touche J, ou touche des formes quand l'outil réseau est actif). */
  function deviceWheel() {
    if (!api.wheel) {
      // NeonInk antérieur à 0.10 : pas de roue, la touche passe à l'appareil suivant.
      if (api.toolActive('reseau')) current = (current + 1) % DEVICES.length;
      api.useTool('reseau');
      return;
    }
    api.wheel({
      items: DEVICES.map((d) => ({
        label: d.label,
        draw: (ctx, x, y, s, color, alpha, now) => drawDevice(ctx, { device: d.kind, color }, x, y, s, clock(now), alpha),
      })),
      selected: current,
      onPick(i) {
        current = i;
        api.useTool('reseau');
        api.refreshHud();
      },
    });
  }

  api.defineTool('reseau', {
    wheel: deviceWheel,
    label: () => `Réseau : ${ICON[DEVICES[current].kind]} ${DEVICES[current].label}`,
    busy: () => !!linking,
    down(p) {
      const from = deviceAt(p);
      if (from) linking = { from, to: p };
      else addDevice(p);
    },
    move(p) {
      if (linking) {
        linking.to = p;
        api.render();
      }
    },
    up(p) {
      if (!linking) return;
      const { from } = linking;
      linking = null;
      if (dist(from, p) < from.size * 1.2) return api.render(); // simple clic sur un appareil
      const to = deviceAt(p) ?? addDevice(p);
      if (to !== from) link(from, to);
      api.render();
    },
    cancel() {
      linking = null;
    },
    preview(ctx) {
      if (!linking) return;
      const path = new Path2D();
      path.moveTo(linking.from.x, linking.from.y);
      path.lineTo(linking.to.x, linking.to.y);
      api.draw.neon(ctx, path, api.color, 2, 0.6, 0, { width: 2 });
    },
    cursor(ctx, p, now) {
      if (linking) return;
      const over = deviceAt(p);
      if (over) {
        // Au-dessus d'un appareil : un anneau invite à glisser pour le relier.
        const ring = new Path2D();
        ring.arc(over.x, over.y, over.size * 1.45 + Math.sin(now / 160) * 2, 0, TAU);
        api.draw.neon(ctx, ring, over.color, 1.5, 0.7, 0, { width: 1.5 });
        return;
      }
      const at = api.snap(p);
      drawDevice(ctx, { device: DEVICES[current].kind, color: api.color }, at.x, at.y, size(), clock(now), 0.4);
    },
  });

  api.defineAction('reseau', {
    label: 'Roue des appareils réseau',
    hint: 'Maintenir et relâcher sur un appareil, ou appuyer puis cliquer · glisser d’un appareil à l’autre : relier',
    key: 'J',
    run: () => deviceWheel(),
  });

  api.defineAction('animation', {
    label: 'Animations en pause / en marche',
    key: 'Shift+J',
    run() {
      paused = !paused;
      api.toast(paused ? 'Réseau : animations en pause' : 'Réseau : animations en marche');
      api.render();
    },
  });
}
