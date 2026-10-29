# NeonInk

Dessin néon par-dessus l'écran, pour présenter, expliquer ou annoter n'importe quelle application.
Appuyez sur **F10**, dessinez, puis **F10** à nouveau : les tracés sont masqués et l'écran redevient utilisable normalement. Un nouveau **F10** les réaffiche tels quels. **Échap** efface tout et quitte le dessin.

[Télécharger la dernière version](https://github.com/pmaldi/neon-ink/releases/latest) : l'installateur (`…-setup.exe` ou `.msi`, installe NeonInk dans Program Files pour tous les utilisateurs, avec les droits administrateur) ou la version portable (`…_portable.exe`, à lancer directement, sans installation).

- Trait néon : il naît « chauffé à blanc » puis refroidit vers sa couleur, et une comète lumineuse le parcourt quand on lève le stylo
- Reconnaissance de formes : trait droit, courbe, cercle, ellipse, carré, rectangle, triangle. Le tracé se transforme en forme propre avec une animation
- Gomme entière (le trait se consume en étincelles) ou gomme précise (n'enlève qu'une partie du trait)
- Étapes numérotées : chaque clic pose une pastille ①, ②, ③… reliée à la précédente par une flèche courbe. Glisser dessine un trait ou une forme sans quitter le mode. Effacer une étape renumérote les suivantes
- Plusieurs écrans : le calque s'ouvre sur l'écran où se trouve la souris
- Léger : aucune image n'est calculée quand rien ne bouge, et la fenêtre est masquée hors du mode dessin
- Tableau noir ou blanc : un fond opaque pour dessiner sur une page vierge
- Mises à jour automatiques : la nouvelle version s'installe d'elle-même quand NeonInk ne sert pas

## Raccourcis

| Touche | Action |
|---|---|
| **F10** | Mode dessin on/off : masque les tracés, puis les réaffiche (raccourci global) |
| **Échap** | Tout effacer et quitter le dessin |
| **R G B Y O P V C W K** | Rouge, vert, bleu, jaune, orange, rose, violet, cyan, blanc, noir |
| **D** | Stylo |
| **E** / clic droit maintenu | Gomme : efface le trait entier |
| **T** | Gomme précise : efface seulement la partie touchée |
| **S** | Étapes numérotées (1 → 2 → 3) : clic = pastille, glisser = trait ou forme |
| **N** | Nouvelle séquence d'étapes (repart à 1) |
| **F** | Formes auto activées / désactivées |
| **Maj** en relâchant | Garder ce tracé à main levée |
| **Ctrl+Z** / **Retour arrière** | Annuler le dernier élément |
| **Suppr** / **X** | Tout effacer (animé) |
| **Molette** / **+ −** | Épaisseur du trait |
| **Maj+K** / **Maj+W** | Tableau noir / tableau blanc (même touche : retour à l'écran) |
| **H** | Aide à l'écran |

Les lettres suivent la disposition du clavier (AZERTY compris). Le bouton gomme d'un stylet de tablette fonctionne aussi.
L'icône dans la zone de notification permet d'activer le dessin, de tout effacer, de mettre à jour, de choisir les mises à jour automatiques et le lancement avec Windows, ou de quitter.
Relancer NeonInk alors qu'il tourne déjà (menu Démarrer) active simplement le dessin.

## Technologie

[Tauri 2](https://tauri.app) : un petit cœur natif en Rust (fenêtre transparente toujours au premier plan, raccourci global, icône de notification) et une interface Canvas 2D en JavaScript pur, sans framework ni bundler.
L'exécutable pèse quelques Mo et utilise WebView2, déjà présent sur Windows 10 et 11.
Le même code peut ensuite être compilé pour macOS et Linux.

```
src/              interface (HTML/CSS/JS)
  main.js         état, saisie, boucle de rendu, animations
  render.js       primitives néon (halo, cœur, pastilles, flèches)
  shapes.js       reconnaissance de formes
  geom.js         géométrie pure
src-tauri/        cœur natif Rust + configuration
tests/            tests de la reconnaissance de formes (Node)
```

## Compiler sous Windows

Prérequis, à installer une seule fois :

1. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), en cochant « Développement Desktop en C++ »
2. [Rust](https://rustup.rs)
3. [Node.js](https://nodejs.org) 20 ou plus récent

Puis, dans le dossier du projet :

```bash
npm install
```

Pour lancer en mode développement :

```bash
npm run dev
```

Pour produire l'installateur :

```bash
npm run build
```

Les installateurs sont créés dans `src-tauri/target/release/bundle/` (`nsis/NeonInk_…_x64-setup.exe` et `msi/`).
L'exécutable seul se trouve dans `src-tauri/target/release/NeonInk.exe`.

Sans rien installer : le workflow GitHub Actions (`.github/workflows/build.yml`) compile l'application sur une machine Windows à chaque push et met l'installateur à disposition dans l'onglet « Actions ».
Il teste aussi, sur la session Windows du runner :

- l'affichage du calque en mode dessin au-dessus d'une page Edge animée (`scripts/ci/occlusion_test.py`) ;
- l'installation, la migration depuis une ancienne version installée dans AppData, la mise à jour passive avec relance et la désinstallation (`scripts/ci/install_test.ps1`).

## Tester l'interface dans un navigateur

L'interface fonctionne aussi dans un navigateur, sur fond sombre, pour la mettre au point sans recompiler :

```bash
python -m http.server 8765 --directory src
```

Ouvrez ensuite http://localhost:8765 et appuyez sur F10.

## Versions

Le projet suit le [versionnage sémantique](https://semver.org/lang/fr/) et les messages de commit suivent les [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`…).
Chaque évolution est notée dans la section `[Unreleased]` du [CHANGELOG](CHANGELOG.md).

Pour publier une version :

```bash
npm run release -- minor
```

```bash
git push --follow-tags
```

Le script met à jour les numéros de version et le CHANGELOG, puis crée le commit et le tag. Il accepte `patch`, `minor`, `major` ou un numéro précis.
Le push du tag lance le workflow « Release », qui compile l'application et publie les installateurs et l'exécutable portable dans les [Releases GitHub](https://github.com/pmaldi/neon-ink/releases) avec les notes du CHANGELOG.

## Mises à jour

NeonInk consulte la dernière release GitHub 15 secondes après son démarrage, puis toutes les 2 heures.

Avec « Installer les mises à jour automatiquement » (coché par défaut dans le menu de l'icône), la nouvelle version s'installe dès que NeonInk est inactif : pas de dessin en cours ni de tracé gardé en mémoire. Sinon, l'entrée « Installer la version X » apparaît dans le menu.

- Version installée : l'installateur se lance en mode passif (barre de progression, aucune question) puis relance NeonInk. Windows demande l'autorisation administrateur, l'application étant dans Program Files.
- Version portable : l'exécutable se remplace lui-même puis redémarre (il doit se trouver dans un dossier modifiable).

Au passage en mode dessin suivant, un message confirme la nouvelle version. Si une installation demandée depuis le menu échoue, la page de la release s'ouvre dans le navigateur. Le code se trouve dans `src/update.js` et `src-tauri/src/updater.rs`.

## Tests

```bash
npm test
```

## Écran figé pendant le dessin

Sur certains écrans à fréquence variable (G-Sync, FreeSync, 120 Hz et plus, HDR), Windows cale le rafraîchissement sur l'application active. En mode dessin, c'est NeonInk : un point invisible y bouge en continu pour que l'écran reste animé.
Si l'image se fige malgré tout, désactivez « Optimisations pour les jeux en fenêtre » (Paramètres > Système > Écran > Graphiques) ou le G-Sync « fenêtré et plein écran » du panneau NVIDIA, puis signalez-le.

## Portage macOS / Linux

- **macOS** : activer `macOSPrivateApi` dans `tauri.conf.json` pour la transparence, et ajouter la cible `dmg`.
- **Linux** : fonctionne sous X11. Sous Wayland, les raccourcis globaux et le passage des clics à travers la fenêtre dépendent du compositeur.

## Personnaliser

- Couleurs : `PALETTE` dans `src/render.js`
- Durées d'animation : `T` dans `src/main.js`
- Sensibilité de la reconnaissance : `ACCEPT` et les seuils dans `src/shapes.js`
- Courbure des flèches entre étapes : `ARROW_BEND` dans `src/main.js`
- Raccourci global : `Code::F10` dans `src-tauri/src/main.rs`
