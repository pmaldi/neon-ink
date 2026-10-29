// Prépare une version : `npm run release -- <patch|minor|major|x.y.z>`.
// Met à jour package.json, package-lock.json, Cargo.toml, Cargo.lock et le CHANGELOG,
// puis crée le commit « chore(release): vX.Y.Z » et le tag annoté vX.Y.Z.
// Il reste à pousser : `git push --follow-tags`. Le workflow « Release » publie alors l'installateur.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = (f) => readFileSync(new URL(f, root), 'utf8');
const write = (f, s) => writeFileSync(new URL(f, root), s);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

const pkg = JSON.parse(read('package.json'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const arg = process.argv[2];
const next = { major: `${maj + 1}.0.0`, minor: `${maj}.${min + 1}.0`, patch: `${maj}.${min}.${pat + 1}` }[arg] ?? arg;
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('Usage : npm run release -- <patch|minor|major|x.y.z>');
  process.exit(1);
}
if (git('status', '--porcelain')) {
  console.error('L’arbre de travail doit être propre (tout commité) avant une release.');
  process.exit(1);
}

let changelog = read('CHANGELOG.md');
const unreleased = changelog.match(/## \[Unreleased\]\n([\s\S]*?)(?=\n## \[)/);
if (!unreleased || !unreleased[1].trim()) {
  console.error('La section [Unreleased] du CHANGELOG est vide : rien à publier.');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const prev = pkg.version;
changelog = changelog
  .replace('## [Unreleased]\n', `## [Unreleased]\n\n## [${next}] - ${today}\n`)
  .replace(
    /^\[Unreleased\]: .*$/m,
    `[Unreleased]: https://github.com/pmaldi/neon-ink/compare/v${next}...HEAD\n[${next}]: https://github.com/pmaldi/neon-ink/compare/v${prev}...v${next}`,
  );
write('CHANGELOG.md', changelog);

pkg.version = next;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(read('package-lock.json'));
lock.version = next;
if (lock.packages?.['']) lock.packages[''].version = next;
write('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
write('src-tauri/Cargo.toml', read('src-tauri/Cargo.toml').replace(/^version = ".*"$/m, `version = "${next}"`));
write('src-tauri/Cargo.lock', read('src-tauri/Cargo.lock').replace(/(name = "neon-ink"\nversion = )".*"/, `$1"${next}"`));

git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock');
git('commit', '-m', `chore(release): v${next}`);
git('tag', '-a', `v${next}`, '-m', `NeonInk v${next}`);
console.log(`Version ${next} prête. Pour publier : git push --follow-tags`);
