# Plugins NeonInk

Les plugins ajoutent des fonctionnalités sans alourdir NeonInk : ils ne font pas partie des
installateurs. Chacun est publié avec les releases (`plugin-<id>.js`, plus le catalogue
`plugins.json`) et s'installe depuis l'application : aide (**H**) › onglet **Plugins** ›
**Installer**. Ils sont rangés dans `%APPDATA%\com.patrice.neonink\plugins`, se chargent au
démarrage et se mettent à jour d'eux-mêmes.

| Plugin | Contenu |
|---|---|
| [`reseau`](reseau/plugin.js) | Plans réseau : routeur, switch, serveur, PC, pare-feu, Internet, borne Wi-Fi, reliés par des liens où circulent des paquets |

## Écrire un plugin

Un dossier `plugins/<id>/` avec un seul fichier `plugin.js`, un module JavaScript sans
dépendance qui exporte `manifest` et `activate(api)` :

```js
export const manifest = {
  id: 'exemple',        // = nom du dossier : minuscules, chiffres, tirets
  nom: 'Exemple',
  description: 'Ce que fait le plugin, en une phrase.',
  version: '1.0.0',     // à augmenter pour que les installations se mettent à jour
  api: 1,               // version de l'API ci-dessous
};

export function activate(api) {
  api.defineObject('bulle', {
    draw(ctx, o, f) { /* dessine o à l'instant f.now */ },
    hit: (o, p, r) => Math.hypot(p.x - o.x, p.y - o.y) < 20 + r,
  });
  api.defineTool('bulle', {
    label: () => '○ Bulle',
    down: (p) => api.add('bulle', { x: p.x, y: p.y }),
  });
  api.defineAction('bulle', { label: 'Poser des bulles', key: 'U', run: () => api.useTool('bulle') });
}
```

Pour l'essayer sans le publier : `npx serve .` (ou tout serveur statique) à la racine du dépôt,
puis `http://localhost:3000/src/index.html?plugins=exemple`, F10 pour dessiner.

### L'objet `api`

| Membre | Rôle |
|---|---|
| `defineObject(type, def)` | Type d'objet dessiné. `def.draw(ctx, o, f)` dessine `o` ; `f` = `{ now, age, intro, life }` : `intro` va de 0 à 1 à l'apparition, `life` de 1 à 0 quand l'objet s'efface. `def.hit(o, p, r)` : vrai si la gomme (disque `p`, rayon `r`) le touche. Facultatif : `center(o)` (étincelles à l'effacement), `animated` (booléen ou fonction : redessiné à chaque image), `layer` (ordre d'affichage) |
| `defineTool(nom, def)` | Outil. `label()` pour la barre d'état ; `down(p, e)`, `move(p, e)`, `up(p, e)`, `cancel()` pour la souris ; `preview(ctx, now)` et `cursor(ctx, p, now)` pour l'aperçu ; `busy()` vrai pendant une action en cours |
| `defineAction(nom, def)` | Raccourci `{ label, hint, key, run }` (`hint` : précision affichée sous le libellé). Il apparaît dans l'aide, onglet Plugins, se modifie comme les autres et s'enregistre dans `config.json` sous le nom `<id>.<nom>`. `key` n'est utilisée que si elle est libre |
| `useTool(nom)`, `toolActive(nom)` | Choisir un outil du plugin, savoir s'il est actif |
| `add(type, données)` | Ajoute un objet ; la couleur et l'épaisseur courantes sont reprises. `deps: [id, …]` : l'objet s'efface avec ceux dont il dépend |
| `remove(o)`, `objects(type)`, `objectAt(p, r, type)` | Effacer, lister, trouver sous un point |
| `color`, `width`, `dashed`, `board`, `palette` | État courant et couleurs de NeonInk |
| `draw` | Primitives néon : `neon(ctx, path, couleur, épaisseur, alpha, éclat, tirets)`, `glowDot`, `glowLine`, `badge`, `label(ctx, texte, x, y, couleur, { size, alpha })`, `path(points, fermé, lissé)` |
| `snap(p)` | Point aimanté sur le quadrillage du papier à carreaux |
| `toast(message)`, `render()`, `refreshHud()` | Message, nouvelle image, barre d'état |

NeonInk s'occupe du reste : annulation, gomme, effacement animé, capture d'écran, masquage
avec F10, aide et configuration des touches.

### Publication

`scripts/build-plugins.js` prépare chaque dossier pour la release (workflow `release.yml`).
Les tests (`npm test`) vérifient que chaque plugin se charge et déclare ses objets et raccourcis.
