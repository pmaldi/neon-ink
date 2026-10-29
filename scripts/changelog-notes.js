// Affiche la section du CHANGELOG pour une version : `node scripts/changelog-notes.js 0.2.0`.
// Utilisé par le workflow de release pour rédiger les notes de version.
import { readFileSync } from 'node:fs';

const version = process.argv[2]?.replace(/^v/, '');
if (!version) {
  console.error('Usage : node scripts/changelog-notes.js <version>');
  process.exit(1);
}
const text = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const start = text.search(new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm'));
if (start < 0) {
  console.error(`Version ${version} absente du CHANGELOG`);
  process.exit(1);
}
const body = text.slice(text.indexOf('\n', start) + 1);
const end = body.search(/^## \[|^\[[^\]]+\]: /m);
console.log((end < 0 ? body : body.slice(0, end)).trim());
