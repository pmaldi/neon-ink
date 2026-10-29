import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, checkUpdate } from '../src/update.js';

const release = (tag, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/pmaldi/neon-ink/releases/tag/${tag}`,
  assets: [
    { name: `NeonInk_${tag.slice(1)}_x64-setup.exe`, browser_download_url: 'https://x/setup.exe' },
    { name: `NeonInk_${tag.slice(1)}_x64_en-US.msi`, browser_download_url: 'https://x/a.msi' },
    { name: `NeonInk_${tag.slice(1)}_x64_portable.exe`, browser_download_url: 'https://x/portable.exe' },
  ],
  ...extra,
});
const fakeFetch = (body, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => body });

test('comparaison de versions', () => {
  assert.ok(compareVersions('0.10.0', '0.9.3') > 0);
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.ok(compareVersions('0.2.1', '0.3.0') < 0);
});

test('une version plus récente est proposée avec ses deux exécutables', async () => {
  const u = await checkUpdate('0.2.0', fakeFetch(release('v0.3.0')));
  assert.equal(u.version, '0.3.0');
  assert.equal(u.setup, 'https://x/setup.exe');
  assert.equal(u.portable, 'https://x/portable.exe');
});

test('rien à proposer si on est à jour ou si la release est une préversion', async () => {
  assert.equal(await checkUpdate('0.3.0', fakeFetch(release('v0.3.0'))), null);
  assert.equal(await checkUpdate('0.2.0', fakeFetch(release('v0.3.0', { prerelease: true }))), null);
});

test('une erreur GitHub est signalée', async () => {
  await assert.rejects(checkUpdate('0.2.0', fakeFetch({}, false)));
});
