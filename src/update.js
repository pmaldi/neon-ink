// Recherche d'une nouvelle version dans les Releases GitHub.

const REPO = 'pmaldi/neon-ink';

/** Compare deux versions « x.y.z » : > 0 si `a` est plus récente. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

/** Choisit l'installateur et l'exécutable portable parmi les fichiers d'une release. */
export function pickAssets(release) {
  const version = release.tag_name.replace(/^v/, '');
  const find = (re) => release.assets.find((a) => re.test(a.name))?.browser_download_url ?? null;
  return {
    version,
    page: release.html_url,
    setup: find(/-setup\.exe$/i),
    portable: find(/_portable\.exe$/i),
  };
}

/** Renvoie la mise à jour disponible, ou null si `current` est la dernière version. */
export async function checkUpdate(current, fetchImpl = fetch) {
  const res = await fetchImpl(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const release = await res.json();
  if (release.draft || release.prerelease) return null;
  const update = pickAssets(release);
  return compareVersions(update.version, current) > 0 ? update : null;
}
