// Plugin « Organigramme » pour NeonInk : organigrammes (logigrammes) en néon, avec des formes
// qui portent du texte et des flèches accrochées à leurs bords.
//
// Touche Q (par défaut) : roue des formes (Étape, Décision, Début / fin, Données, Document,
// Sous-processus). Maintenir Q, viser la forme, relâcher ; ou appuyer sur Q puis cliquer.
// Quand l'outil est actif, la touche des formes (M, clic molette) rouvre cette roue.
//  - clic dans le vide : pose la forme (aimantée au quadrillage sur papier à carreaux) et
//    demande son texte (Entrée pour valider) ;
//  - glisser d'une forme à une autre : flèche qui les relie, accrochée à leurs bords ;
//  - glisser d'une forme vers le vide : pose une nouvelle forme, déjà reliée ;
//  - Ctrl + glisser une forme : la déplace, ses flèches suivent ;
//  - Maj + clic sur une forme : modifier son texte ; sur une flèche : son étiquette (« oui », « non »).
// La gomme efface une forme et ses flèches, ou une flèche seule.

export const manifest = {
  id: 'organigramme',
  nom: 'Organigramme',
  description: 'Organigrammes : étapes, décisions, début / fin, données, documents et sous-processus reliés par des flèches.',
  version: '1.0.0',
  api: 1,
};

const SHAPES = [
  { kind: 'etape', label: 'Étape', icon: '▢', wrap: 170 },
  { kind: 'decision', label: 'Décision', icon: '◇', wrap: 120 },
  { kind: 'terminal', label: 'Début / fin', icon: '⬭', wrap: 160 },
  { kind: 'donnees', label: 'Données', icon: '▱', wrap: 150 },
  { kind: 'document', label: 'Document', icon: '▤', wrap: 160 },
  { kind: 'sousprocessus', label: 'Sous-processus', icon: '⊟', wrap: 160 },
];
const byKind = (kind) => SHAPES.find((s) => s.kind === kind) ?? SHAPES[0];
const TAU = Math.PI * 2;
const DRAG = 8; // déplacement minimal pour qu'un clic devienne un glisser

