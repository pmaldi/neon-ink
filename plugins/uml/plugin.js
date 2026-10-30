// Plugin « UML et bases de données » pour NeonInk : tables de base de données et classes UML
// en néon, reliées par des relations (pattes de corbeau) ou par des flèches d'héritage.
//
// Maj+Q (par défaut) : roue UML (Table, Classe, Relation 1-1, 1-N, N-N, Héritage). Maintenir
// Maj+Q, viser, relâcher ; ou appuyer puis cliquer. Quand l'outil est actif, la touche des formes
// (M, clic molette) rouvre cette roue.
//  - Table ou Classe choisie, clic dans le vide : pose l'élément et demande son contenu :
//      table  « Client: id PK, nom, email, pays_id FK »  (PK = clé primaire, FK = clé étrangère)
//      classe « Chien: -nom, +age: int | +aboyer(), +manger(x, y) »  (attributs | méthodes)
//  - Relation choisie, glisser d'une table (ou classe) à une autre : les relie.
//      1-N : glisser du côté « 1 » vers le côté « N » (de Client vers Commande) ;
//      Héritage : glisser de la classe fille vers la classe mère.
//    Avec Table ou Classe choisie, glisser de l'une à l'autre utilise la dernière relation
//    choisie ; glisser vers le vide pose un nouvel élément, déjà relié.
//  - Ctrl + glisser : déplace une table ou une classe, ses relations suivent ;
//  - Maj + clic : modifie son contenu.
// La gomme efface un élément et ses relations, ou une relation seule.

export const manifest = {
  id: 'uml',
  nom: 'UML et bases de données',
  description: 'Tables de base de données et classes UML, reliées par des relations 1-1, 1-N, N-N ou d’héritage.',
  version: '1.0.0',
  api: 1,
};

const ITEMS = [
  { kind: 'table', label: 'Table (BDD)', icon: '▦' },
  { kind: 'classe', label: 'Classe', icon: '▤' },
  { kind: '11', label: 'Relation 1-1', icon: '┼┼', rel: true },
  { kind: '1n', label: 'Relation 1-N', icon: '┼<', rel: true },
  { kind: 'nn', label: 'Relation N-N', icon: '>‹', rel: true },
  { kind: 'heritage', label: 'Héritage', icon: '△', rel: true },
];
const PLACEHOLDER = {
  table: 'Client: id PK, nom, email, pays_id FK',
  classe: 'Chien: -nom, +age: int | +aboyer(), +manger()',
};
const DRAG = 8;
const PAD = 12; // marge intérieure
const KEY_W = 22; // colonne des clés

const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const font = (size, weight = 600) => `${weight} ${size}px "Segoe UI", system-ui, sans-serif`;

function mix(a, b, t) {
  const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  return '#' + [16, 8, 0].map((s) => Math.round(((A >> s) & 255) + (((B >> s) & 255) - ((A >> s) & 255)) * t).toString(16).padStart(2, '0')).join('');
}

let measurer = null;
function measure(text, size, weight = 600) {
  measurer ??= document.createElement('canvas').getContext('2d');
  measurer.font = font(size, weight);
  return measurer.measureText(text).width;
}

/** Découpe sur les virgules qui ne sont pas entre parenthèses (« manger(x, y) » reste entier). */
function splitTop(s, sep = ',') {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '<') depth++;
    else if ((ch === ')' || ch === ']' || ch === '>') && depth) depth--;
    if (ch === sep && !depth) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

/** « Nom: reste » → [nom, reste] ; sans deux-points, tout est le nom. */
function head(text) {
  const i = text.indexOf(':');
  return i < 0 ? [text.trim(), ''] : [text.slice(0, i).trim(), text.slice(i + 1)];
}

/** Colonnes d'une table : « id PK », « pays_id FK », « id PK FK »… */
function parseTable(text) {
  const [name, rest] = head(text);
  const cols = splitTop(rest).map((c) => {
    const words = c.split(/\s+/);
    let pk = false, fk = false;
    const kept = words.filter((w) => {
      const u = w.toUpperCase().replace(/[(),]/g, '');
      if (u === 'PK' || u === 'PK/FK' || u === 'PFK') pk = true;
      if (u === 'FK' || u === 'PK/FK' || u === 'PFK') fk = true;
      return !['PK', 'FK', 'PK/FK', 'PFK'].includes(u);
    });
    return { name: kept.join(' ') || c, pk, fk };
  });
  return { name: name || 'Table', cols };
}

