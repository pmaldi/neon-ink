// Fonds opaques : tableau noir, tableau blanc, papier petits carreaux et grands carreaux (Seyès).
// Peints sur un canvas : la même fonction sert à l'écran et à la capture d'écran.

export const BOARDS = {
  black: { label: 'Tableau noir', paper: '#050608', light: false },
  white: { label: 'Tableau blanc', paper: '#f7f7f4', light: true },
  small: { label: 'Petits carreaux', paper: '#fbfbf6', light: true, grid: 19 }, // 5 mm
  seyes: { label: 'Grands carreaux', paper: '#fbfbf6', light: true, grid: 30 }, // 8 mm, réglure Seyès
};

const FINE = '#d3dcef', MAIN = '#93abd9', MARGIN = '#e58a9a';

/** Peint le fond `board` sur `ctx` (taille en pixels réels, `scale` = pixels par px CSS). */
export function paintBoard(ctx, board, width, height, scale = 1) {
  const b = BOARDS[board];
  if (!b) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = b.paper;
  ctx.fillRect(0, 0, width, height);
  const line = (x0, y0, x1, y1, color, w = 1) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  // Lignes calées sur le pixel réel pour rester nettes, quelle que soit la mise à l'échelle.
  const at = (v) => Math.round(v * scale) + 0.5;
  if (board === 'small') {
    for (let x = b.grid; x * scale < width; x += b.grid) line(at(x), 0, at(x), height, FINE);
    for (let y = b.grid; y * scale < height; y += b.grid) line(0, at(y), width, at(y), FINE);
  } else if (board === 'seyes') {
    const fine = b.grid / 4;
    for (let i = 1; i * fine * scale < height; i++) line(0, at(i * fine), width, at(i * fine), i % 4 ? FINE : MAIN);
    for (let x = b.grid; x * scale < width; x += b.grid) line(at(x), 0, at(x), height, MAIN);
    line(at(b.grid * 4), 0, at(b.grid * 4), height, MARGIN, Math.max(1, Math.round(scale * 1.5)));
  }
  ctx.restore();
}

/** Point aimanté sur le quadrillage du fond, s'il y en a un. */
export function snapToGrid(board, p) {
  const g = BOARDS[board]?.grid;
  if (!g) return p;
  return { ...p, x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
}
