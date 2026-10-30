// Plugin « Annotations » pour NeonInk : tampons de relecture en néon (validé, refusé, question,
// attention, important, j'aime), bulles de commentaire et notes façon post-it.
//
// Touche Z (par défaut) : roue des annotations. Maintenir Z, viser, relâcher ; ou appuyer sur Z
// puis cliquer. M (ou clic molette) la rouvre quand l'outil est actif.
//  - tampon : un clic le pose, à la taille de l'épaisseur courante (✔ en vert, ✖ en rouge,
//    les autres dans la couleur courante) ;
//  - bulle de commentaire : glisser depuis l'endroit montré jusqu'à la place de la bulle
//    (un simple clic la pose en haut à droite), puis taper le texte ;
//  - note : un clic pose un petit post-it, puis taper le texte ;
//  - Maj+clic sur une bulle ou une note : modifier son texte.
// La gomme efface les annotations comme le reste.

export const manifest = {
  id: 'annotations',
  nom: 'Annotations',
  description: 'Tampons de relecture (validé, refusé, question, attention, important, j’aime), bulles de commentaire et notes post-it.',
  version: '1.0.0',
  api: 1,
};

const KINDS = [
  { kind: 'valide', label: 'Validé', icon: '✔', color: 'g' },
  { kind: 'refuse', label: 'Refusé', icon: '✖', color: 'r' },
  { kind: 'question', label: 'Question', icon: '?' },
  { kind: 'attention', label: 'Attention', icon: '!' },
  { kind: 'important', label: 'Important', icon: '★' },
  { kind: 'jaime', label: 'J’aime', icon: '♥' },
  { kind: 'bulle', label: 'Bulle de commentaire', icon: '💬' },
  { kind: 'note', label: 'Note', icon: '▱' },
];
const TAU = Math.PI * 2;
const FONT = (size) => `600 ${size}px "Segoe UI", system-ui, sans-serif`;
const LINE = 1.3; // interligne

const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** Point plein : un tout petit cercle tracé épais. */
function dot(p, x, y) {
  p.moveTo(x + 0.1, y);
  p.arc(x, y, 0.1, 0, TAU);
}

/** Glyphes des tampons, centrés sur (0, 0), de demi-taille `s`. */
const GLYPHS = {
  valide(s) {
    const p = new Path2D();
    p.moveTo(-s * 0.62, s * 0.02);
    p.lineTo(-s * 0.18, s * 0.5);
    p.lineTo(s * 0.66, -s * 0.52);
    return p;
  },
  refuse(s) {
    const p = new Path2D();
    p.moveTo(-s * 0.5, -s * 0.5); p.lineTo(s * 0.5, s * 0.5);
    p.moveTo(s * 0.5, -s * 0.5); p.lineTo(-s * 0.5, s * 0.5);
    return p;
  },
  question(s) {
    const p = new Path2D();
    p.arc(0, 0, s * 0.95, 0, TAU);
    p.moveTo(-s * 0.3, -s * 0.2);
    p.arc(0, -s * 0.22, s * 0.3, Math.PI * 1.04, Math.PI * 2.35);
    p.quadraticCurveTo(0, -s * 0.02, 0, s * 0.2);
    dot(p, 0, s * 0.5);
    return p;
  },
  attention(s) {
    const p = new Path2D();
    p.moveTo(0, -s * 0.92);
    p.lineTo(s * 1.0, s * 0.78);
    p.lineTo(-s * 1.0, s * 0.78);
    p.closePath();
    p.moveTo(0, -s * 0.36); p.lineTo(0, s * 0.2);
    dot(p, 0, s * 0.48);
    return p;
  },
  important(s) {
    const p = new Path2D();
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? s * 0.42 : s;
      if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r + s * 0.08);
      else p.moveTo(Math.cos(a) * r, Math.sin(a) * r + s * 0.08);
    }
    p.closePath();
    return p;
  },
  jaime(s) {
    const p = new Path2D();
    p.moveTo(0, s * 0.8);
    p.bezierCurveTo(-s * 1.15, 0, -s * 0.62, -s * 0.95, 0, -s * 0.38);
    p.bezierCurveTo(s * 0.62, -s * 0.95, s * 1.15, 0, 0, s * 0.8);
    p.closePath();
    return p;
  },
};

