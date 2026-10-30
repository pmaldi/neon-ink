// Plugin « Réseau » pour NeonInk : plans réseau en néon, avec des appareils animés
// (routeur, switch, serveur, PC, pare-feu, Internet, borne Wi-Fi) reliés par des câbles
// où circulent des paquets, des étiquettes (nom, adresse IP, VLAN…) et des zones (DMZ, LAN…).
//
// Touche J (par défaut) : roue des appareils. Maintenir J, viser l'appareil, relâcher ;
// ou appuyer sur J puis cliquer sur l'appareil. La touche peut aussi être un bouton de souris.
// Quand l'outil réseau est actif, la touche des formes (M, clic molette) ouvre la même roue.
//  - clic dans le vide : pose l'appareil choisi (aimanté au quadrillage sur papier à carreaux) ;
//  - glisser d'un appareil à un autre : les relie (ou change le type de câble d'un lien existant) ;
//  - glisser d'un appareil vers le vide : pose un nouvel appareil, déjà relié ;
//  - Maj+clic sur un appareil, un lien ou une zone : saisir son étiquette (texte vide : l'enlève).
// Alt+J : roue des types de câble (cuivre, fibre, VPN, sans fil) pour les nouveaux liens.
// Ctrl+J : outil zone. Glisser trace une zone (rectangle arrondi en pointillés), nommée
// aussitôt ; un clic sur une zone la renomme. Les zones passent sous les appareils et les liens.
// Maj+J : animations en pause ou en marche. La gomme efface un appareil et ses liens, un lien,
// ou une zone (en passant sur son bord ou son nom).

