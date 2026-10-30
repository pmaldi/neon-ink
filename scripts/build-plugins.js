// Prépare les plugins pour une release : un fichier `plugin-<id>.js` par dossier de plugins/
// et le catalogue `plugins.json` que NeonInk consulte (menu Aide › Plugins).
//   node scripts/build-plugins.js <version> <dossier de sortie>

import { copyFile, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [version, out = 'dist-plugins'] = process.argv.slice(2);
if (!version) {
  console.error('Usage : node scripts/build-plugins.js <version> [dossier]');
  process.exit(1);
}

await mkdir(out, { recursive: true });
const catalog = [];
for (const dir of await readdir('plugins', { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const src = join('plugins', dir.name, 'plugin.js');
  const { manifest, activate } = await import(pathToFileURL(src).href);
  if (manifest?.id !== dir.name || typeof activate !== 'function') throw new Error(`${src} : manifest.id doit valoir « ${dir.name} » et activate() exister`);
  const fichier = `plugin-${manifest.id}.js`;
  await copyFile(src, join(out, fichier));
  catalog.push({
    ...manifest,
    fichier,
    taille: (await stat(src)).size,
    url: `https://github.com/pmaldi/neon-ink/releases/download/v${version}/${fichier}`,
  });
}
await writeFile(join(out, 'plugins.json'), JSON.stringify(catalog, null, 2));
console.log(catalog.map((p) => `${p.fichier} (${p.nom} ${p.version}, ${p.taille} octets)`).join('\n'));
