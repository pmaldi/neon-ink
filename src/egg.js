// Petit secret : K, A, L tapés à la suite en mode dessin.
// Un titre ASCII qui se décode, un bonhomme qui danse, des feux d'artifice,
// la version, la date du jour, les liens… et un mot pour Jordan.

const BANNER = [
  ' _  _                ___       _    ',
  '| \\| |___ ___ _ _   |_ _|_ _  | |__ ',
  "| .` / -_) _ \\ ' \\   | || ' \\ | / / ",
  '|_|\\_\\___\\___/_||_| |___|_||_||_\\_\\ ',
];

const DANCER = [
  ['  \\o/  ', '   |   ', '  / \\  '],
  ['   o   ', '  /|\\  ', '  / \\  '],
  ['  _o_  ', '   |   ', '  / \\  '],
  ['   o/  ', '  /|   ', '  / >  '],
];

const GLYPHS = '#@%&*+=-:.<>/\\|~^';
const DURATION = 22000;

let open = false;
let timer = 0;
const pre = () => document.querySelector('#egg pre');

export const eggOpen = () => open;

export function closeEgg() {
  if (!open) return;
  open = false;
  clearInterval(timer);
  document.getElementById('egg').classList.remove('show');
}

const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function messageLines(version, links) {
  const date = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const lines = [
    { text: `NeonInk v${version}`, cls: 'c2' },
    { text: date.charAt(0).toUpperCase() + date.slice(1) },
    { text: '' },
    { text: '★ Coucou Jordan ! ★', cls: 'c1' },
    { text: 'Ce petit secret a été caché rien que pour toi.' },
    { text: 'Attrape le stylo et dessine-nous un dragon !' },
    { text: '' },
  ];
  for (const link of links) {
    const label = `→ ${link.nom} : ${link.url.replace(/^https?:\/\//, '')}`;
    lines.push({ text: label, url: link.url, cls: 'c3' });
  }
  lines.push({ text: '' }, { text: '(une touche ou un clic pour refermer)' });
  return lines;
}

function render(t, banner, box) {
  const out = [];

  // 1. Le titre se décode de gauche à droite, avec des caractères au hasard.
  banner.forEach((line, i) => {
    let s = '';
    for (let j = 0; j < line.length; j++) {
      const at = j * 22 + i * 70;
      if (t >= at) s += line[j];
      else if (t >= at - 260 && line[j] !== ' ') s += GLYPHS[(Math.random() * GLYPHS.length) | 0];
      else s += ' ';
    }
    out.push(`<span class="c1">${escape(s)}</span>`);
  });

  // 2. Le bonhomme danse à côté du sous-titre.
  const frame = DANCER[Math.floor(t / 230) % DANCER.length];
  const sub = ['', '   dessin néon à l’écran', ''];
  out.push('');
  frame.forEach((row, i) => out.push(`<span class="c2">${escape(row)}</span>${escape(sub[i])}`));
  out.push('');

  // 3. Le cadre se remplit lettre par lettre.
  const width = Math.max(...box.map((l) => [...l.text].length)) + 2;
  let budget = Math.max(0, (t - 1100) / 16);
  out.push(`┌${'─'.repeat(width + 2)}┐`);
  for (const line of box) {
    const chars = [...line.text];
    const shown = chars.slice(0, Math.max(0, Math.floor(budget)));
    budget -= chars.length;
    const pad = ' '.repeat(width - shown.length);
    let inner = escape(shown.join(''));
    if (line.url && shown.length === chars.length) inner = `<a data-url="${escape(line.url)}">${inner}</a>`;
    else if (line.cls) inner = `<span class="${line.cls}">${inner}</span>`;
    out.push(`│  ${inner}${pad}│`);
  }
  out.push(`└${'─'.repeat(width + 2)}┘`);
  return out.join('\n');
}

export function playEgg({ version, links, openLink, firework }) {
  const egg = document.getElementById('egg');
  const box = messageLines(version, links);
  const start = performance.now();
  open = true;
  egg.classList.add('show');

  egg.onclick = (e) => {
    const url = e.target.closest('a')?.dataset.url;
    if (url) openLink(url);
    else closeEgg();
  };

  let lastBurst = -1;
  const tick = () => {
    const t = performance.now() - start;
    pre().innerHTML = render(t, BANNER, box);
    // Un feu d'artifice toutes les 450 ms pendant les premières secondes.
    const burst = Math.floor(t / 450);
    if (burst !== lastBurst && t < 4200) {
      lastBurst = burst;
      firework(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.15 + Math.random() * 0.5));
    }
    if (t > DURATION) closeEgg();
  };
  clearInterval(timer);
  tick();
  timer = setInterval(tick, 40);
}