export const manifest = {
  id: 'reseau',
  nom: 'Réseau',
  description: 'Plans réseau : routeur, switch, serveur, PC, pare-feu, Internet et Wi-Fi, reliés par des câbles animés (cuivre, fibre, VPN, sans fil), avec étiquettes et zones.',
  version: '2.0.0',
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


/** Types de câble. `icon` : repère dans la barre d'état. */
const CABLES = [
  { kind: 'cuivre', label: 'Cuivre', icon: '━' },
  { kind: 'fibre', label: 'Fibre', icon: '✦' },
  { kind: 'vpn', label: 'VPN', icon: '⚿' },
  { kind: 'sansfil', label: 'Sans fil', icon: '≋' },
];

const LABEL_FONT = (size) => `600 ${size}px "Segoe UI", system-ui, sans-serif`;
const DARK_INK = '#14141c'; // couleur « Noir » de la palette : texte sombre, fond clair

/** Cadenas centré sur (0, 0), de hauteur environ 2 × `s`. */
function lockPath(s) {
  const p = new Path2D();
  roundRect(p, -s * 0.8, -s * 0.15, s * 1.6, s * 1.15, s * 0.22);
  p.moveTo(-s * 0.5, -s * 0.15);
  p.lineTo(-s * 0.5, -s * 0.45);
  p.arc(0, -s * 0.45, s * 0.5, Math.PI, 0);
  p.lineTo(s * 0.5, -s * 0.15);
  p.moveTo(0, s * 0.3);
  p.lineTo(0, s * 0.55);
  return p;
}

/** Rectangle normalisé entre deux coins. */
function rectOf(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

export function activate(api) {
  if (!api.prompt || !api.changed) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // appareil choisi
  let cable = 0; // type de câble des nouveaux liens
  let paused = false;
  let linking = null; // { from, to }
  let editing = null; // objet visé par un Maj+clic, étiqueté au relâchement
  let drawing = null; // zone en cours de tracé : { a, b }

  const size = () => 20 + api.width * 2.4;
  const deviceAt = (p) => api.objectAt(p, 6, 'appareil');
  const linkAt = (p) => api.objectAt(p, 4, 'lien');
  /** Zone contenant le point (la plus récente d'abord), bord compris. */
  function zoneAt(p) {
    const list = api.objects('zone');
    for (let i = list.length - 1; i >= 0; i--) {
      const z = list[i];
      if (p.x >= z.x - 6 && p.x <= z.x + z.w + 6 && p.y >= z.y - 14 && p.y <= z.y + z.h + 6) return z;
    }
    return null;
  }

  function nextLabel(kind) {
    const dev = DEVICES.find((d) => d.kind === kind);
    if (!dev.prefix) return dev.label;
    const re = new RegExp(`^${dev.prefix}(\\d+)$`);
    const used = api.objects('appareil').filter((o) => o.device === kind).map((o) => +(re.exec(o.label ?? '')?.[1] ?? 0));
    return `${dev.prefix}${Math.max(0, ...used) + 1}`;
  }

  function addDevice(p) {
    const at = api.snap(p);
    const kind = DEVICES[current].kind;
    return api.add('appareil', { x: at.x, y: at.y, size: size(), device: kind, label: nextLabel(kind) });
  }

  function link(a, b) {
    const kind = CABLES[cable].kind;
    const old = api.objects('lien').find((l) => (l.a === a.id && l.b === b.id) || (l.a === b.id && l.b === a.id));
    if (!old) return api.add('lien', { a: a.id, b: b.id, deps: [a.id, b.id], seed: Math.random(), cable: kind });
    // Relier à nouveau deux appareils déjà reliés : le lien prend le type de câble choisi.
    if ((old.cable ?? 'cuivre') !== kind) {
      old.cable = kind;
      api.changed();
    }
    return old;
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

  /** Largeur de la pastille d'une étiquette (texte et, si besoin, place d'une icône). */
  function tagWidth(ctx, text, size, icon = 0) {
    ctx.save();
    ctx.font = LABEL_FONT(size);
    const w = text ? ctx.measureText(text).width : 0;
    ctx.restore();
    return w + icon + (text && icon ? 5 : 0) + size * 1.1;
  }

  /**
   * Étiquette lisible : petit texte néon sur une pastille sombre (claire pour l'encre noire),
   * centrée sur (x, y). `icon(ctx, x, y, s)` dessine un petit symbole avant le texte.
   */
  function tag(ctx, text, x, y, color, alpha, { size = 12, border = true, icon = null } = {}) {
    if (alpha <= 0 || (!text && !icon)) return;
    const iconW = icon ? size * 0.95 : 0;
    const w = tagWidth(ctx, text, size, iconW), h = size * 1.6;
    const dark = color.hex === DARK_INK;
    ctx.save();
    ctx.globalAlpha = alpha;
    const p = new Path2D();
    roundRect(p, x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = dark ? 'rgba(255, 255, 255, 0.82)' : 'rgba(6, 8, 16, 0.78)';
    ctx.fill(p);
    if (border) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = color.hex;
      ctx.globalAlpha = alpha * 0.55;
      ctx.stroke(p);
    }
    ctx.restore();
    let tx = x;
    if (icon) {
      const ix = x - w / 2 + size * 0.55 + iconW / 2;
      icon(ctx, ix, y, size * 0.42, alpha);
      tx = ix + iconW / 2 + 5 + (w - size * 1.1 - iconW - 5) / 2;
    }
    if (text) api.draw.label(ctx, text, tx, y + 0.5, color, { size, alpha });
  }

  api.defineObject('appareil', {
    layer: 1,
    animated: () => !paused,
    center: (o) => o,
    hit: (o, p, r) => Math.abs(p.x - o.x) < o.size * 1.15 + r && Math.abs(p.y - o.y) < o.size * 1.1 + r,
    draw(ctx, o, f) {
      const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(f.intro)) : 1;
      drawDevice(ctx, o, o.x, o.y, o.size * pop, clock(f.now), f.life, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
      tag(ctx, o.label, o.x, o.y + o.size * 1.25 + 12, o.color, f.life * Math.min(1, f.intro * 2), { size: 13, border: false });
    },
  });

  // Lien : câble entre deux appareils, parcouru par des paquets dans les deux sens.
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

  const along = (e, k) => ({ x: e.x0 + (e.x1 - e.x0) * k, y: e.y0 + (e.y1 - e.y0) * k });

  /** Points régulièrement espacés qui défilent sur le câble, dans les deux sens. */
  function packets(e, t, seed, gap, speed, fn) {
    for (const dir of [1, -1]) {
      const shift = ((t * speed + seed * gap + (dir < 0 ? gap / 2 : 0)) % gap + gap) % gap;
      for (let at = shift; at < e.len; at += gap) fn(dir > 0 ? at / e.len : 1 - at / e.len, dir);
    }
  }

  /**
   * Dessin d'un câble de type `kind` entre les extrémités `e`. `t` : temps en secondes
   * (0 en pause : pas de paquets) ; `grow` (0..1) : part du câble déjà tracée ; `scale` réduit
   * l'espacement des paquets (aperçu de la roue).
   */
  function drawCable(ctx, kind, e, color, w, alpha, t, seed, { grow = 1, scale = 1, dash = false } = {}) {
    const end = along(e, grow);
    const line = new Path2D();
    line.moveTo(e.x0, e.y0);
    line.lineTo(end.x, end.y);
    const moving = t !== 0 && grow >= 1;
    const ux = (e.x1 - e.x0) / (e.len || 1), uy = (e.y1 - e.y0) / (e.len || 1);

    if (kind === 'fibre') {
      // Fibre : trait fin, éclairs rapides et très lumineux.
      api.draw.neon(ctx, line, color, Math.max(1, w * 0.55), alpha * 0.8, 0, dash ? { width: w } : null);
      if (!moving) return;
      const streak = 16 * Math.min(1, scale * 1.5);
      packets(e, t, seed, 80 * scale, 320, (k, dir) => {
        const p = along(e, k);
        const tail = new Path2D();
        tail.moveTo(p.x, p.y);
        tail.lineTo(p.x - ux * dir * streak, p.y - uy * dir * streak);
        api.draw.glowLine(ctx, tail, color, Math.max(1.2, w * 0.6), alpha);
        api.draw.glowDot(ctx, p.x, p.y, w * 2.2, color, alpha);
      });
      return;
    }

    if (kind === 'vpn') {
      // VPN : tunnel en tirets, paquets lents.
      api.draw.neon(ctx, line, color, w, alpha * 0.9, 0, { width: w * 1.6 });
      if (moving) packets(e, t, seed, 150 * scale, 32, (k) => {
        const p = along(e, k);
        api.draw.glowDot(ctx, p.x, p.y, w * 2.4, color, alpha * 0.9);
      });
      return;
    }

    if (kind === 'sansfil') {
      // Sans fil : pointillés et ondes qui partent de chaque appareil vers le milieu.
      const dots = new Path2D();
      const step = 9;
      for (let at = step / 2; at < e.len * grow; at += step) {
        const p = along(e, at / e.len);
        dots.moveTo(p.x + 0.6, p.y);
        dots.arc(p.x, p.y, 0.6, 0, TAU);
      }
      api.draw.neon(ctx, dots, color, Math.max(1.2, w * 0.7), alpha * 0.7);
      if (grow < 1) return;
      const a = Math.atan2(uy, ux);
      const half = e.len / 2;
      for (const [x, y, dir] of [[e.x0, e.y0, 0], [e.x1, e.y1, Math.PI]]) {
        for (let i = 0; i < 3; i++) {
          const phase = t === 0 ? (i + 1) / 4 : ((t * 0.7 + i / 3 + seed) % 1);
          const r = 6 + phase * (half - 6);
          const spread = Math.min(0.6, (11 * scale + 6) / r);
          const arc = new Path2D();
          arc.arc(x, y, r, a + dir - spread, a + dir + spread);
          api.draw.neon(ctx, arc, color, Math.max(1.2, w * 0.7), alpha * (t === 0 ? 0.8 : Math.sin(phase * Math.PI)));
        }
      }
      return;
    }

    // Cuivre : trait plein, paquets réguliers.
    api.draw.neon(ctx, line, color, w, alpha * 0.9, 0, dash ? { width: w } : null);
    if (moving) packets(e, t, seed, 110 * scale, 90, (k) => {
      const p = along(e, k);
      api.draw.glowDot(ctx, p.x, p.y, w * 2.6, color, alpha * 0.95);
    });
  }

  /** Petit cadenas néon, pour les liens VPN. */
  const lockIcon = (color) => (ctx, x, y, s, alpha) => {
    ctx.save();
    ctx.translate(x, y + s * 0.1);
    api.draw.neon(ctx, lockPath(s), color, 1.3, alpha);
    ctx.restore();
  };

  const linkWidth = (o) => Math.max(1.5, o.width * 0.5);

  api.defineObject('lien', {
    layer: 0,
    animated: () => !paused,
    center(o) {
      const e = ends(o);
      return e && along(e, 0.5);
    },
    hit(o, p, r) {
      const e = ends(o);
      if (!e) return false;
      const dx = e.x1 - e.x0, dy = e.y1 - e.y0;
      const k = Math.max(0, Math.min(1, ((p.x - e.x0) * dx + (p.y - e.y0) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(p.x - (e.x0 + dx * k), p.y - (e.y0 + dy * k)) < r + 4) return true;
      // L'étiquette du milieu compte aussi (largeur estimée).
      if (!o.label) return false;
      const m = along(e, 0.5);
      return Math.abs(p.x - m.x) < o.label.length * 3.6 + 16 + r && Math.abs(p.y - m.y) < 10 + r;
    },
    draw(ctx, o, f) {
      const e = ends(o);
      if (!e) return;
      // Le lien se trace depuis le premier appareil.
      const grow = Math.min(1, f.intro * 1.6);
      const kind = o.cable ?? 'cuivre';
      drawCable(ctx, kind, e, o.color, linkWidth(o), f.life, paused ? 0 : f.now / 1000, o.seed, { grow, dash: o.dash });
      if (grow < 1) return;
      // Au milieu : l'étiquette, précédée d'un cadenas pour un VPN.
      const m = along(e, 0.5);
      const alpha = f.life * Math.min(1, (f.intro * 1.6 - 1) * 4 + 0.4);
      tag(ctx, o.label, m.x, m.y, o.color, alpha, { size: 12, icon: kind === 'vpn' ? lockIcon(o.color) : null });
    },
  });

  // Zone : rectangle arrondi en pointillés, à peine teinté, nommé en haut à gauche.
  // Elle passe sous les liens et les appareils (layer -1).
  const ZONE_R = 16;

  function drawZone(ctx, z, color, alpha) {
    if (alpha <= 0) return;
    const p = new Path2D();
    roundRect(p, z.x, z.y, z.w, z.h, Math.min(ZONE_R, z.w / 2, z.h / 2));
    ctx.save();
    ctx.globalAlpha = alpha * (color.hex === DARK_INK ? 0.08 : 0.06);
    ctx.fillStyle = color.hex;
    ctx.fill(p);
    ctx.restore();
    api.draw.neon(ctx, p, color, 1.6, alpha * 0.85, 0, { width: 2.2 });
    if (z.name) {
      const w = tagWidth(ctx, z.name, 13);
      tag(ctx, z.name, z.x + ZONE_R + 4 + w / 2, z.y, color, alpha, { size: 13 });
    }
  }

  api.defineObject('zone', {
    layer: -1,
    center: (z) => ({ x: z.x + z.w / 2, y: z.y + z.h / 2 }),
    // La gomme prend la zone par son bord ou son nom : passer dedans laisse la zone en place.
    hit(z, p, r) {
      const m = r + 5;
      const inX = p.x > z.x - m && p.x < z.x + z.w + m, inY = p.y > z.y - m && p.y < z.y + z.h + m;
      const nearV = Math.abs(p.x - z.x) < m || Math.abs(p.x - z.x - z.w) < m;
      const nearH = Math.abs(p.y - z.y) < m || Math.abs(p.y - z.y - z.h) < m;
      if ((nearV && inY) || (nearH && inX)) return true;
      const nameW = z.name ? z.name.length * 7.5 + 30 : 0;
      return !!z.name && p.x > z.x + ZONE_R - r && p.x < z.x + ZONE_R + 4 + nameW + r && Math.abs(p.y - z.y) < 12 + r;
    },
    draw(ctx, z, f) {
      // Apparition : la zone se déplie depuis son centre.
      const k = f.intro < 1 ? 0.92 + 0.08 * Math.min(1, f.intro * 1.4) : 1;
      const box = k === 1 ? z : { name: z.name, x: z.x + (z.w * (1 - k)) / 2, y: z.y + (z.h * (1 - k)) / 2, w: z.w * k, h: z.h * k };
      drawZone(ctx, box, z.color, f.life * Math.min(1, f.intro * 1.5));
    },
  });

  /** Saisie de l'étiquette d'un appareil, d'un lien ou du nom d'une zone. Texte vide : l'enlève. */
  async function editLabel(o) {
    const isZone = o.type.endsWith('.zone');
    const key = isZone ? 'name' : 'label';
    let at;
    if (isZone) at = { x: o.x + ZONE_R + 134, y: o.y - 10 };
    else if (o.type.endsWith('.lien')) at = ends(o) ? along(ends(o), 0.5) : api.pointer;
    else at = { x: o.x, y: o.y + o.size * 1.25 + 4 };
    const text = await api.prompt({
      x: at.x,
      y: at.y,
      value: o[key] ?? '',
      placeholder: isZone ? 'Nom de la zone (DMZ, LAN, WAN…)' : 'Nom, IP (192.168.1.0/24), VLAN 10…',
    });
    if (text === null || o.dying || text === (o[key] ?? '')) return;
    o[key] = text;
    api.changed();
  }

  /** Roue des appareils (touche J, ou touche des formes quand l'outil réseau est actif). */
  function deviceWheel() {
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

  /** Roue des types de câble (Alt+J). */
  function cableWheel() {
    api.wheel({
      items: CABLES.map((c, i) => ({
        label: c.label,
        draw(ctx, x, y, s, color, alpha, now) {
          const half = s * 1.6;
          const e = { x0: x - half, y0: y + s * 0.15, x1: x + half, y1: y + s * 0.15, len: half * 2 };
          drawCable(ctx, c.kind, e, color, 2.2, alpha, clock(now), i / 4, { scale: 0.45 });
          if (c.kind === 'vpn') lockIcon(color)(ctx, x, y - s * 0.6, s * 0.4, alpha);
        },
      })),
      selected: cable,
      onPick(i) {
        cable = i;
        api.useTool('reseau');
        api.refreshHud();
      },
    });
  }

  api.defineTool('reseau', {
    wheel: deviceWheel,
    label: () => `Réseau : ${ICON[DEVICES[current].kind]} ${DEVICES[current].label} · ${CABLES[cable].icon} ${CABLES[cable].label}`,
    busy: () => !!linking,
    down(p, e) {
      if (e?.shiftKey) {
        // Maj+clic : étiquette de l'appareil, du lien ou de la zone visés.
        editing = deviceAt(p) ?? linkAt(p) ?? zoneAt(p);
        if (editing) {
          e.preventDefault?.();
          return;
        }
      }
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
      if (editing) {
        const o = editing;
        editing = null;
        editLabel(o);
        return;
      }
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
      editing = null;
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

  api.defineTool('zone', {
    label: () => 'Réseau : ⬚ Zone',
    busy: () => !!drawing || !!editing,
    down(p, e) {
      const z = zoneAt(p);
      if (e?.shiftKey && z) {
        editing = z;
        e.preventDefault?.();
        return;
      }
      const at = api.snap(p);
      drawing = { a: at, b: at, over: z };
    },
    move(p) {
      if (!drawing) return;
      drawing.b = api.snap(p);
      api.render();
    },
    up(p) {
      if (editing) {
        const o = editing;
        editing = null;
        editLabel(o);
        return;
      }
      if (!drawing) return;
      const { a, over } = drawing;
      drawing = null;
      const r = rectOf(a, api.snap(p));
      api.render();
      if (r.w < 24 || r.h < 24) {
        // Simple clic : renomme la zone visée.
        if (over) editLabel(over);
        return;
      }
      const z = api.add('zone', { ...r, name: '' });
      editLabel(z);
    },
    cancel() {
      drawing = null;
      editing = null;
    },
    preview(ctx) {
      if (!drawing) return;
      drawZone(ctx, rectOf(drawing.a, drawing.b), api.color, 0.6);
    },
    cursor(ctx, p) {
      if (drawing) return;
      // Petit coin de zone près du pointeur.
      const at = api.snap(p);
      const c = new Path2D();
      c.moveTo(at.x, at.y + 18);
      c.lineTo(at.x, at.y + 6);
      c.arcTo(at.x, at.y, at.x + 6, at.y, 6);
      c.lineTo(at.x + 18, at.y);
      api.draw.neon(ctx, c, api.color, 1.6, 0.7, 0, { width: 2.2 });
    },
  });

  api.defineAction('reseau', {
    label: 'Roue des appareils réseau',
    hint: 'Maintenir et relâcher sur un appareil, ou appuyer puis cliquer · glisser d’un appareil à l’autre : relier · Maj+clic : étiquette',
    key: 'J',
    run: () => deviceWheel(),
  });

  api.defineAction('cable', {
    label: 'Type de câble réseau',
    hint: 'Cuivre, fibre, VPN ou sans fil, pour les nouveaux liens',
    key: 'Alt+J',
    run: () => cableWheel(),
  });

  api.defineAction('zone', {
    label: 'Zone réseau',
    hint: 'Glisser pour tracer une zone (DMZ, LAN, WAN…), puis taper son nom · clic sur une zone : la renommer',
    key: 'Ctrl+J',
    run: () => api.useTool('zone'),
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