/** Classe : « Nom: attributs | méthodes ». */
function parseClass(text) {
  const [name, rest] = head(text);
  const parts = rest.split('|');
  return { name: name || 'Classe', attrs: splitTop(parts[0] ?? ''), methods: splitTop(parts.slice(1).join('|')) };
}

function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const k = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(p.x - (a.x + dx * k), p.y - (a.y + dy * k));
}

export function activate(api) {
  if (!api.prompt) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // choix de la roue
  let relKind = '1n'; // dernière relation choisie
  let gesture = null;
  const known = new Map(); // id → élément, pour que les relations s'effacent en douceur avec lui

  const size = (o) => clamp(Math.round(10 + o.width * 0.8), 13, 24);
  const lineWidth = (o) => clamp(o.width * 0.45, 1.6, 4);
  const entityAt = (p, r = 4) => api.objectAt(p, r, 'table') ?? api.objectAt(p, r, 'classe');
  // Texte : éclairci sur fond sombre, assombri sur papier clair pour rester lisible.
  const light = () => !!api.board && api.board !== 'black';
  const ink = (color) => (color.hex === api.palette.k?.hex ? color.hex : mix(color.hex, light() ? '#000000' : '#ffffff', light() ? 0.3 : 0.35));
  const glow = (size) => size * (light() ? 0.15 : 0.6);
  const lineH = (o) => Math.round(size(o) * 1.55);
  const headH = (o) => Math.round(size(o) * 2.1);

  /** Calcule le contenu et la taille (o.w, o.h : dimensions totales, o.x, o.y : centre). */
  function resize(o) {
    const s = size(o), lh = lineH(o);
    if (o.type.endsWith('.table')) {
      const t = parseTable(o.text);
      o.name = t.name;
      o.cols = t.cols;
      const fkW = measure('FK', s * 0.72, 700) + 10;
      const colW = Math.max(0, ...t.cols.map((c) => measure(c.name, s) + (c.fk ? fkW : 0)));
      o.w = Math.ceil(Math.max(120, measure(t.name, s + 1, 700) + PAD * 2, colW + KEY_W + PAD * 2));
      o.h = headH(o) + Math.max(1, t.cols.length) * lh + 8;
    } else {
      const c = parseClass(o.text);
      o.name = c.name;
      o.attrs = c.attrs;
      o.methods = c.methods;
      const textW = Math.max(0, ...[...c.attrs, ...c.methods].map((x) => measure(x, s)));
      o.w = Math.ceil(Math.max(130, measure(c.name, s + 1, 700) + PAD * 2, textW + PAD * 2));
      const box = (n) => Math.max(1, n) * lh + 8;
      o.h = headH(o) + box(c.attrs.length) + box(c.methods.length);
    }
  }

  function addEntity(p, kind) {
    const at = api.snap(p);
    const o = api.add(kind, { x: at.x, y: at.y, text: '' });
    resize(o);
    known.set(o.id, o);
    return o;
  }

  async function edit(o) {
    const kind = o.type.endsWith('.table') ? 'table' : 'classe';
    const text = await api.prompt({ x: o.x, y: o.y + o.h / 2, value: o.text, placeholder: PLACEHOLDER[kind] });
    if (text === null && o.text) return; // Échap : on garde le contenu
    o.text = text ?? '';
    resize(o);
    api.changed();
  }

  function relate(a, b, kind) {
    if (a === b) return;
    const same = api.objects('relation').find((r) => (r.a === a.id && r.b === b.id) || (r.a === b.id && r.b === a.id));
    if (same) {
      // Déjà reliés : la relation change de type (et de sens).
      Object.assign(same, { a: a.id, b: b.id, rel: kind });
      return api.changed();
    }
    api.add('relation', { a: a.id, b: b.id, rel: kind, deps: [a.id, b.id] });
  }

  // ───────── Tables et classes ─────────

  function text(ctx, str, x, y, color, s, { weight = 600, align = 'left', alpha = 1, underline = false } = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font(s, weight);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color.glow;
    ctx.shadowBlur = glow(s);
    ctx.fillStyle = ink(color);
    ctx.fillText(str, x, y);
    if (underline) {
      const w = ctx.measureText(str).width;
      const x0 = align === 'center' ? x - w / 2 : x;
      ctx.fillRect(x0, y + s * 0.6, w, Math.max(1, s / 12));
    }
    ctx.restore();
  }

  /** Clé (clé primaire) : anneau et panneton, centrée sur (x, y). */
  function keyPath(x, y, s) {
    const p = new Path2D();
    const r = s * 0.24;
    p.arc(x - s * 0.22, y, r, 0, Math.PI * 2);
    p.moveTo(x - s * 0.22 + r, y);
    p.lineTo(x + s * 0.42, y);
    p.moveTo(x + s * 0.28, y);
    p.lineTo(x + s * 0.28, y + s * 0.2);
    p.moveTo(x + s * 0.4, y);
    p.lineTo(x + s * 0.4, y + s * 0.16);
    return p;
  }

  function boxPath(x, y, w, h) {
    const p = new Path2D();
    if (p.roundRect) p.roundRect(x, y, w, h, 6);
    else p.rect(x, y, w, h);
    return p;
  }

  function fillBox(ctx, path, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color.hex;
    ctx.fill(path);
    ctx.restore();
  }

  function drawTable(ctx, o, f) {
    const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(f.intro)) : 1;
    const s = size(o), lh = lineH(o), hh = headH(o), lw = lineWidth(o);
    const alpha = f.life, textAlpha = f.life * clamp(f.intro * 2 - 0.6, 0, 1);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(pop, pop);
    const x = -o.w / 2, y = -o.h / 2;
    const outline = boxPath(x, y, o.w, o.h);
    fillBox(ctx, outline, o.color, alpha * 0.08);
    const header = new Path2D();
    if (header.roundRect) header.roundRect(x, y, o.w, hh, [6, 6, 0, 0]);
    else header.rect(x, y, o.w, hh);
    fillBox(ctx, header, o.color, alpha * 0.22);
    const sep = new Path2D();
    sep.moveTo(x, y + hh);
    sep.lineTo(x + o.w, y + hh);
    api.draw.neon(ctx, outline, o.color, lw, alpha, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
    api.draw.neon(ctx, sep, o.color, lw * 0.75, alpha);
    text(ctx, o.name, 0, y + hh / 2, o.color, s + 1, { weight: 700, align: 'center', alpha: textAlpha });
    o.cols.forEach((c, i) => {
      const cy = y + hh + 4 + lh * (i + 0.5);
      if (c.pk) api.draw.neon(ctx, keyPath(x + PAD + KEY_W / 2 - 4, cy, s * 1.05), o.color, 1.4, textAlpha);
      text(ctx, c.name, x + PAD + KEY_W, cy, o.color, s, { alpha: textAlpha, underline: c.pk, weight: c.pk ? 700 : 500 });
      if (c.fk) text(ctx, 'FK', x + o.w - PAD, cy, o.color, s * 0.72, { weight: 700, align: 'right', alpha: textAlpha * 0.8 });
    });
    if (!o.cols.length) text(ctx, '—', x + PAD + KEY_W, y + hh + 4 + lh / 2, o.color, s, { alpha: textAlpha * 0.5 });
    ctx.restore();
  }

  function drawClass(ctx, o, f) {
    const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(f.intro)) : 1;
    const s = size(o), lh = lineH(o), hh = headH(o), lw = lineWidth(o);
    const alpha = f.life, textAlpha = f.life * clamp(f.intro * 2 - 0.6, 0, 1);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(pop, pop);
    const x = -o.w / 2, y = -o.h / 2;
    const outline = boxPath(x, y, o.w, o.h);
    fillBox(ctx, outline, o.color, alpha * 0.08);
    const y1 = y + hh, y2 = y1 + Math.max(1, o.attrs.length) * lh + 8;
    const seps = new Path2D();
    seps.moveTo(x, y1);
    seps.lineTo(x + o.w, y1);
    seps.moveTo(x, y2);
    seps.lineTo(x + o.w, y2);
    api.draw.neon(ctx, outline, o.color, lw, alpha, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
    api.draw.neon(ctx, seps, o.color, lw * 0.75, alpha);
    text(ctx, o.name, 0, y + hh / 2, o.color, s + 1, { weight: 700, align: 'center', alpha: textAlpha });
    o.attrs.forEach((a, i) => text(ctx, a, x + PAD, y1 + 4 + lh * (i + 0.5), o.color, s, { weight: 500, alpha: textAlpha }));
    o.methods.forEach((m, i) => text(ctx, m, x + PAD, y2 + 4 + lh * (i + 0.5), o.color, s, { weight: 500, alpha: textAlpha }));
    ctx.restore();
  }

  const entityDef = (draw) => ({
    layer: 1,
    center: (o) => o,
    hit: (o, p, r) => Math.abs(p.x - o.x) < o.w / 2 + r && Math.abs(p.y - o.y) < o.h / 2 + r,
    draw(ctx, o, f) {
      known.set(o.id, o);
      draw(ctx, o, f);
    },
  });
  api.defineObject('table', entityDef(drawTable));
  api.defineObject('classe', entityDef(drawClass));

  // ───────── Relations ─────────

  /**
   * Tracé orthogonal entre les bords des deux éléments, recalculé à chaque dessin :
   * { pts, da, db } où da / db sont les directions sortantes à chaque bout (vers l'extérieur).
   */
  function route(r) {
    const a = known.get(r.a), b = known.get(r.b);
    if (!a || !b) return null;
    const ax0 = a.x - a.w / 2, ax1 = a.x + a.w / 2, ay0 = a.y - a.h / 2, ay1 = a.y + a.h / 2;
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2, by0 = b.y - b.h / 2, by1 = b.y + b.h / 2;
    const gapX = Math.max(bx0 - ax1, ax0 - bx1), gapY = Math.max(by0 - ay1, ay0 - by1);
    const MIN = 36; // place pour les symboles aux deux bouts
    if (gapX >= MIN && gapX >= gapY) {
      const dir = b.x > a.x ? 1 : -1;
      const xa = dir > 0 ? ax1 : ax0, xb = dir > 0 ? bx0 : bx1;
      const lo = Math.max(ay0, by0) + 14, hi = Math.min(ay1, by1) - 14;
      if (lo <= hi) {
        // Hauteurs communes : un seul segment horizontal.
        const y = (lo + hi) / 2;
        return { pts: [{ x: xa, y }, { x: xb, y }], da: { x: dir, y: 0 }, db: { x: -dir, y: 0 } };
      }
      const xm = (xa + xb) / 2;
      return { pts: [{ x: xa, y: a.y }, { x: xm, y: a.y }, { x: xm, y: b.y }, { x: xb, y: b.y }], da: { x: dir, y: 0 }, db: { x: -dir, y: 0 } };
    }
    if (gapY >= MIN) {
      const dir = b.y > a.y ? 1 : -1;
      const ya = dir > 0 ? ay1 : ay0, yb = dir > 0 ? by0 : by1;
      const lo = Math.max(ax0, bx0) + 14, hi = Math.min(ax1, bx1) - 14;
      if (lo <= hi) {
        const x = (lo + hi) / 2;
        return { pts: [{ x, y: ya }, { x, y: yb }], da: { x: 0, y: dir }, db: { x: 0, y: -dir } };
      }
      const ym = (ya + yb) / 2;
      return { pts: [{ x: a.x, y: ya }, { x: a.x, y: ym }, { x: b.x, y: ym }, { x: b.x, y: yb }], da: { x: 0, y: dir }, db: { x: 0, y: -dir } };
    }
    return null; // trop proches : rien à tracer
  }

  /** Symbole d'un bout : `end` sur le bord, `d` direction vers l'extérieur. */
  function endMark(path, end, d, mark) {
    const n = { x: -d.y, y: d.x }; // perpendiculaire
    const at = (k, m = 0) => ({ x: end.x + d.x * k + n.x * m, y: end.y + d.y * k + n.y * m });
    const seg = (p, q) => {
      path.moveTo(p.x, p.y);
      path.lineTo(q.x, q.y);
    };
    if (mark === 'one') {
      // Un et un seul : deux barres.
      seg(at(9, -8), at(9, 8));
      seg(at(15, -8), at(15, 8));
    } else if (mark === 'many') {
      // Patte de corbeau (un ou plusieurs) : trois doigts sur le bord, une barre.
      seg(at(16), at(0, -10));
      seg(at(16), at(0));
      seg(at(16), at(0, 10));
      seg(at(22, -8), at(22, 8));
    } else if (mark === 'triangle') {
      // Triangle creux : la pointe touche la classe mère.
      path.moveTo(end.x, end.y);
      const l = at(17, -10), r = at(17, 10);
      path.lineTo(l.x, l.y);
      path.lineTo(r.x, r.y);
      path.closePath();
    }
  }

  const MARKS = { '11': ['one', 'one'], '1n': ['one', 'many'], nn: ['many', 'many'], heritage: [null, 'triangle'] };

  function relationPath(rt, rel, grow = 1) {
    const p = new Path2D();
    const pts = rt.pts.map((q) => ({ ...q }));
    if (rel === 'heritage') {
      // La ligne s'arrête à la base du triangle.
      const last = pts[pts.length - 1];
      last.x += rt.db.x * 17;
      last.y += rt.db.y * 17;
    }
    // Tracé progressif à l'apparition.
    const lens = pts.slice(1).map((q, i) => Math.hypot(q.x - pts[i].x, q.y - pts[i].y));
    let left = lens.reduce((s, l) => s + l, 0) * grow;
    p.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length && left > 0; i++) {
      const k = Math.min(1, left / (lens[i - 1] || 1));
      p.lineTo(pts[i - 1].x + (pts[i].x - pts[i - 1].x) * k, pts[i - 1].y + (pts[i].y - pts[i - 1].y) * k);
      left -= lens[i - 1];
    }
    return p;
  }

  api.defineObject('relation', {
    layer: 0,
    center(r) {
      const rt = route(r);
      if (!rt) return null;
      const a = rt.pts[0], b = rt.pts[rt.pts.length - 1];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    },
    hit(r, p, rad) {
      const rt = route(r);
      if (!rt) return false;
      for (let i = 1; i < rt.pts.length; i++) if (segDist(p, rt.pts[i - 1], rt.pts[i]) < rad + 5) return true;
      return false;
    },
    draw(ctx, r, f) {
      const rt = route(r);
      if (!rt) return;
      const grow = Math.min(1, f.intro * 1.6);
      const w = lineWidth(r);
      api.draw.neon(ctx, relationPath(rt, r.rel, grow), r.color, w, f.life, 0, r.dash ? { width: w } : null);
      if (grow < 1) return;
      const [ma, mb] = MARKS[r.rel] ?? MARKS['1n'];
      const marks = new Path2D();
      if (ma) endMark(marks, rt.pts[0], rt.da, ma);
      if (mb) endMark(marks, rt.pts[rt.pts.length - 1], rt.db, mb);
      if (mb === 'triangle') {
        // Le triangle masque légèrement le fond pour rester net.
        const tri = new Path2D();
        endMark(tri, rt.pts[rt.pts.length - 1], rt.db, 'triangle');
                ctx.save();
        ctx.globalAlpha = f.life;
        ctx.fillStyle = light() ? '#fbfbf6' : 'rgba(8,10,20,0.85)';
        ctx.fill(tri);
        ctx.restore();
      }
      api.draw.neon(ctx, marks, r.color, Math.max(1.4, w * 0.85), f.life);
    },
  });

  // ───────── Roue et outil ─────────

  /** Petit dessin de chaque choix de la roue, centré sur (x, y). */
  function icon(ctx, item, x, y, s, color, alpha) {
    const p = new Path2D();
    if (item.kind === 'table' || item.kind === 'classe') {
      const w = s * 1.1, h = s * 0.95;
      p.rect(x - w, y - h, w * 2, h * 2);
      p.moveTo(x - w, y - h * 0.4);
      p.lineTo(x + w, y - h * 0.4);
      if (item.kind === 'classe') {
        p.moveTo(x - w, y + h * 0.35);
        p.lineTo(x + w, y + h * 0.35);
      } else {
        p.moveTo(x - w * 0.35, y - h * 0.4);
        p.lineTo(x - w * 0.35, y + h);
      }
      api.draw.neon(ctx, p, color, 2, alpha);
      return;
    }
    const a = { x: x - s * 1.2, y }, b = { x: x + s * 1.2, y };
    p.moveTo(a.x, a.y);
    p.lineTo(item.kind === 'heritage' ? b.x - 17 * 0.8 : b.x, b.y);
    const [ma, mb] = MARKS[item.kind];
    const marks = new Path2D();
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(0.8, 0.8);
    ctx.translate(-x, -y);
    const sa = { x: x - s * 1.5, y }, sb = { x: x + s * 1.5, y };
    if (ma) endMark(marks, sa, { x: 1, y: 0 }, ma);
    if (mb) endMark(marks, sb, { x: -1, y: 0 }, mb);
    api.draw.neon(ctx, marks, color, 1.8, alpha);
    ctx.restore();
    api.draw.neon(ctx, p, color, 2, alpha);
  }

  function umlWheel() {
    api.wheel({
      items: ITEMS.map((it) => ({ label: it.label, draw: (ctx, x, y, s, color, alpha) => icon(ctx, it, x, y, s, color, alpha) })),
      selected: current,
      onPick(i) {
        current = i;
        if (ITEMS[i].rel) relKind = ITEMS[i].kind;
        api.useTool('uml');
        api.refreshHud();
      },
    });
  }

  const relLabel = () => ITEMS.find((it) => it.kind === relKind).label.replace('Relation ', '');

  api.defineTool('uml', {
    wheel: umlWheel,
    label() {
      const it = ITEMS[current];
      return it.rel ? `UML : ${it.label}` : `UML : ${it.icon} ${it.label} · liens ${relLabel()}`;
    },
    busy: () => !!gesture && gesture.mode !== 'edit',
    down(p, e) {
      const over = entityAt(p);
      if (e?.shiftKey) gesture = over ? { mode: 'edit', o: over } : null;
      else if (e?.ctrlKey && over) gesture = { mode: 'move', o: over, dx: over.x - p.x, dy: over.y - p.y };
      else if (over) gesture = { mode: 'link', from: over, to: p };
      else gesture = { mode: 'place', at: p };
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
      const it = ITEMS[current];
      if (g.mode === 'edit') edit(g.o);
      else if (g.mode === 'place') {
        if (it.rel) api.toast('Glisser d’une table ou d’une classe à une autre pour les relier');
        else edit(addEntity(g.at, it.kind));
      } else if (g.mode === 'link') {
        const over = entityAt(p);
        if (over === g.from || Math.hypot(p.x - g.from.x, p.y - g.from.y) < DRAG) return api.render();
        if (over) relate(g.from, over, relKind);
        else if (!it.rel) {
          const o = addEntity(p, it.kind);
          relate(g.from, o, relKind);
          edit(o);
        } else api.toast('Relâcher sur une autre table ou classe');
      }
      api.render();
    },
    cancel() {
      gesture = null;
    },
    preview(ctx) {
      if (gesture?.mode !== 'link') return;
      const path = new Path2D();
      path.moveTo(gesture.from.x, gesture.from.y);
      path.lineTo(gesture.to.x, gesture.to.y);
      api.draw.neon(ctx, path, api.color, 2, 0.6, 0, { width: 2 });
    },
    cursor(ctx, p, now) {
      if (gesture) return;
      const over = entityAt(p);
      if (over) {
        const k = 6 + Math.sin(now / 160) * 2;
        api.draw.neon(ctx, boxPath(over.x - over.w / 2 - k, over.y - over.h / 2 - k, over.w + 2 * k, over.h + 2 * k), over.color, 1.2, 0.6, 0, { width: 1.5 });
        return;
      }
      const it = ITEMS[current];
      if (it.rel) return icon(ctx, it, p.x + 34, p.y + 22, 12, api.color, 0.5);
      const at = api.snap(p);
      icon(ctx, it, at.x, at.y, 26, api.color, 0.35);
    },
  });

  api.defineAction('uml', {
    label: 'Roue UML',
    hint: 'Table, classe ou relation · clic : poser et écrire · glisser de l’une à l’autre : relier · Ctrl+glisser : déplacer · Maj+clic : modifier',
    key: 'Shift+Q',
    run: () => umlWheel(),
  });
}