const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const font = (size, weight = 600) => `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;

function mix(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  return '#' + [16, 8, 0].map((s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t).toString(16).padStart(2, '0')).join('');
}

// Mesure du texte hors du dessin (taille des formes, accroche des flèches, gomme).
let measurer = null;
function measure(text, size) {
  measurer ??= document.createElement('canvas').getContext('2d');
  measurer.font = font(size);
  return measurer.measureText(text).width;
}

/** Découpe `text` en lignes d'au plus `max` pixels (les mots trop longs sont coupés). */
function wrap(text, size, max) {
  const lines = [];
  for (const para of String(text).split(/\s*\\n\s*|\n/)) {
    let line = '';
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (measure(word, size) > max && word.length > 1) {
        // Mot plus long que la ligne : coupé au dernier caractère qui tient.
        if (line) {
          lines.push(line);
          line = '';
        }
        let n = word.length - 1;
        while (n > 1 && measure(word.slice(0, n), size) > max) n--;
        lines.push(word.slice(0, n));
        word = word.slice(n);
      }
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, size) > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

/** Contour de la forme, centré sur (0, 0), demi-largeur `w`, demi-hauteur `h` : liste de points. */
function outline(kind, w, h) {
  const pts = [];
  const arc = (cx, cy, r, a0, a1, n = 8) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
  };
  if (kind === 'decision') return [{ x: 0, y: -h }, { x: w, y: 0 }, { x: 0, y: h }, { x: -w, y: 0 }];
  if (kind === 'donnees') {
    const s = Math.min(h * 0.6, w * 0.3);
    return [{ x: -w + s, y: -h }, { x: w, y: -h }, { x: w - s, y: h }, { x: -w, y: h }];
  }
  if (kind === 'terminal') {
    const r = h;
    arc(w - r, 0, r, -Math.PI / 2, Math.PI / 2, 12);
    arc(-w + r, 0, r, Math.PI / 2, Math.PI * 1.5, 12);
    return pts;
  }
  if (kind === 'document') {
    // Bas ondulé : une vague qui descend à gauche et remonte à droite.
    const a = h * 0.16;
    pts.push({ x: -w, y: -h }, { x: w, y: -h });
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      pts.push({ x: w - 2 * w * k, y: h - a - a * Math.sin(k * TAU) });
    }
    return pts;
  }
  if (kind === 'sousprocessus') return [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }];
  // Étape : rectangle aux coins arrondis.
  const r = Math.min(10, h * 0.4);
  arc(w - r, -h + r, r, -Math.PI / 2, 0);
  arc(w - r, h - r, r, 0, Math.PI / 2);
  arc(-w + r, h - r, r, Math.PI / 2, Math.PI);
  arc(-w + r, -h + r, r, Math.PI, Math.PI * 1.5);
  return pts;
}

/** Taille d'une forme selon son texte : { lines, w, h } (demi-dimensions). */
function layout(kind, text, size) {
  const lines = text ? wrap(text, size, byKind(kind).wrap) : [];
  const lh = size * 1.3;
  const tw = Math.max(0, ...lines.map((l) => measure(l, size)));
  const th = lines.length * lh;
  let w, h;
  switch (kind) {
    case 'decision': // le texte tient dans le losange : (tw/2)/w + (th/2)/h ≤ 1
      w = Math.max(64, tw / 2 + th * 0.9 + 18);
      h = Math.max(40, (th / 2) / Math.max(0.3, 1 - tw / 2 / w) + 6);
      break;
    case 'terminal':
      h = Math.max(22, th / 2 + 9);
      w = Math.max(64, tw / 2 + h * 0.8 + 8);
      break;
    case 'donnees':
      h = Math.max(24, th / 2 + 12);
      w = Math.max(70, tw / 2 + 16 + Math.min(h * 0.6, 40));
      break;
    case 'document':
      h = Math.max(30, (th / 2 + 12) * 1.18);
      w = Math.max(70, tw / 2 + 18);
      break;
    case 'sousprocessus':
      h = Math.max(24, th / 2 + 12);
      w = Math.max(76, tw / 2 + 30);
      break;
    default:
      h = Math.max(24, th / 2 + 12);
      w = Math.max(64, tw / 2 + 18);
  }
  return { lines, w: Math.ceil(w), h: Math.ceil(h) };
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const k = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

/** Point où la demi-droite partant du centre de `o` vers (dx, dy) sort de son contour. */
function border(o, dx, dy) {
  const pts = outline(o.shape, o.w, o.h);
  let best = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[j], b = pts[i];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = (a.x * ey - a.y * ex) / den; // le long du rayon
    const u = (a.x * dy - a.y * dx) / den; // le long du côté
    if (t > 0 && u >= 0 && u <= 1) best = Math.max(best, t);
  }
  return { x: o.x + dx * best, y: o.y + dy * best };
}

export function activate(api) {
  if (!api.prompt) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // forme choisie
  let gesture = null; // { mode: 'place' | 'link' | 'move' | 'edit', … }
  const known = new Map(); // id → forme, pour que les flèches s'effacent en douceur avec elles

  const fontSize = (o) => clamp(Math.round(12 + o.width * 0.6), 14, 26);
  const lineWidth = (o) => clamp(o.width * 0.45, 1.6, 4);
  const shapeAt = (p, r = 4) => api.objectAt(p, r, 'forme');
  // Texte : éclairci sur fond sombre, assombri sur papier clair pour rester lisible.
  const light = () => !!api.board && api.board !== 'black';
  const ink = (color) => (color.hex === api.palette.k?.hex ? color.hex : mix(color.hex, light() ? '#000000' : '#ffffff', light() ? 0.3 : 0.35));
  const glow = (size) => size * (light() ? 0.15 : 0.6);

  function resize(o) {
    const l = layout(o.shape, o.text, fontSize(o));
    o.lines = l.lines;
    o.w = l.w;
    o.h = l.h;
  }

  function addShape(p, kind = SHAPES[current].kind) {
    const at = api.snap(p);
    const o = api.add('forme', { x: at.x, y: at.y, shape: kind, text: '' });
    resize(o);
    known.set(o.id, o);
    return o;
  }

  /** Demande le texte de la forme, sous elle. */
  async function editText(o) {
    const text = await api.prompt({ x: o.x, y: o.y + o.h, value: o.text, placeholder: `Texte : ${byKind(o.shape).label.toLowerCase()}` });
    if (text === null && o.text) return; // Échap : on garde le texte d'avant
    o.text = text ?? '';
    resize(o);
    api.changed();
  }

  async function editLabel(f) {
    const e = ends(f);
    const m = e ? { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 } : api.pointer;
    const text = await api.prompt({ x: m.x, y: m.y, value: f.label ?? '', placeholder: 'Étiquette : oui, non…' });
    if (text === null && f.label) {
      // Champ vidé puis validé : on retire l'étiquette ; Échap : on la garde.
      return;
    }
    f.label = text ?? '';
    api.changed();
  }

  function link(a, b) {
    if (a === b) return null;
    const exists = api.objects('fleche').find((f) => f.a === a.id && f.b === b.id);
    return exists ?? api.add('fleche', { a: a.id, b: b.id, label: '', deps: [a.id, b.id] });
  }

  // ───────── Formes ─────────

  function shapePath(kind, x, y, w, h) {
    const p = new Path2D();
    const pts = outline(kind, w, h);
    p.moveTo(x + pts[0].x, y + pts[0].y);
    for (const q of pts.slice(1)) p.lineTo(x + q.x, y + q.y);
    p.closePath();
    if (kind === 'sousprocessus') {
      // Doubles côtés.
      const k = Math.min(12, w * 0.15);
      p.moveTo(x - w + k, y - h);
      p.lineTo(x - w + k, y + h);
      p.moveTo(x + w - k, y - h);
      p.lineTo(x + w - k, y + h);
    }
    return p;
  }

  function drawShape(ctx, kind, x, y, w, h, color, width, alpha, boost = 0) {
    const path = shapePath(kind, x, y, w, h);
    ctx.save();
    ctx.globalAlpha = alpha * 0.1;
    ctx.fillStyle = color.hex;
    ctx.fill(path);
    ctx.restore();
    api.draw.neon(ctx, path, color, width, alpha, boost);
  }

  function drawLines(ctx, o, x, y, size, alpha) {
    if (!o.lines?.length || alpha <= 0) return;
    const lh = size * 1.3;
    // Le document a son centre visuel un peu plus haut, à cause de la vague.
    const cy = y - (o.shape === 'document' ? o.h * 0.08 : 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = o.color.glow;
    ctx.shadowBlur = glow(size);
    ctx.fillStyle = ink(o.color);
    o.lines.forEach((l, i) => ctx.fillText(l, x, cy + (i - (o.lines.length - 1) / 2) * lh));
    ctx.restore();
  }

  api.defineObject('forme', {
    layer: 1,
    center: (o) => o,
    hit(o, p, r) {
      if (Math.abs(p.x - o.x) > o.w + r || Math.abs(p.y - o.y) > o.h + r) return false;
      const pts = outline(o.shape, o.w, o.h).map((q) => ({ x: o.x + q.x, y: o.y + q.y }));
      if (pointInPoly(p, pts)) return true;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) if (segDist(p, pts[j], pts[i]) < r + 2) return true;
      return false;
    },
    draw(ctx, o, f) {
      known.set(o.id, o);
      const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(f.intro)) : 1;
      drawShape(ctx, o.shape, o.x, o.y, o.w * pop, o.h * pop, o.color, lineWidth(o), f.life, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
      drawLines(ctx, o, o.x, o.y, fontSize(o), f.life * clamp(f.intro * 2 - 0.6, 0, 1));
    },
  });

  // ───────── Flèches ─────────

  /** Extrémités de la flèche, sur les bords des deux formes, recalculées à chaque dessin. */
  function ends(f) {
    const a = known.get(f.a), b = known.get(f.b);
    if (!a || !b) return null;
    const d = dist(a, b);
    if (d < 1) return null;
    const ux = (b.x - a.x) / d, uy = (b.y - a.y) / d;
    const p0 = border(a, ux, uy), p1 = border(b, -ux, -uy);
    const gap = 3;
    const x0 = p0.x + ux * gap, y0 = p0.y + uy * gap, x1 = p1.x - ux * gap, y1 = p1.y - uy * gap;
    if ((x1 - x0) * ux + (y1 - y0) * uy < 12) return null; // formes qui se chevauchent
    return { x0, y0, x1, y1, ux, uy };
  }

  function arrowPath(x0, y0, x1, y1, head) {
    const p = new Path2D();
    const a = Math.atan2(y1 - y0, x1 - x0);
    p.moveTo(x0, y0);
    p.lineTo(x1, y1);
    p.moveTo(x1 - head * Math.cos(a - 0.45), y1 - head * Math.sin(a - 0.45));
    p.lineTo(x1, y1);
    p.lineTo(x1 - head * Math.cos(a + 0.45), y1 - head * Math.sin(a + 0.45));
    return p;
  }

  /** Étiquette posée sur la flèche, sur un fond qui masque le trait. */
  function drawTag(ctx, text, x, y, color, size, alpha) {
    ctx.save();
    ctx.font = font(size);
    const w = ctx.measureText(text).width + 12, h = size + 8;
        ctx.globalAlpha = alpha;
    ctx.fillStyle = light() ? 'rgba(251,251,246,0.95)' : 'rgba(8,10,20,0.88)';
    const pill = new Path2D();
    if (pill.roundRect) pill.roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    else pill.rect(x - w / 2, y - h / 2, w, h);
    ctx.fill(pill);
    ctx.restore();
    api.draw.neon(ctx, pill, color, 1, alpha * 0.6);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font(size);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = glow(size);
    ctx.fillStyle = ink(color);
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }

  api.defineObject('fleche', {
    layer: 0,
    center(f) {
      const e = ends(f);
      return e && { x: (e.x0 + e.x1) / 2, y: (e.y0 + e.y1) / 2 };
    },
    hit(f, p, r) {
      const e = ends(f);
      return !!e && segDist(p, { x: e.x0, y: e.y0 }, { x: e.x1, y: e.y1 }) < r + 5;
    },
    draw(ctx, f, fr) {
      const e = ends(f);
      if (!e) return;
      const grow = Math.min(1, fr.intro * 1.6);
      const x1 = e.x0 + (e.x1 - e.x0) * grow, y1 = e.y0 + (e.y1 - e.y0) * grow;
      const w = lineWidth(f);
      api.draw.neon(ctx, arrowPath(e.x0, e.y0, x1, y1, 9 + w * 2), f.color, w, fr.life, 0, f.dash ? { width: w } : null);
      if (f.label && grow >= 1) {
        // Étiquette près du départ (lisible pour les branches d'une décision). Sur une flèche
        // trop courte pour la porter, elle se met à côté : au-dessus, ou à droite si la flèche descend.
        const size = clamp(fontSize(f) - 2, 12, 22);
        const len = Math.hypot(e.x1 - e.x0, e.y1 - e.y0);
        const k = len > 120 ? 0.4 : 0.5;
        let x = e.x0 + (e.x1 - e.x0) * k, y = e.y0 + (e.y1 - e.y0) * k;
        if (len < measure(f.label, size) + size * 3 + 20) {
          if (Math.abs(e.ux) > Math.abs(e.uy)) y -= size + 2;
          else x += measure(f.label, size) / 2 + 14;
        }
        drawTag(ctx, f.label, x, y, f.color, size, fr.life);
      }
    },
  });

  // ───────── Roue et outil ─────────

  function shapeWheel() {
    api.wheel({
      items: SHAPES.map((s) => ({
        label: s.label,
        draw(ctx, x, y, size, color, alpha) {
          const w = size * 1.25, h = s.kind === 'decision' ? size * 0.95 : size * 0.72;
          drawShape(ctx, s.kind, x, y, w, h, color, 2.2, alpha);
        },
      })),
      selected: current,
      onPick(i) {
        current = i;
        api.useTool('organigramme');
        api.refreshHud();
      },
    });
  }

  api.defineTool('organigramme', {
    wheel: shapeWheel,
    label: () => `Organigramme : ${SHAPES[current].icon} ${SHAPES[current].label}`,
    busy: () => !!gesture && gesture.mode !== 'edit',
    down(p, e) {
      const shape = shapeAt(p);
      if (e?.shiftKey) {
        // Maj + clic : texte de la forme, ou étiquette de la flèche (la saisie s'ouvre au relâcher).
        const target = shape ?? api.objectAt(p, 6, 'fleche');
        gesture = target ? { mode: 'edit', target } : null;
      } else if (e?.ctrlKey && shape) {
        gesture = { mode: 'move', o: shape, dx: shape.x - p.x, dy: shape.y - p.y };
      } else if (shape) {
        gesture = { mode: 'link', from: shape, to: p };
      } else {
        gesture = { mode: 'place', at: p };
      }
    },
    move(p) {
      if (!gesture) return;
      if (gesture.mode === 'move') {
        const at = api.snap({ x: p.x + gesture.dx, y: p.y + gesture.dy });
        if (at.x !== gesture.o.x || at.y !== gesture.o.y) {
          gesture.o.x = at.x;
          gesture.o.y = at.y;
          api.changed();
        }
      } else if (gesture.mode === 'link') {
        gesture.to = p;
        api.render();
      }
    },
    up(p) {
      const g = gesture;
      gesture = null;
      if (!g) return;
      if (g.mode === 'edit') {
        if (g.target.type.endsWith('.forme')) editText(g.target);
        else editLabel(g.target);
      } else if (g.mode === 'place') {
        editText(addShape(g.at));
      } else if (g.mode === 'link') {
        const over = shapeAt(p);
        if (over === g.from || dist(g.from, p) < DRAG) return api.render();
        if (over) link(g.from, over);
        else {
          const o = addShape(p);
          link(g.from, o);
          editText(o);
        }
      }
      api.render();
    },
    cancel() {
      gesture = null;
    },
    preview(ctx) {
      if (gesture?.mode !== 'link') return;
      const { from, to } = gesture;
      const d = dist(from, to);
      if (d < from.w * 0.3) return;
      const s = border(from, (to.x - from.x) / d, (to.y - from.y) / d);
      api.draw.neon(ctx, arrowPath(s.x, s.y, to.x, to.y, 12), api.color, 2, 0.6, 0, { width: 2 });
    },
    cursor(ctx, p, now) {
      if (gesture) return;
      const over = shapeAt(p);
      if (over) {
        // Au-dessus d'une forme : un contour pulsé invite à glisser pour la relier.
        const k = 6 + Math.sin(now / 160) * 2;
        api.draw.neon(ctx, shapePath(over.shape, over.x, over.y, over.w + k, over.h + k), over.color, 1.2, 0.6, 0, { width: 1.5 });
        return;
      }
      const at = api.snap(p);
      const kind = SHAPES[current].kind;
      const l = layout(kind, '', 15);
      drawShape(ctx, kind, at.x, at.y, l.w, l.h, api.color, 2, 0.35);
    },
  });

  api.defineAction('organigramme', {
    label: 'Roue de l’organigramme',
    hint: 'Clic : poser et écrire · glisser d’une forme à l’autre : flèche · Ctrl+glisser : déplacer · Maj+clic : modifier le texte ou l’étiquette',
    key: 'Q',
    run: () => shapeWheel(),
  });
}
