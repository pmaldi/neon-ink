// Génère scripts/icon.png (1024×1024) : anneau néon cyan→rose sur fond sombre.
// Ensuite : `npx tauri icon scripts/icon.png` produit toutes les tailles (.ico, .icns, .png).
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const S = 1024;
const px = Buffer.alloc(S * S * 4);
const c1 = [20, 241, 255], c2 = [255, 59, 212];

function roundedMask(x, y, r = 220, m = 40) {
  const cx = Math.min(Math.max(x, m + r), S - m - r), cy = Math.min(Math.max(y, m + r), S - m - r);
  const d = Math.hypot(x - cx, y - cy) - r;
  return Math.min(1, Math.max(0, 0.5 - d));
}

for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const a = roundedMask(x + 0.5, y + 0.5);
    const dx = x - S / 2, dy = y - S / 2;
    const ang = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
    const t = 0.5 - 0.5 * Math.cos(ang * 2 * Math.PI);
    const col = c1.map((v, i) => v + (c2[i] - v) * t);
    const d = Math.abs(Math.hypot(dx, dy) - 290);
    const core = Math.max(0, 1 - Math.max(0, d - 22) / 6);
    const glow = Math.exp(-((Math.max(0, d - 22) / 70) ** 2)) * 0.9;
    const bg = [11, 13, 23];
    const rgb = bg.map((v, i) => {
      const lit = v + col[i] * glow;
      return Math.min(255, lit * (1 - core) + (col[i] * 0.35 + 255 * 0.65) * core);
    });
    const o = (y * S + x) * 4;
    px[o] = rgb[0]; px[o + 1] = rgb[1]; px[o + 2] = rgb[2]; px[o + 3] = Math.round(a * 255);
  }
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) px.copy(raw, y * (S * 4 + 1) + 1, y * S * 4, (y + 1) * S * 4);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(new URL('./icon.png', import.meta.url), Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]));
console.log('scripts/icon.png généré');