/**
 * Bulle arrondie (x, y, w, h) dont la queue part du côté le plus proche de `tip` et pointe vers lui.
 * Sans queue si `tip` est dans la bulle.
 */
function bubblePath(x, y, w, h, r, tip) {
  const p = new Path2D();
  const cx = x + w / 2, cy = y + h / 2;
  let side = null;
  if (tip && !(tip.x > x && tip.x < x + w && tip.y > y && tip.y < y + h)) {
    const dx = (tip.x - cx) / (w / 2), dy = (tip.y - cy) / (h / 2);
    side = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
  }
  const horiz = side === 'top' || side === 'bottom';
  const len = horiz ? w : h;
  const bw = Math.max(2, Math.min(14, len / 2 - r - 1));
  const c = side && (horiz ? clamp(tip.x, x + r + bw, x + w - r - bw) : clamp(tip.y, y + r + bw, y + h - r - bw));
  p.moveTo(x + r, y);
  if (side === 'top') { p.lineTo(c - bw, y); p.lineTo(tip.x, tip.y); p.lineTo(c + bw, y); }
  p.lineTo(x + w - r, y);
  p.arcTo(x + w, y, x + w, y + r, r);
  if (side === 'right') { p.lineTo(x + w, c - bw); p.lineTo(tip.x, tip.y); p.lineTo(x + w, c + bw); }
  p.lineTo(x + w, y + h - r);
  p.arcTo(x + w, y + h, x + w - r, y + h, r);
  if (side === 'bottom') { p.lineTo(c + bw, y + h); p.lineTo(tip.x, tip.y); p.lineTo(c - bw, y + h); }
  p.lineTo(x + r, y + h);
  p.arcTo(x, y + h, x, y + h - r, r);
  if (side === 'left') { p.lineTo(x, c + bw); p.lineTo(tip.x, tip.y); p.lineTo(x, c - bw); }
  p.lineTo(x, y + r);
  p.arcTo(x, y, x + r, y, r);
  p.closePath();
  return p;
}

/** Post-it centré sur (0, 0), de taille w × h, coin inférieur droit replié. */
function notePath(w, h) {
  const f = Math.min(w, h) * 0.18;
  const p = new Path2D();
  p.moveTo(-w / 2, -h / 2);
  p.lineTo(w / 2, -h / 2);
  p.lineTo(w / 2, h / 2 - f);
  p.lineTo(w / 2 - f, h / 2);
  p.lineTo(-w / 2, h / 2);
  p.closePath();
  const fold = new Path2D();
  fold.moveTo(w / 2, h / 2 - f);
  fold.lineTo(w / 2 - f, h / 2 - f);
  fold.lineTo(w / 2 - f, h / 2);
  return { p, fold };
}

let measureCtx = null;

/** Découpe `text` en lignes d'au plus `max` pixels ; rend les lignes et la plus grande largeur. */
function wrap(text, size, max) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = FONT(size);
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measureCtx.measureText(next).width > max) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return { lines, width: Math.max(0, ...lines.map((l) => measureCtx.measureText(l).width)) };
}

