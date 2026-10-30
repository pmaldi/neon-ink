# NeonInk

Dessin néon par-dessus l'écran, pour présenter, expliquer ou annoter n'importe quelle application.
Appuyez sur **F10**, dessinez, puis **F10** à nouveau : les tracés sont masqués et l'écran redevient utilisable normalement. Un nouveau **F10** les réaffiche tels quels. **Échap** efface tout et quitte le dessin.

[Télécharger la dernière version](https://github.com/pmaldi/neon-ink/releases/latest) : l'installateur (`…-setup.exe` ou `.msi`, installe NeonInk dans Program Files pour tous les utilisateurs, avec les droits administrateur) ou la version portable (`…_portable.exe`, à lancer directement, sans installation).

- Trait néon : il naît « chauffé à blanc » puis refroidit vers sa couleur, et une comète lumineuse le parcourt quand on lève le stylo
- Reconnaissance de formes : trait droit, courbe, cercle, ellipse, carré, rectangle, triangle. Le tracé se transforme en forme propre avec une animation
- Gomme entière (le trait se consume en étincelles) ou gomme précise (n'enlève qu'une partie du trait)
- Traits en tirets et texte écrit au clavier, en néon lui aussi
- Formes toutes faites : rectangle, rond, triangle, étoile, flèche, posées d'un glisser
- Capture d'écran avec les dessins, enregistrée dans Images › NeonInk et copiée dans le presse-papiers
- Étapes numérotées : chaque clic pose une pastille ①, ②, ③… reliée à la précédente par une flèche courbe. Glisser dessine un trait ou une forme sans quitter le mode. Effacer une étape renumérote les suivantes
- Plusieurs écrans : le calque s'ouvre sur l'écran où se trouve la souris
- Léger : aucune image n'est calculée quand rien ne bouge, et la fenêtre est masquée hors du mode dessin
- Tableau noir ou blanc, papier petits carreaux ou grands carreaux (Seyès) : un fond opaque pour dessiner sur une page vierge, avec les formes aimantées au quadrillage
- Plugins à installer depuis l'aide, sans alourdir l'application : réseau, isométrique, organigramme, UML, cloud, annotations, présentation (spot, loupe, laser, rideau), minuteur et géométrie
- Mises à jour automatiques : la nouvelle version s'installe d'elle-même quand NeonInk ne sert pas
- Raccourcis personnalisables dans un fichier de configuration, rechargé à chaud

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
| **I** | Texte : le curseur apparaît sous la souris, on écrit au clavier (Entrée : nouvelle ligne, Échap ou clic : terminer) |
| **L** | Traits pleins / en tirets |
| **M** / **clic molette** | Roue des formes : rectangle, rond, triangle, étoile, flèche. Maintenir **M**, viser, relâcher (ou appuyer puis cliquer). Glisser pour la tracer (**Maj** : carré, cercle, forme régulière), clic : taille par défaut |
| **F** | Formes auto activées / désactivées |
| **Maj** en relâchant | Garder ce tracé à main levée |
| **Ctrl+Z** / **Retour arrière** | Annuler le dernier élément |
| **Suppr** / **X** | Tout effacer (animé) |
| **Molette** / **+ −** | Épaisseur du trait |
| **Maj+K** / **Maj+W** | Tableau noir / tableau blanc (même touche : retour à l'écran) |
| **Maj+P** / **Maj+G** | Papier petits carreaux / grands carreaux Seyès (même touche : retour à l'écran) |
| **Ctrl+S** | Capture d'écran avec les dessins (Images › NeonInk, copiée aussi dans le presse-papiers) |
| **Ctrl+Maj+S** | Ouvrir le dossier des captures |
| **H** | Aide à l'écran |

Les lettres suivent la disposition du clavier (AZERTY compris). Le bouton gomme d'un stylet de tablette fonctionne aussi.

### Personnaliser les raccourcis

Dans l'aide (**H**, ou menu de l'icône › **Aide, raccourcis et plugins…**), classée en onglets avec une recherche, chaque touche se modifie d'un clic :

- **clic sur une touche**, puis appui sur la nouvelle (Maj, Ctrl, Alt acceptés) ou sur un bouton de la souris : clic molette, boutons latéraux 4 et 5 ; un clic ailleurs annule ;
- **+** en bout de ligne ajoute une touche de plus pour la même action ;
- **clic droit** sur une touche la retire ;
- **Touches d'origine** rétablit tout.

Une touche déjà utilisée par une autre action lui est retirée (un message le signale). Le raccourci global (F10) se change de la même façon : NeonInk le libère le temps de la saisie.

Tout est enregistré dans `config.json` (`%APPDATA%\com.patrice.neonink\`), que le bouton **Ouvrir config.json** ouvre dans le Bloc-notes. Le fichier reste modifiable à la main et NeonInk le recharge dès qu'il est enregistré. Sa section `liens` liste les liens affichés par… un petit secret, à découvrir en mode dessin.

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
- l'installation, la migration depuis une ancienne version installée dans AppData, la mise à jour silencieuse lancée par un utilisateur standard, la mise à jour passive avec relance et la désinstallation (`scripts/ci/install_test.ps1`).

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

Les builds de contrôle (`build.yml`) utilisent une optimisation plus légère pour aller plus vite ; les releases gardent l'optimisation complète, qui donne l'exécutable le plus léger (environ 2,9 Mo, installateur 1,2 Mo). Le résumé de chaque release indique la taille des fichiers.

Le script met à jour les numéros de version et le CHANGELOG, puis crée le commit et le tag. Il accepte `patch`, `minor`, `major` ou un numéro précis.
Le push du tag lance le workflow « Release », qui compile l'application et publie les installateurs et l'exécutable portable dans les [Releases GitHub](https://github.com/pmaldi/neon-ink/releases) avec les notes du CHANGELOG.

## Plugins

Des fonctionnalités en plus, absentes des installateurs : chacune se télécharge depuis l'aide (**H**), onglet **Plugins**, bouton **Installer**. Un plugin installé se charge à chaque démarrage, ajoute ses touches à l'aide et se met à jour tout seul ; **Retirer** le désactive aussitôt.

Dans tous les plugins, **M** ou le **clic molette** rouvre la roue de l'outil actif, **Maj+clic** sur un élément modifie son texte, et la gomme efface un élément avec ses liens.

| Plugin | Touche | Ce qu'il apporte |
|---|---|---|
| **Réseau** | **J** | Routeur, switch, serveur, PC, pare-feu, Internet, Wi-Fi, animés, nommés automatiquement (R1, SW1…). Glisser d'un appareil à un autre les relie ; vers le vide, pose un appareil déjà relié. **Alt+J** : type de câble (cuivre, fibre, VPN, sans fil) ; **Ctrl+J** : zone nommée (LAN, DMZ…) ; Maj+clic : étiquette ou adresse IP sur un appareil ou un lien ; **Maj+J** : animations en pause |
| **Isométrique** | **Maj+I** | Serveur, switch, routeur, PC, pare-feu, base de données, cloud, conteneur et utilisateur en volumes néon à 30°, reliés par des chemins animés. **Alt+I** : grille isométrique |
| **Organigramme** | **Q** | Étape, décision, début / fin, données, document, sous-processus. Le clic pose la forme et demande son texte ; glisser d'une forme à l'autre trace une flèche ; **Ctrl+glisser** déplace une forme, les flèches suivent ; Maj+clic sur une flèche : « oui », « non » |
| **UML et bases de données** | **Maj+Q** | Tables (`Client: id PK, nom, pays_id FK`), classes (`Chien: -race | +aboyer()`), relations 1-1, 1-N, N-N en pattes de corbeau, héritage |
| **Cloud** | **U** | Machine virtuelle, conteneur, cluster, base de données, stockage, répartiteur, fonction, file de messages, CDN, passerelle API, utilisateurs, région. Flux animés entre les services |
| **Annotations** | **Z** | Tampons ✔ ✖ ? ! ★ ♥, bulles de commentaire (glisser du point visé vers la bulle) et notes post-it |
| **Présentation** | **A** | Spot (l'écran s'assombrit autour de la souris), loupe ×2, pointeur laser, rideau à dévoiler. La molette règle la taille du spot et de la loupe |
| **Minuteur** | **Maj+T** | Compte à rebours (1 à 30 min) ou chronomètre, dans un anneau en haut à droite ; il reste affiché après F10. **Maj+T** : pause, **Alt+T** : arrêt |
| **Géométrie** | **Maj+R** | Règle graduée, rapporteur, compas, repère, angle droit. 1 cm = 2 petits carreaux ; les points s'aimantent au quadrillage |

Pour écrire un plugin : [plugins/README.md](plugins/README.md).

## Mises à jour

NeonInk consulte la dernière release GitHub 15 secondes après son démarrage, puis toutes les 2 heures.

Avec « Installer les mises à jour automatiquement » (coché par défaut dans le menu de l'icône), la nouvelle version s'installe dès que NeonInk est inactif : pas de dessin en cours ni de tracé gardé en mémoire. Sinon, l'entrée « Installer la version X » apparaît dans le menu.

- Version installée : aucune fenêtre, aucune demande d'autorisation. L'installateur crée une tâche planifiée « NeonInk Update » exécutée par le compte système, que tout utilisateur peut lancer (comme les mises à jour de Chrome ou Edge). NeonInk la lance ; elle télécharge le nouvel exécutable depuis les releases GitHub et le met à la place de l'ancien ; NeonInk redémarre dessus en une seconde, au prochain moment où il ne sert pas. La tâche ne prend aucun paramètre et ne télécharge que depuis ce dépôt. Les installations antérieures à 0.8.0, sans cette tâche, passent une dernière fois par l'installateur et la demande d'autorisation.
- Version portable : l'exécutable se remplace lui-même puis redémarre (il doit se trouver dans un dossier modifiable).

Au passage en mode dessin suivant, un message confirme la nouvelle version. Si une installation demandée depuis le menu échoue, la page de la release s'ouvre dans le navigateur. Le code se trouve dans `src/update.js`, `src-tauri/src/updater.rs` et `src-tauri/src/system_update.rs`.

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
- Raccourcis : `config.json` (voir plus haut), valeurs d'origine dans `src/config.default.json`