export function activate(api) {
  if (!api.prompt) throw new Error('nécessite NeonInk 0.11 ou plus récent');

  let current = 0; // annotation choisie
  let dragging = null; // bulle en cours de placement : { a, b }
  let typing = null; // bulle ou note en attente de son texte (aperçu)

  const kind = () => KINDS[current].kind;
  const stampSize = () => 12 + api.width * 3.2;
  const textSize = () => Math.round(13 + api.width * 1.1);
  const darkFill = 'rgba(8, 10, 20, 0.8)';

  // ── Tampons ──

  function drawGlyph(ctx, k, x, y, s, color, alpha, boost = 0) {
    ctx.save();
    ctx.translate(x, y);
    api.draw.neon(ctx, GLYPHS[k](s), color, Math.max(4, s * 0.2), alpha, boost);
    ctx.restore();
  }

  api.defineObject('tampon', {
    layer: 2,
    center: (o) => o,
    hit: (o, p, r) => dist(o, p) < o.size + r,
    draw(ctx, o, f) {
      const pop = f.intro < 1 ? Math.max(0.01, easeOutBack(Math.min(1, f.intro * 1.6))) : 1;
      // Onde lumineuse qui s'éloigne à l'apparition.
      if (f.intro < 1) {
        const ring = new Path2D();
        ring.arc(o.x, o.y, o.size * (0.9 + f.intro * 0.9), 0, TAU);
        api.draw.neon(ctx, ring, o.color, 2, (1 - f.intro) * 0.7 * f.life);
      }
      drawGlyph(ctx, o.stamp, o.x, o.y, o.size * pop, o.color, f.life, f.intro < 1 ? (1 - f.intro) : 0);
    },
  });

  // ── Bulles ──

  /** Mesure de la bulle : boîte centrée sur `b`, texte découpé. */
  function bubbleLayout(o) {
    const { lines, width } = wrap(o.text, o.fs, 260);
    const pad = o.fs * 0.7;
    const w = Math.max(60, width + pad * 2), h = lines.length * o.fs * LINE + pad * 1.4;
    return { lines, x: o.bx - w / 2, y: o.by - h / 2, w, h };
  }

  function drawLines(ctx, lines, cx, cy, fs, color, alpha) {
    const lh = fs * LINE;
    lines.forEach((l, i) => api.draw.label(ctx, l, cx, cy + (i - (lines.length - 1) / 2) * lh, color, { size: fs, alpha }));
  }

  function drawBubble(ctx, o, alpha, grow = 1, boost = 0) {
    const L = bubbleLayout(o);
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    ctx.save();
    // La bulle grandit depuis son centre ; la queue continue de viser le point montré.
    const tip = { x: cx + (o.ax - cx) / grow, y: cy + (o.ay - cy) / grow };
    ctx.translate(cx, cy);
    ctx.scale(grow, grow);
    ctx.translate(-cx, -cy);
    const path = bubblePath(L.x, L.y, L.w, L.h, Math.min(16, L.h / 2), tip);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = darkFill;
    ctx.fill(path);
    ctx.restore();
    api.draw.neon(ctx, path, o.color, 2.5, alpha, boost);
    drawLines(ctx, L.lines, cx, cy, o.fs, o.color, alpha);
    ctx.restore();
    // Point montré.
    api.draw.glowDot(ctx, o.ax, o.ay, 5, o.color, alpha);
  }

  api.defineObject('bulle', {
    layer: 2,
    center: (o) => ({ x: o.bx, y: o.by }),
    hit(o, p, r) {
      const L = bubbleLayout(o);
      if (p.x > L.x - r && p.x < L.x + L.w + r && p.y > L.y - r && p.y < L.y + L.h + r) return true;
      // Queue : segment du centre de la bulle au point montré.
      const dx = o.ax - o.bx, dy = o.ay - o.by;
      const k = clamp(((p.x - o.bx) * dx + (p.y - o.by) * dy) / (dx * dx + dy * dy || 1), 0, 1);
      return Math.hypot(p.x - (o.bx + dx * k), p.y - (o.by + dy * k)) < r + 4;
    },
    draw(ctx, o, f) {
      const grow = f.intro < 1 ? Math.max(0.05, easeOutBack(Math.min(1, f.intro * 1.5))) : 1;
      drawBubble(ctx, o, f.life, grow, f.intro < 1 ? (1 - f.intro) * 0.8 : 0);
    },
  });

  // ── Notes ──

  function noteLayout(o) {
    const side = 110 + o.fs * 2.4;
    const { lines } = wrap(o.text, o.fs, side - o.fs * 1.6);
    const h = Math.max(side * 0.9, lines.length * o.fs * LINE + o.fs * 2);
    return { lines, w: side, h };
  }

  function drawNote(ctx, o, alpha, scale = 1, boost = 0) {
    const L = noteLayout(o);
    const { p, fold } = notePath(L.w, L.h);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.rot);
    ctx.scale(scale, scale);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = darkFill;
    ctx.fill(p);
    ctx.globalAlpha = alpha * 0.16;
    ctx.fillStyle = o.color.hex;
    ctx.fill(p);
    ctx.restore();
    api.draw.neon(ctx, p, o.color, 2.5, alpha, boost);
    api.draw.neon(ctx, fold, o.color, 1.8, alpha * 0.8);
    // Bande de « colle » en haut.
    const tape = new Path2D();
    tape.moveTo(-L.w * 0.32, -L.h / 2 + 7);
    tape.lineTo(L.w * 0.32, -L.h / 2 + 7);
    api.draw.neon(ctx, tape, o.color, 1.5, alpha * 0.45);
    drawLines(ctx, L.lines, 0, 4, o.fs, o.color, alpha);
    ctx.restore();
  }

  api.defineObject('note', {
    layer: 2,
    center: (o) => o,
    hit(o, p, r) {
      const L = noteLayout(o);
      // Point ramené dans le repère de la note (penchée).
      const c = Math.cos(-o.rot), s = Math.sin(-o.rot);
      const x = (p.x - o.x) * c - (p.y - o.y) * s, y = (p.x - o.x) * s + (p.y - o.y) * c;
      return Math.abs(x) < L.w / 2 + r && Math.abs(y) < L.h / 2 + r;
    },
    draw(ctx, o, f) {
      // La note tombe en tournant un peu, puis se pose.
      const k = Math.min(1, f.intro * 1.5);
      const scale = f.intro < 1 ? 1.25 - 0.25 * easeOutBack(k) : 1;
      drawNote(ctx, { ...o, rot: o.rot * (f.intro < 1 ? 2 - easeOutBack(k) : 1) }, f.life * Math.min(1, k * 2), scale, f.intro < 1 ? (1 - f.intro) * 0.6 : 0);
    },
  });

  // ── Saisie du texte ──

  async function ask(at, value, placeholder) {
    const text = await api.prompt({ x: at.x, y: at.y, value, placeholder });
    return text ? text : null;
  }

  async function newBubble(a, b) {
    const fs = textSize();
    typing = { type: 'bulle', ax: a.x, ay: a.y, bx: b.x, by: b.y, fs, text: '…', color: api.color };
    api.render();
    const L = bubbleLayout(typing);
    const text = await ask({ x: b.x, y: L.y + L.h }, '', 'Commentaire');
    typing = null;
    if (text) api.add('bulle', { ax: a.x, ay: a.y, bx: b.x, by: b.y, x: b.x, y: b.y, fs, text });
    api.render();
  }

  async function newNote(p) {
    const fs = textSize();
    const rot = -(0.04 + Math.random() * 0.05);
    typing = { type: 'note', x: p.x, y: p.y, fs, rot, text: '…', color: api.color };
    api.render();
    const L = noteLayout(typing);
    const text = await ask({ x: p.x, y: p.y + L.h / 2 }, '', 'Note');
    typing = null;
    if (text) api.add('note', { x: p.x, y: p.y, fs, rot, text });
    api.render();
  }

  async function edit(o) {
    const below = o.type.endsWith('.bulle') ? { x: o.bx, y: bubbleLayout(o).y + bubbleLayout(o).h } : { x: o.x, y: o.y + noteLayout(o).h / 2 };
    typing = { edit: true };
    const text = await ask(below, o.text, 'Texte');
    typing = null;
    if (text && api.objects().includes(o)) {
      o.text = text;
      api.changed();
    } else api.render();
  }

  // ── Roue et outil ──

  function drawIcon(ctx, k, x, y, s, color, alpha) {
    if (GLYPHS[k]) return drawGlyph(ctx, k, x, y, s * 0.85, color, alpha);
    ctx.save();
    ctx.translate(x, y);
    if (k === 'bulle') {
      api.draw.neon(ctx, bubblePath(-s, -s * 0.8, s * 2, s * 1.2, s * 0.35, { x: -s * 0.6, y: s * 0.95 }), color, 2.5, alpha);
      const l = new Path2D();
      l.moveTo(-s * 0.55, -s * 0.38); l.lineTo(s * 0.55, -s * 0.38);
      l.moveTo(-s * 0.55, 0); l.lineTo(s * 0.2, 0);
      api.draw.neon(ctx, l, color, 2, alpha * 0.8);
    } else {
      ctx.rotate(-0.08);
      const { p, fold } = notePath(s * 1.7, s * 1.7);
      api.draw.neon(ctx, p, color, 2.5, alpha);
      api.draw.neon(ctx, fold, color, 2, alpha * 0.8);
      const l = new Path2D();
      for (const yy of [-0.35, 0, 0.35]) { l.moveTo(-s * 0.55, yy * s); l.lineTo(s * (yy > 0 ? 0.1 : 0.55), yy * s); }
      api.draw.neon(ctx, l, color, 1.6, alpha * 0.7);
    }
    ctx.restore();
  }

  const stampColor = (k) => {
    const c = KINDS.find((d) => d.kind === k).color;
    return c ? api.palette[c] : api.color;
  };

  function annotationWheel() {
    api.wheel({
      items: KINDS.map((d) => ({
        label: d.label,
        draw: (ctx, x, y, s, color, alpha) => drawIcon(ctx, d.kind, x, y, s, d.color ? api.palette[d.color] : color, alpha),
      })),
      selected: current,
      onPick(i) {
        current = i;
        api.useTool('annotations');
        api.refreshHud();
      },
    });
  }

  const textAt = (p) => api.objectAt(p, 4, 'bulle') ?? api.objectAt(p, 4, 'note');

  api.defineTool('annotations', {
    wheel: annotationWheel,
    label: () => `Annotations : ${KINDS[current].icon} ${KINDS[current].label}`,
    busy: () => !!dragging || !!typing,
    down(p, e) {
      if (typing) return;
      if (e?.shiftKey) {
        e.preventDefault?.(); // Maj+clic : la saisie s'ouvre au relâchement
        return;
      }
      const k = kind();
      if (GLYPHS[k]) api.add('tampon', { x: p.x, y: p.y, stamp: k, size: stampSize(), color: stampColor(k) });
      else if (k === 'bulle') dragging = { a: p, b: p };
    },
    move(p) {
      if (!dragging) return;
      dragging.b = p;
      api.render();
    },
    up(p, e) {
      if (typing) return;
      if (e?.shiftKey && !dragging) {
        const o = textAt(p);
        if (o) edit(o);
        return;
      }
      const k = kind();
      if (k === 'bulle' && dragging) {
        const { a } = dragging;
        dragging = null;
        // Simple clic : la bulle se place en haut à droite du point montré.
        const b = dist(a, p) < 30 ? { x: a.x + 120, y: a.y - 80 } : p;
        newBubble(a, b);
      } else if (k === 'note') newNote(p);
    },
    cancel() {
      dragging = null;
    },
    preview(ctx) {
      if (typing?.type === 'bulle') drawBubble(ctx, typing, 0.55);
      else if (typing?.type === 'note') drawNote(ctx, typing, 0.55);
      else if (dragging) {
        const line = new Path2D();
        line.moveTo(dragging.a.x, dragging.a.y);
        line.lineTo(dragging.b.x, dragging.b.y);
        api.draw.neon(ctx, line, api.color, 2, 0.6, 0, { width: 2 });
        api.draw.glowDot(ctx, dragging.a.x, dragging.a.y, 5, api.color, 0.8);
        drawIcon(ctx, 'bulle', dragging.b.x, dragging.b.y, 22, api.color, 0.5);
      }
    },
    cursor(ctx, p) {
      if (dragging || typing) return;
      const k = kind();
      if (GLYPHS[k]) drawGlyph(ctx, k, p.x, p.y, stampSize(), stampColor(k), 0.35);
      else drawIcon(ctx, k, p.x + 26, p.y - 26, 16, api.color, 0.45);
    },
  });

  api.defineAction('roue', {
    label: 'Roue des annotations',
    hint: 'Tampons, bulle (glisser du point montré vers la bulle) et note · Maj+clic : modifier le texte',
    key: 'Z',
    run: () => annotationWheel(),
  });
}
